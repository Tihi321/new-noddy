import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SR } from '../../src/engine/audio/dsp'
import { decodeWav } from '../../src/engine/audio/wav'
import { EpisodeStore } from '../../src/engine/pipeline/episodeStore'
import type { JobContext, JobHandler, Scheduler } from '../../src/engine/queue/scheduler'
import { registerAnimAudioTools } from '../../src/engine/tools/handlers/animAudio'
import type { ToolDeps } from '../../src/engine/tools/handlers/registry'
import { MouthFile, Tracks } from '../../src/shared/episode'

let dir: string
let store: EpisodeStore
const handlers = new Map<string, JobHandler>()
const progress: string[] = []
const logs: string[] = []
const ep = 'test-ep'

const ctx = (): JobContext =>
  ({
    job: { episode: ep },
    signal: new AbortController().signal,
    tool: true,
    progress: (p: { done: number; total: number; label: string }) => progress.push(`${p.done}/${p.total} ${p.label}`),
    log: (t: string) => logs.push(t)
  }) as unknown as JobContext

async function put(rel: string, value: unknown): Promise<void> {
  const file = path.join(dir, 'episodes', ep, ...rel.split('/'))
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value))
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'toybox-animaudio-'))
  store = new EpisodeStore(dir, undefined as never)
  const scheduler = { register: (task: string, fn: JobHandler) => void handlers.set(task, fn) } as unknown as Scheduler
  registerAnimAudioTools(scheduler, { dataDir: dir, store, log: () => undefined } as unknown as ToolDeps)
  await put('script.json', {
    title: 'T',
    logline: 'L',
    moral: 'M',
    scenes: [
      {
        id: 'sc1',
        setId: 'town_square',
        summary: 's',
        beats: [
          { id: 'b1', kind: 'line', character: 'tock', lineId: 'L001', text: 'Good morning, Bobbin!', emotion: 'happy' },
          { id: 'b2', kind: 'line', character: 'bobbin', lineId: 'L002', text: 'Where is the red ball?', emotion: 'question' }
        ]
      }
    ]
  })
  await put('cast.json', [
    { id: 'tock', name: 'Tock', body: 'peg', vehicle: { kind: 'van' }, voice: { pitch: 1.2, speed: 1.1, timbre: 'bright' } },
    { id: 'bobbin', name: 'Bobbin', body: 'teddy', voice: { pitch: 1, speed: 1, timbre: 'warm' } }
  ])
  await put('sets.json', [{ id: 'town_square', name: 'Town Square', marks: { center: [0, 0], left: [-4, 0], right: [4, 0] } }])
  await put('shots.json', {
    shots: [
      { id: 'shot-01', sceneId: 'sc1', setId: 'town_square', duration: 6, framing: 'wide', subjects: ['tock'], cast: ['tock', 'bobbin'], startMarks: { tock: 'left', bobbin: 'right' }, lines: ['L001'], transitionIn: 'fade' },
      { id: 'shot-02', sceneId: 'sc1', setId: 'town_square', duration: 4, framing: 'close', subjects: ['bobbin'], cast: ['bobbin'], startMarks: { bobbin: 'center' }, lines: ['L002'], transitionOut: 'fade' }
    ]
  })
  await put('actions/shot-01.json', {
    shotId: 'shot-01',
    actions: [
      { t: 0, actor: 'tock', action: 'drive_to', target: 'center', dur: 3 },
      { t: 3.2, actor: 'tock', action: 'talk', lineId: 'L001' }
    ]
  })
  await put('actions/shot-02.json', { shotId: 'shot-02', actions: [{ t: 0.5, actor: 'bobbin', action: 'talk', lineId: 'L002' }] })
  await put('sfx.json', { cues: [{ shotId: 'shot-02', t: 2.5, cue: 'pop', gain: 0.8 }], voices: { bobbin: { pitch: 1.4, speed: 1, timbre: 'squeaky' } } })
  await put('music.json', {
    tempo: 100,
    key: 'C',
    theme: { instrument: 'music_box', melody: [{ p: 'C5', d: 1 }, { p: 'E5', d: 1 }], bass: [] },
    cues: [{ id: 'c1', shots: ['shot-01', 'shot-02'], mood: 'cheerful', instrument: 'ukulele', tempo: 100, melody: [{ p: 'C4', d: 1 }, { p: 'G4', d: 1 }], bass: [], loop: true, gain: 0.5 }]
  })
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('anim/audio tool handlers', () => {
  it('registers the three tool tasks', () => {
    expect([...handlers.keys()].sort()).toEqual(['compile_tracks', 'mix_audio', 'voice_lines'])
  })

  it('voice_lines writes wav + mouth json + hash, and skips lines whose inputs did not change', async () => {
    const r = await handlers.get('voice_lines')!(ctx())
    expect('result' in r && r.result).toContain('2 voiced')
    for (const id of ['L001', 'L002']) {
      const mouth = MouthFile.parse(JSON.parse(await readFile(store.file(ep, 'audio', 'lines', `${id}.json`), 'utf8')))
      const wav = decodeWav(await readFile(store.file(ep, 'audio', 'lines', `${id}.wav`)))
      expect(wav.sampleRate).toBe(SR)
      expect(wav.channels[0]!.length / SR).toBeCloseTo(mouth.duration, 2)
      expect(mouth.levels).toHaveLength(Math.ceil(mouth.duration * 12 - 0.01))
    }
    const before = (await stat(store.file(ep, 'audio', 'lines', 'L001.wav'))).mtimeMs
    const again = await handlers.get('voice_lines')!(ctx())
    expect('result' in again && again.result).toContain('2 unchanged')
    expect((await stat(store.file(ep, 'audio', 'lines', 'L001.wav'))).mtimeMs).toBe(before)
    // the sfx.json voice override changes Bobbin's file only when her line is voiced again with other inputs
    await put('sfx.json', { cues: [{ shotId: 'shot-02', t: 2.5, cue: 'pop', gain: 0.8 }], voices: { bobbin: { pitch: 0.8, speed: 1, timbre: 'gruff' } } })
    const third = await handlers.get('voice_lines')!(ctx())
    expect('result' in third && third.result).toContain('1 voiced')
  })

  it('compile_tracks writes a valid tracks file per shot with line events and the explicit sfx', async () => {
    const r = await handlers.get('compile_tracks')!(ctx())
    expect('result' in r && r.result).toContain('2 shot(s)')
    const t1 = Tracks.parse(JSON.parse(await readFile(store.file(ep, 'tracks', 'shot-01.json'), 'utf8')))
    expect(t1.frames).toBe(72)
    expect(t1.events.find((e) => e.kind === 'line')).toMatchObject({ frame: 38, lineId: 'L001', actor: 'tock' })
    const mouth = t1.mouths.tock!
    expect(mouth.slice(38).some((m) => m === 2)).toBe(true)
    const t2 = JSON.parse(await readFile(store.file(ep, 'tracks', 'shot-02.json'), 'utf8')) as { events: { cue?: string; gain?: number; frame: number }[] }
    expect(t2.events.find((e) => e.cue === 'pop')).toMatchObject({ frame: 30, gain: 0.8 })
    expect(progress.some((p) => p.endsWith('shot-02'))).toBe(true)
  })

  it('mix_audio writes shot wavs of exact length and the episode wav with its layout sidecar', async () => {
    const r = await handlers.get('mix_audio')!(ctx())
    expect('result' in r && r.result).toContain('episode.wav')
    const s1 = decodeWav(await readFile(store.file(ep, 'audio', 'shot-01.wav')))
    const s2 = decodeWav(await readFile(store.file(ep, 'audio', 'shot-02.wav')))
    expect(s1.channels[0]!.length).toBe(6 * SR)
    expect(s2.channels[0]!.length).toBe(4 * SR)
    const epw = decodeWav(await readFile(store.file(ep, 'audio', 'episode.wav')))
    expect(epw.channels[0]!.length).toBe((5 + 6 + 4 + 5) * SR)
    const info = JSON.parse(await readFile(store.file(ep, 'audio', 'episode.json'), 'utf8')) as { shots: Record<string, { start: number; duration: number }>; titleSec: number }
    expect(info.titleSec).toBe(5)
    expect(info.shots['shot-01']).toEqual({ start: 5, duration: 6 })
    expect(info.shots['shot-02']).toEqual({ start: 11, duration: 4 })
    let peak = 0
    for (const v of epw.channels[0]!) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeLessThanOrEqual(0.8913) // -1 dBFS ceiling
    expect(peak).toBeGreaterThan(0.2)
  })

  it('compile_tracks fails clearly when a shot has no actions file', async () => {
    await rm(store.file(ep, 'actions', 'shot-02.json'))
    await expect(handlers.get('compile_tracks')!(ctx())).rejects.toThrow(/actions\/shot-02\.json is missing/)
  })
})
