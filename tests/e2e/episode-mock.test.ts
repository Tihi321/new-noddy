import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installPipeline } from '../../src/engine/pipeline/install'
import type { InstalledPipeline } from '../../src/engine/pipeline/install'
import { writeMd } from '../../src/engine/store/atomic'
import type { ToolRegistrar } from '../../src/engine/tools/handlers/registry'
import { Shots } from '../../src/shared/episode'
import type { EpisodeMeta } from '../../src/shared/episode'
import type { EngineEvent, NewEpisodeCommand } from '../../src/shared/protocol'
import { LLM_ROLES, TOOL_ROLES } from '../../src/shared/schemas'
import { buildStory } from '../fixtures/story/story'
import type { Story } from '../fixtures/story/story'
import { makeEnv, waitFor } from '../helpers'
import type { TestEnv } from '../helpers'

const story: Story = buildStory()
const reply = (v: unknown) => JSON.stringify(v)

/** Tool crews that write tiny placeholder files instead of running Blender, Godot and ffmpeg. */
function fakeTools(calls: string[]): ToolRegistrar {
  return (scheduler, deps) => {
    const { store } = deps
    const reg = (task: string, fn: (ep: string, unit: string | null) => Promise<void>) =>
      scheduler.register(
        task,
        async (ctx) => {
          const ep = ctx.job.episode!
          calls.push(`${task}${ctx.job.unit ? ':' + ctx.job.unit : ''}`)
          await fn(ep, ctx.job.unit)
          ctx.progress({ done: 1, total: 1, label: task })
          return { result: `fake ${task}` }
        },
        { tool: true }
      )
    const shotIds = async (ep: string) => (await store.readValid(ep, 'shots.json', Shots)).shots.map((s) => s.id)
    reg('build_puppet', (ep, u) => store.writeText(ep, `assets/puppets/${u}-abcd1234.glb`, 'glb'))
    reg('build_set', (ep, u) => store.writeText(ep, `assets/sets/${u}-abcd1234.glb`, 'glb'))
    reg('voice_lines', async (ep) => {
      const script = story.script
      for (const l of script.scenes.flatMap((s) => s.beats).filter((b) => b.kind === 'line')) {
        await store.writeText(ep, `audio/lines/${l.lineId}.wav`, 'wav')
        await store.writeJson(ep, `audio/lines/${l.lineId}.json`, { lineId: l.lineId, duration: 1.5, fps: 12, levels: [0, 1, 2, 1] })
      }
    })
    reg('compile_tracks', async (ep) => {
      for (const id of await shotIds(ep)) await store.writeJson(ep, `tracks/${id}.json`, { shotId: id, frames: 1 })
    })
    reg('mix_audio', async (ep) => {
      for (const id of await shotIds(ep)) await store.writeText(ep, `audio/${id}.wav`, 'wav')
      await store.writeText(ep, 'audio/episode.wav', 'wav')
    })
    reg('preview_shot', async (ep, u) => {
      await store.writeText(ep, `preview/${u}.mp4`, 'mp4')
      await store.writeText(ep, `preview/thumbs/${u}.png`, 'png')
    })
    reg('animatic', (ep) => store.writeText(ep, 'preview/animatic.mp4', 'mp4'))
    reg('render_shot', (ep, u) => store.writeText(ep, `render/${u}.mp4`, 'mp4'))
    reg('edit_episode', (ep) => store.writeText(ep, 'out/episode.mp4', 'mp4'))
  }
}

interface Setup {
  env: TestEnv
  installed: InstalledPipeline
  calls: string[]
  events: EngineEvent[]
  send: (cmd: NewEpisodeCommand) => Promise<string>
  meta: (id: string) => Promise<EpisodeMeta>
  stage: (id: string, stage: string, ms?: number) => Promise<void>
  awaiting: (id: string, checkpoint: 'script' | 'animatic', round?: number) => Promise<void>
}

const NEW: NewEpisodeCommand = {
  type: 'newEpisode',
  theme: 'Tock loses his cap on a windy day',
  episodeType: 'lesson',
  characters: ['tock'],
  lengthMin: 5,
  style: 'toyland-wood',
  approvals: { script: true, animatic: true }
}

let current: Setup | undefined

