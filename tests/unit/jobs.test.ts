import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JobStore } from '../../src/engine/queue/jobs'
import { parseMd } from '../../src/shared/md'
import type { EngineEvent } from '../../src/shared/protocol'
import { makeEnv, sleep, waitFor } from '../helpers'
import type { TestEnv } from '../helpers'

let env: TestEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const jobsIn = (e: TestEnv, state: string) => readdir(path.join(e.dir, 'jobs', state)).then((f) => f.filter((n) => n.endsWith('.md')))

describe('JobStore', () => {
  it('enqueues idempotently, claims once and moves files between states', async () => {
    env = await makeEnv()
    const jobs = new JobStore(env.dir)
    expect(await jobs.enqueue({ id: 'ep1--script--s1--r0', task: 'script', role: 'screenwriter', episode: 'ep1' }, 'body')).toBe(true)
    expect(await jobs.enqueue({ id: 'ep1--script--s1--r0', task: 'script', role: 'screenwriter' })).toBe(false)
    const claimed = await jobs.claim('ep1--script--s1--r0')
    expect(claimed?.data).toMatchObject({ episode: 'ep1', role: 'screenwriter', attempts: 0 })
    expect(await jobs.claim('ep1--script--s1--r0')).toBeNull()
    await jobs.complete('ep1--script--s1--r0', { attempts: 0 }, 'done body')
    expect(await jobs.ids('running')).toEqual([])
    expect(await jobs.ids('done')).toEqual(['ep1--script--s1--r0'])
    expect(await jobs.enqueue({ id: 'ep1--script--s1--r0', task: 'x', role: 'y' })).toBe(false) // also not when done
  })

  it('recovers jobs left in running/ with one more attempt, and drops finished duplicates', async () => {
    env = await makeEnv()
    const jobs = new JobStore(env.dir)
    await jobs.enqueue({ id: 'a', task: 't', role: 'r' })
    await jobs.enqueue({ id: 'b', task: 't', role: 'r' })
    await jobs.claim('a')
    await jobs.claim('b')
    await writeFile(path.join(env.dir, 'jobs', 'done', 'b.md'), await readFile(path.join(env.dir, 'jobs', 'running', 'b.md'), 'utf8'))
    await writeFile(path.join(env.dir, 'jobs', 'queued', 'x.md.tmp-1'), 'junk')
    const r = await jobs.recoverRunning()
    expect(r).toEqual({ requeued: ['a'], dropped: ['b'] })
    expect(parseMd(await readFile(path.join(env.dir, 'jobs', 'queued', 'a.md'), 'utf8')).data.attempts).toBe(1)
    expect(await readdir(path.join(env.dir, 'jobs', 'queued'))).toEqual(['a.md'])
  })
})

describe('tool jobs', () => {
  const toolCrew = [{ role: 'render_farm', name: 'Farm', kind: 'tool' as const }]

  it('run on a tool agent without a model, report progress and finish', async () => {
    env = await makeEnv({ agents: toolCrew })
    env.engine.scheduler.register(
      'render_shot',
      async (ctx) => {
        expect(ctx.tool).toBe(true)
        for (let i = 1; i <= 3; i++) ctx.progress({ done: i, total: 3, label: 'shot 1' })
        await expect(ctx.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/tool job/)
        return { result: 'rendered' }
      },
      { tool: true }
    )
    await env.engine.jobs.enqueue({ id: 'ep1--render--s1--r0', task: 'render_shot', role: 'render_farm', episode: 'ep1' })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 5000, 'tool job done')
    const prog = env.events.filter((e): e is Extract<EngineEvent, { type: 'render.progress' }> => e.type === 'render.progress')
    expect(prog.map((p) => [p.episode, p.jobId, p.done, p.total, p.label])).toEqual([
      ['ep1', 'ep1--render--s1--r0', 1, 3, 'shot 1'],
      ['ep1', 'ep1--render--s1--r0', 2, 3, 'shot 1'],
      ['ep1', 'ep1--render--s1--r0', 3, 3, 'shot 1']
    ])
    const done = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', 'ep1--render--s1--r0.md'), 'utf8'))
    expect(done.data).toMatchObject({ agent: 'render_farm-farm', paid: false })
    expect(done.data.model).toBeUndefined()
    expect(env.events.some((e) => e.type === 'spend')).toBe(false)
    const started = env.events.find((e) => e.type === 'job.started')
    expect(started).toMatchObject({ agent: 'render_farm-farm', task: 'render_shot' })
  })

  it('never go to an LLM agent of the same role, and LLM jobs never go to a tool crew', async () => {
    env = await makeEnv({ roles: { render_farm: ['loc/m1'] }, agents: [{ role: 'render_farm', name: 'Llm' }] })
    env.engine.scheduler.register('render_shot', async () => ({ result: 'x' }), { tool: true })
    await env.engine.jobs.enqueue({ id: 't1', task: 'render_shot', role: 'render_farm' })
    await sleep(300)
    expect(await jobsIn(env, 'done')).toEqual([])
    expect(await jobsIn(env, 'queued')).toEqual(['t1.md'])
  })

  it('are retried when the handler fails, and stop with the abort signal', async () => {
    env = await makeEnv({ agents: toolCrew })
    let calls = 0
    env.engine.scheduler.register(
      'flaky',
      async () => {
        calls++
        if (calls === 1) throw new Error('blender crashed')
        return { result: 'ok' }
      },
      { tool: true }
    )
    await env.engine.jobs.enqueue({ id: 'f1', task: 'flaky', role: 'render_farm', max_attempts: 3 })
    await waitFor(async () => (await jobsIn(env!, 'done')).length === 1, 8000, 'retried and done')
    expect(calls).toBe(2)
  })
})
