import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetSeed } from '../../src/engine/cli'
import { BACKUP_DIR, SEED_MANIFEST, findSeedDrift, initDataFolder, readSeedManifest, resetToSeed } from '../../src/engine/store/dataFolder'

let dir: string
let seed: string
let data: string
const put = async (root: string, rel: string, text: string) => {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true })
  await writeFile(path.join(root, rel), text)
}
const read = (root: string, rel: string) => readFile(path.join(root, rel), 'utf8')

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'toybox-reset-'))
  seed = path.join(dir, 'seed')
  data = path.join(dir, 'data')
  await put(seed, 'prompts/a.md', 'prompt A v1')
  await put(seed, 'prompts/b.md', 'prompt B v1')
  await put(seed, 'sets/hill.md', 'hill v1')
  await put(seed, 'cast/tock.md', 'tock v1')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('seed manifest and drift', () => {
  it('records a hash of every copied seed file', async () => {
    await initDataFolder(data, seed)
    const m = await readSeedManifest(data)
    expect(Object.keys(m.files).sort()).toEqual(['cast/tock.md', 'prompts/a.md', 'prompts/b.md', 'sets/hill.md'])
    expect(existsSync(path.join(data, SEED_MANIFEST))).toBe(true)
  })

  it('reports nothing when the seed has not changed', async () => {
    await initDataFolder(data, seed)
    expect(await findSeedDrift(data, seed)).toEqual({ stale: [], edited: [] })
  })

  it('reports a seed file that changed after it was copied, and tells edited copies apart', async () => {
    await initDataFolder(data, seed)
    await put(seed, 'prompts/a.md', 'prompt A v2')
    await put(seed, 'sets/hill.md', 'hill v2')
    await put(data, 'sets/hill.md', 'my own hill')
    const d = await findSeedDrift(data, seed)
    expect(d.stale).toEqual(['prompts/a.md', 'sets/hill.md'])
    expect(d.edited).toEqual(['sets/hill.md'])
  })

  it('stops reporting a file once the data copy has the new version, and ignores files without a recorded hash', async () => {
    await initDataFolder(data, seed)
    await put(seed, 'prompts/a.md', 'prompt A v2')
    await put(data, 'prompts/a.md', 'prompt A v2')
    await put(seed, 'prompts/new.md', 'brand new') // not copied yet: it is not stale, it is missing (init copies it)
    expect((await findSeedDrift(data, seed)).stale).toEqual([])
  })

  it('marks an old data folder file that equals the seed as in sync, so a later seed change is noticed', async () => {
    await mkdir(data, { recursive: true })
    await put(data, 'prompts/a.md', 'prompt A v1') // from before the manifest existed
    await initDataFolder(data, seed)
    await put(seed, 'prompts/a.md', 'prompt A v2')
    expect((await findSeedDrift(data, seed)).stale).toEqual(['prompts/a.md'])
  })
})

describe('resetToSeed', () => {
  it('overwrites changed files, backs the old ones up, adds missing ones and keeps files that only exist in the data folder', async () => {
    await initDataFolder(data, seed)
    await put(data, 'prompts/a.md', 'stale A')
    await put(data, 'cast/mine.md', 'my own character')
    await rm(path.join(data, 'sets', 'hill.md'))
    const now = new Date('2026-10-09T12:00:00.000Z')
    const r = await resetToSeed(data, seed, { backup: true, now })
    expect(r.replaced).toEqual(['prompts/a.md'])
    expect(r.added).toEqual(['sets/hill.md'])
    expect(r.unchanged.sort()).toEqual(['cast/tock.md', 'prompts/b.md'])
    expect(await read(data, 'prompts/a.md')).toBe('prompt A v1')
    expect(await read(data, 'sets/hill.md')).toBe('hill v1')
    expect(await read(data, 'cast/mine.md')).toBe('my own character')
    expect(r.backupDir).toBe(path.join(data, BACKUP_DIR, '2026-10-09T12-00-00-000Z'))
    expect(await read(r.backupDir!, 'prompts/a.md')).toBe('stale A')
    expect(await readdir(path.join(r.backupDir!, 'prompts'))).toEqual(['a.md']) // unchanged files are not backed up
    expect((await findSeedDrift(data, seed)).stale).toEqual([])
  })

  it('only touches the folders named in `only`, and refuses unknown ones', async () => {
    await initDataFolder(data, seed)
    await put(data, 'prompts/a.md', 'stale A')
    await put(data, 'sets/hill.md', 'stale hill')
    const r = await resetToSeed(data, seed, { only: ['sets'], backup: true })
    expect(r.replaced).toEqual(['sets/hill.md'])
    expect(await read(data, 'prompts/a.md')).toBe('stale A')
    expect(await read(data, 'sets/hill.md')).toBe('hill v1')
    await expect(resetToSeed(data, seed, { only: ['nope'], backup: true })).rejects.toThrow(/unknown seed folder/)
  })

  it('makes no backup when asked not to, and none when nothing differs', async () => {
    await initDataFolder(data, seed)
    expect((await resetToSeed(data, seed, { backup: true })).backupDir).toBeNull()
    await put(data, 'prompts/a.md', 'stale A')
    const r = await resetToSeed(data, seed, { backup: false })
    expect(r.replaced).toEqual(['prompts/a.md'])
    expect(r.backupDir).toBeNull()
    expect(existsSync(path.join(data, BACKUP_DIR))).toBe(false)
  })

  it('works from the CLI subcommand', async () => {
    await initDataFolder(data, seed)
    await put(data, 'prompts/b.md', 'stale B')
    expect(await resetSeed(['--data', data, '--seed', seed, '--only', 'prompts,sets'])).toBe(0)
    expect(await read(data, 'prompts/b.md')).toBe('prompt B v1')
    expect(await resetSeed(['--data', data, '--seed', seed, '--only', 'bogus'])).toBe(1)
  })
})