async function setup(o: { registrars?: ToolRegistrar[]; autoApprove?: boolean; maxAttempts?: number; noQaModel?: boolean } = {}): Promise<Setup> {
  const env = await makeEnv({
    providers: [{ id: 'loc', local: true, concurrency: 8, models: ['m1'] }],
    roles: Object.fromEntries(LLM_ROLES.map((r) => [r, r === 'qa' && o.noQaModel ? [] : ['loc/m1']])),
    agents: [
      ...LLM_ROLES.map((role) => ({ role, name: 'Crew', maxParallel: 4 })),
      ...TOOL_ROLES.map((role) => ({ role, name: 'Crew', kind: 'tool' as const, maxParallel: 4 }))
    ]
  })
  // the catalog the producer and designers choose from
  await rm(path.join(env.dir, 'cast'), { recursive: true, force: true })
  await rm(path.join(env.dir, 'sets'), { recursive: true, force: true })
  await mkdir(path.join(env.dir, 'cast'), { recursive: true })
  await mkdir(path.join(env.dir, 'sets'), { recursive: true })
  for (const c of story.cast) await writeMd(path.join(env.dir, 'cast', `${c.id}.md`), c, `${c.name} lives in Tumbletown.\n`)
  for (const s of story.sets) await writeMd(path.join(env.dir, 'sets', `${s.id}.md`), s, `${s.name}.\n`)
  if (o.maxAttempts) env.engine.pipelineConfig = { ...env.engine.pipelineConfig, max_attempts: o.maxAttempts }

  const calls: string[] = []
  const installed = installPipeline(env.engine, o.registrars ?? [fakeTools(calls)], { tickMs: 200 })
  const events = env.events
  if (o.autoApprove) {
    env.engine.onEvent((e) => {
      if (e.type === 'episode.updated' && e.episode.status === 'awaiting_approval' && e.episode.awaiting) {
        void env.engine.handleCommand({ type: 'approve', episode: e.episode.id, checkpoint: e.episode.awaiting })
      }
    })
  }
  const meta = async (id: string) => (await installed.store.readMeta(id))!.meta
  const s: Setup = {
    env,
    installed,
    calls,
    events,
    meta,
    async send(cmd) {
      await env.engine.handleCommand(cmd)
      const ids = await installed.store.ids()
      return ids[ids.length - 1]!
    },
    async stage(id, stage, ms = 30000) {
      await waitFor(async () => (await meta(id)).stage === stage, ms, `episode ${id} to reach ${stage}`)
    },
    async awaiting(id, checkpoint, round) {
      await waitFor(
        async () => {
          const m = await meta(id)
          return m.status === 'awaiting_approval' && m.stage === (checkpoint === 'script' ? 'approve_script' : 'approve_animatic') && (round === undefined || m.round === round)
        },
        30000,
        `episode ${id} to wait at the ${checkpoint} checkpoint`
      )
    }
  }
  current = s
  return s
}

/** The usual scripted crew: every task answers with the fixture episode. */
function scriptCrew(env: TestEnv, over: { reviews?: ('pass' | 'revise')[]; actionsFor?: (unit: string, task: string) => unknown } = {}): { reviewCalls: number[]; rewriteRequests: string[] } {
  const { mock } = env
  const seen = { reviewCalls: [] as number[], rewriteRequests: [] as string[] }
  mock.on({ task: 'brief' }, reply(story.brief))
  mock.on({ task: 'outline' }, reply(story.outline))
  mock.on({ task: 'script' }, reply(story.script))
  mock.on({ task: 'rewrite' }, (req) => {
    seen.rewriteRequests.push(req.messages.map((m) => m.content).join('\n'))
    return reply({ ...story.script, title: 'Tock and the Windy Day (second draft)' })
  })
  mock.on({ task: 'review' }, () => {
    const n = seen.reviewCalls.length
    seen.reviewCalls.push(n)
    const verdict = over.reviews?.[n] ?? 'pass'
    return reply(verdict === 'pass' ? story.review : { verdict: 'revise', summary: 'Add a clearer first attempt.', issues: [{ sceneId: 'sc1', problem: 'unclear', fix: 'show the wind' }] })
  })
  mock.on({ task: 'cast' }, reply({ picks: ['tock', 'bobbin'], guests: [] }))
  mock.on({ task: 'sets' }, reply({ picks: ['town_square', 'pond'], custom: [] }))
  mock.on({ task: 'shots' }, reply(story.shots))
  const acts = (req: { meta?: { unit?: string; task?: string } }) => {
    const unit = req.meta!.unit!
    return reply(over.actionsFor ? over.actionsFor(unit, req.meta!.task!) : story.actions[unit])
  }
  mock.on({ task: 'actions' }, acts)
  mock.on({ task: 'fix_actions' }, acts)
  mock.on({ task: 'music' }, reply(story.music))
  mock.on({ task: 'sfx' }, reply(story.sfx))
  return seen
}

