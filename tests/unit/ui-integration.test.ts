import { afterEach, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseRange } from '../../src/main/files'
import type { SnapshotEvent } from '../../src/shared/protocol'
import { makeEnv, seedDir, waitFor } from '../helpers'
import type { TestEnv } from '../helpers'

describe('parseRange', () => {
  it('handles open, closed and suffix ranges', () => {
    expect(parseRange(undefined, 100)).toBeNull()
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBe('invalid')
    expect(parseRange('bytes=20-10', 100)).toBe('invalid')
    expect(parseRange('items=1-2', 100)).toBeNull()
  })
})

describe('snapshot: cast, styles, tools', () => {
  let env: TestEnv | undefined
  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  const lastSnapshot = (e: TestEnv) => e.events.filter((x): x is SnapshotEvent => x.type === 'snapshot').at(-1)

  it('lists the cast and styles of the data folder and refreshes them when a catalog file changes', async () => {
    env = await makeEnv()
    await env.engine.handleCommand({ type: 'snapshot' })
    const snap = lastSnapshot(env)!
    expect(snap.cast.map((c) => c.id)).toContain('tock')
    expect(snap.cast.find((c) => c.id === 'tock')).toMatchObject({ name: 'Tock', body: 'peg' })
    expect(snap.styles.map((s) => s.id)).toContain('toyland-wood')
    expect(snap.tools).toEqual([])

    const md = `---\nid: pip\nname: Pip\nbody: teddy\nmaterial: felt\nheight: 1\ncolors: { skin: "#f2c9a0", torso: "#d33b2c", legs: "#2a4fa8", hat: "#d22222", accent: "#ffd400" }\nhat: none\naccessories: []\neyes: dot\nnose: round\nears: round\nvoice: { pitch: 1, speed: 1, timbre: warm }\n---\nA new friend.\n`
    await writeFile(path.join(env.dir, 'cast', 'pip.md'), md)
    await env.engine.handleWatch({ kind: 'catalog', change: 'add', path: path.join(env.dir, 'cast', 'pip.md'), rel: 'cast/pip.md' })
    const next = await waitFor(() => lastSnapshot(env!)?.cast.some((c) => c.id === 'pip'))
    expect(next).toBe(true)
  })

  it('refreshTools fills in the tools and sends a snapshot', async () => {
    env = await makeEnv()
    await env.engine.handleCommand({ type: 'refreshTools' })
    const snap = lastSnapshot(env)!
    expect(snap.tools.map((t) => t.name).sort()).toEqual(['blender', 'ffmpeg', 'godot'])
    for (const t of snap.tools) expect(typeof t.ok).toBe('boolean')
  }, 60_000)

  it('resetSeed puts a changed prompt back and keeps a backup', async () => {
    env = await makeEnv({}, { seedDir })
    const file = path.join(env.dir, 'prompts', '_rules.md')
    await writeFile(file, 'my own rules')
    await env.engine.handleCommand({ type: 'resetSeed', only: ['prompts'] })
    expect(env.events.some((e) => e.type === 'engine.warning' && /Defaults restored/.test(e.message))).toBe(true)
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(file, 'utf8')).not.toBe('my own rules')
  })
})
