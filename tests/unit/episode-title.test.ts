import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EpisodeStore } from '../../src/engine/pipeline/episodeStore'

let dir: string
let store: EpisodeStore

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'toybox-title-'))
  store = new EpisodeStore(dir, undefined as never)
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('episode title', () => {
  it('starts empty, then setTitle puts it into episode.md and the summary', async () => {
    const meta = await store.create({ type: 'newEpisode', theme: 'A windy day', episodeType: 'lesson', characters: [], lengthMin: 5, style: 'toyland-wood', approvals: { script: false, animatic: false } })
    expect((await store.readMeta(meta.id))!.meta.title).toBe('')
    await store.setTitle(meta.id, '  Tock and the Wind  ')
    expect((await store.readMeta(meta.id))!.meta.title).toBe('Tock and the Wind')
    expect((await store.summary(meta.id))!.title).toBe('Tock and the Wind')
    await store.setTitle(meta.id, '   ') // an empty title never wipes a known one
    expect((await store.readMeta(meta.id))!.meta.title).toBe('Tock and the Wind')
    await store.setTitle(meta.id, 'Tock and the Wind, take two')
    expect((await store.readMeta(meta.id))!.meta.title).toBe('Tock and the Wind, take two')
  })
})