afterEach(async () => {
  if (current) {
    await current.installed.stop()
    await current.env.cleanup()
    current = undefined
  }
})

const exists = async (file: string) => readFile(file).then(() => true, () => false)

describe('episode pipeline with the mock provider', () => {
  it('runs a theme to a finished package, with a story editor revision and both approvals', async () => {
    const s = await setup({ autoApprove: true })
    const crew = scriptCrew(s.env, { reviews: ['revise', 'pass'] })
    const id = await s.send(NEW)
    expect(id).toBe('tock-loses-his-cap-on-a-windy-day')
    await s.stage(id, 'done')

    const m = await s.meta(id)
    expect(m).toMatchObject({ stage: 'done', status: 'done', error: null, approved: { script: true, animatic: true }, round: 1 })
    expect(crew.reviewCalls).toHaveLength(2)

    const dir = (...p: string[]) => path.join(s.env.dir, 'episodes', id, ...p)
    const expected = [
      'episode.md', 'brief.json', 'brief.md', 'outline.json', 'outline.md', 'script.json', 'script.md', 'reviews/review-0.json', 'reviews/review-1.json',
      'reviews/script-before-0.json', 'cast.json', 'sets.json', 'shots.json', 'music.json', 'sfx.json', 'qa.json', 'actions/shot-01.json', 'actions/shot-15.json',
      'assets/puppets/tock-abcd1234.glb', 'assets/puppets/bobbin-abcd1234.glb', 'assets/sets/town_square-abcd1234.glb', 'assets/sets/pond-abcd1234.glb',
      'audio/lines/L001.wav', 'audio/lines/L005.json', 'tracks/shot-01.json', 'tracks/shot-15.json', 'audio/shot-01.wav', 'audio/episode.wav',
      'preview/shot-01.mp4', 'preview/thumbs/shot-15.png', 'preview/animatic.mp4', 'render/shot-01.mp4', 'render/shot-15.mp4', 'out/episode.mp4'
    ]
    for (const f of expected) expect(await exists(dir(...f.split('/'))), f).toBe(true)
    expect(await readdir(dir('actions'))).toHaveLength(15)
    expect(JSON.parse(await readFile(dir('qa.json'), 'utf8'))).toMatchObject({ ok: true, issues: [] })
    expect(JSON.parse(await readFile(dir('cast.json'), 'utf8')).map((p: { id: string }) => p.id)).toEqual(['tock', 'bobbin'])
    expect(JSON.parse(await readFile(dir('script.json'), 'utf8')).scenes).toHaveLength(3)
    expect(await readFile(dir('script.md'), 'utf8')).toContain('mumbles')

    // the tool stages ran in the contract's order
    const order = ['build_puppet', 'build_set', 'voice_lines', 'compile_tracks', 'mix_audio', 'preview_shot', 'animatic', 'render_shot', 'edit_episode']
    const firsts = order.map((t) => s.calls.findIndex((c) => c.startsWith(t)))
    expect(firsts.every((i) => i >= 0)).toBe(true)
    expect([...firsts].sort((a, b) => a - b)).toEqual(firsts)
    expect(s.calls.filter((c) => c.startsWith('render_shot'))).toHaveLength(15)

    // events: the UI heard about every stage, with the checkpoints on the way
    const updates = s.events.filter((e): e is Extract<EngineEvent, { type: 'episode.updated' }> => e.type === 'episode.updated').map((e) => e.episode)
    expect(updates.some((u) => u.awaiting === 'script')).toBe(true)
    expect(updates.some((u) => u.awaiting === 'animatic')).toBe(true)
    const last = updates.at(-1)!
    expect(last).toMatchObject({ id, stage: 'done', status: 'done', shots: 15, lengthMin: 5, title: 'Tock and the Windy Day (second draft)' })
    expect(m.title).toBe('Tock and the Windy Day (second draft)') // episode.md carries the title, not an empty string
    expect(last.assets.final).toBe(`episodes/${id}/out/episode.mp4`)
    expect(s.events.some((e) => e.type === 'engine.warning')).toBe(false)

    // a snapshot lists the episode
    await s.env.engine.handleCommand({ type: 'snapshot' })
    const snap = s.events.filter((e) => e.type === 'snapshot').at(-1)
    expect(snap && 'episodes' in snap ? snap.episodes.map((e) => e.id) : []).toEqual([id])
  })

  it('stops at both checkpoints and answers change requests with a rewrite and a new cut', async () => {
    const s = await setup()
    const crew = scriptCrew(s.env)
    const id = await s.send(NEW)

    await s.awaiting(id, 'script', 0)
    expect((await s.installed.store.summary(id))!).toMatchObject({ stage: 'approve_script', status: 'awaiting_approval', awaiting: 'script' })
    expect(await exists(path.join(s.env.dir, 'episodes', id, 'cast.json'))).toBe(false) // nothing past the checkpoint has run
    await s.env.engine.handleCommand({ type: 'requestChanges', episode: id, checkpoint: 'script', note: 'Make Bobbin carry a flower.' })

    await s.awaiting(id, 'script', 2)
    const user = JSON.parse(await readFile(path.join(s.env.dir, 'episodes', id, 'reviews', 'review-1.json'), 'utf8'))
    expect(user).toMatchObject({ verdict: 'revise', source: 'user', summary: 'Make Bobbin carry a flower.' })
    expect(crew.rewriteRequests).toHaveLength(1)
    expect(crew.rewriteRequests[0]).toContain('Make Bobbin carry a flower.')
    expect(crew.rewriteRequests[0]).toContain('the person who commissioned the episode')
    await s.env.engine.handleCommand({ type: 'approve', episode: id, checkpoint: 'script' })

    await s.awaiting(id, 'animatic')
    let m = await s.meta(id)
    expect(m.cut).toBe(0)
    expect(s.calls.filter((c) => c.startsWith('render_shot'))).toHaveLength(0)
    await s.env.engine.handleCommand({ type: 'requestChanges', episode: id, checkpoint: 'animatic', note: 'Longer ending, please.' })

    // approving the wrong checkpoint is ignored
    await s.env.engine.handleCommand({ type: 'approve', episode: id, checkpoint: 'script' })
    await waitFor(async () => (await s.meta(id)).cut === 1 && (await s.meta(id)).stage === 'approve_animatic' && (await s.meta(id)).status === 'awaiting_approval', 30000, 'the second cut')
    m = await s.meta(id)
    expect(m).toMatchObject({ cut: 1, cutNote: 'Longer ending, please.', approved: { animatic: false } })
    const shotsJob = await readFile(path.join(s.env.dir, 'jobs', 'done', `${id}--shots--all--c1.md`), 'utf8')
    expect(shotsJob).toContain('Longer ending, please.')
    expect(s.calls.filter((c) => c.startsWith('compile_tracks'))).toHaveLength(2)

    await s.env.engine.handleCommand({ type: 'approve', episode: id, checkpoint: 'animatic' })
    await s.stage(id, 'done')
    expect(await exists(path.join(s.env.dir, 'episodes', id, 'out', 'episode.mp4'))).toBe(true)
    expect(s.calls.filter((c) => c.startsWith('render_shot'))).toHaveLength(15)
  })

  it('sends QA problems back to the owner as a fix job, then goes on', async () => {
    const s = await setup({ autoApprove: true })
    let broken = 0
    scriptCrew(s.env, {
      actionsFor: (unit, task) => {
        if (unit === 'shot-06' && task === 'actions') {
          broken++
          // a missing talk would be repaired deterministically, an unknown target goes back to the animator
          return { shotId: unit, actions: story.actions[unit]!.actions.map((a) => (a.target !== undefined ? { ...a, target: 'nowhere_at_all' } : a)) }
        }
        return story.actions[unit]
      }
    })
    const id = await s.send({ ...NEW, approvals: { script: false, animatic: false } })
    await s.stage(id, 'done')
    expect(broken).toBe(1)
    const qa0 = await readFile(path.join(s.env.dir, 'episodes', id, 'qa.json'), 'utf8')
    expect(JSON.parse(qa0)).toMatchObject({ ok: true, round: 1 })
    const fix = await readFile(path.join(s.env.dir, 'jobs', 'done', `${id}--fix_actions--shot-06--c0q1.md`), 'utf8')
    expect(fix).toContain('nowhere_at_all')
    expect(fix).toContain('role: animator')
    expect((await s.meta(id)).qaRound).toBe(1)
  })

  it('parks at a tool stage whose module is not installed, with one warning and no failure', async () => {
    const s = await setup({ registrars: [], autoApprove: true })
    scriptCrew(s.env)
    const id = await s.send({ ...NEW, approvals: { script: false, animatic: false } })
    await s.stage(id, 'assets')
    await waitFor(() => s.events.some((e) => e.type === 'engine.warning'), 10000, 'the warning')
    // several ticks later: still parked, still one warning
    await new Promise((r) => setTimeout(r, 900))
    const m = await s.meta(id)
    expect(m).toMatchObject({ stage: 'assets', status: 'running', error: null })
    const warnings = s.events.filter((e) => e.type === 'engine.warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ message: expect.stringContaining('build_puppet, build_set') })
    // the cast and sets are done, no tool job was queued
    expect(await s.env.engine.jobs.ids('queued')).toEqual([])
  })

  it('fails the episode, with the reason, when a crew job keeps failing', async () => {
    const s = await setup({ maxAttempts: 1 })
    scriptCrew(s.env)
    s.env.mock.on({ task: 'shots' }, 'this is not JSON at all')
    const id = await s.send({ ...NEW, approvals: { script: false, animatic: false } })
    await s.stage(id, 'failed')
    const m = await s.meta(id)
    expect(m.status).toBe('failed')
    expect(m.error).toContain('shots failed')
    expect(m.error).toContain('valid JSON')
    expect(s.events.some((e) => e.type === 'engine.warning' && e.message.includes('failed'))).toBe(true)
    expect((await s.installed.store.summary(id))!.status).toBe('failed')
  })

  it('retries a failed episode from the stage that failed', async () => {
    const s = await setup({ maxAttempts: 1, autoApprove: true })
    scriptCrew(s.env)
    const bad = s.env.mock.on({ task: 'shots' }, 'this is not JSON at all')
    const id = await s.send({ ...NEW, approvals: { script: false, animatic: false } })
    await s.stage(id, 'failed')
    expect(await s.env.engine.jobs.ids('failed')).toEqual([`${id}--shots--all--c0`])
    expect((await s.meta(id)).failedStage).toBe('shots')
    // retrying an episode that did not fail does nothing
    await s.env.engine.handleCommand({ type: 'retryEpisode', episode: 'nope' })
    bad() // the director is fixed
    await s.env.engine.handleCommand({ type: 'retryEpisode', episode: id })
    expect(await s.meta(id)).toMatchObject({ stage: 'shots', status: 'running', error: null, failedStage: null })
    await s.stage(id, 'done')
    expect(await s.env.engine.jobs.ids('failed')).toEqual([])
    expect(await exists(path.join(s.env.dir, 'episodes', id, 'out', 'episode.mp4'))).toBe(true)
  })

  it('runs the QA check without a model for the qa role', async () => {
    const s = await setup({ autoApprove: true, noQaModel: true })
    scriptCrew(s.env)
    const id = await s.send({ ...NEW, approvals: { script: false, animatic: false } })
    await s.stage(id, 'done')
    expect(JSON.parse(await readFile(path.join(s.env.dir, 'episodes', id, 'qa.json'), 'utf8')).ok).toBe(true)
  })

  it('does nothing more while it waits at a checkpoint (the state is all in the files)', async () => {
    const s = await setup()
    scriptCrew(s.env)
    const id = await s.send(NEW)
    await s.awaiting(id, 'script')
    // a second pipeline over the same data folder (as after a restart) sees the checkpoint and does not redo any work
    const before = s.env.mock.calls.length
    const state = await s.installed.store.loadState(id)
    expect(state!.meta.stage).toBe('approve_script')
    await s.installed.pipeline.advanceEpisode(id)
    await s.installed.pipeline.advanceEpisode(id)
    await new Promise((r) => setTimeout(r, 300))
    expect(s.env.mock.calls.length).toBe(before)
    expect((await s.installed.store.summaries()).map((e) => e.id)).toEqual([id])
  })
})
