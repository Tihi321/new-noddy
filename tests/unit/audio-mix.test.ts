import { describe, expect, it } from 'vitest'
import { SR, dbToGain, peakOf, rmsOf, softLimit } from '../../src/engine/audio/dsp'
import { gatedRmsDb, mixEpisode, mixShot } from '../../src/engine/audio/mix'
import { synthLine } from '../../src/engine/audio/mumble'
import { renderMusic, renderTheme } from '../../src/engine/audio/music'
import { synthSfx } from '../../src/engine/audio/sfx'

const voice = { pitch: 1.1, speed: 1, timbre: 'warm' }
const melody = [
  { p: 'C5', d: 1 },
  { p: 'E5', d: 1 },
  { p: 'G5', d: 2 }
]
const music = {
  tempo: 100,
  key: 'C',
  theme: { instrument: 'music_box', melody, bass: [] },
  cues: [{ id: 'c', shots: ['s1'], mood: 'cheerful', instrument: 'recorder', tempo: 100, melody, bass: [], loop: true, gain: 0.6 }]
}

describe('mixShot', () => {
  const line = synthLine('Good morning, Bobbin!', voice, 'happy', 1).samples
  const seg = renderMusic(music, [{ id: 's1', duration: 6 }]).s1!

  it('is exactly frames / fps seconds long, whatever the inputs', () => {
    for (const frames of [1, 7, 72, 145]) {
      const out = mixShot({
        frames,
        fps: 12,
        events: [
          { frame: 0, kind: 'line', lineId: 'L1' },
          { frame: Math.max(0, frames - 2), kind: 'sfx', cue: 'boing' }
        ],
        lines: { L1: line },
        sfx: { boing: synthSfx('boing') },
        music: seg
      })
      expect(out).toHaveLength(Math.round((frames / 12) * SR))
    }
  })

  it('has no clipping even with everything at once', () => {
    const sfx = { horn_parp: synthSfx('horn_parp'), splash: synthSfx('splash'), ta_da: synthSfx('ta_da') }
    const events = [
      { frame: 0, kind: 'line', lineId: 'L1' },
      { frame: 0, kind: 'line', lineId: 'L1' },
      { frame: 2, kind: 'sfx', cue: 'horn_parp', gain: 1 },
      { frame: 3, kind: 'sfx', cue: 'splash', gain: 1 },
      { frame: 3, kind: 'sfx', cue: 'ta_da', gain: 1 }
    ]
    const out = mixShot({ frames: 72, fps: 12, events, lines: { L1: line }, sfx, music: seg.map((x) => x * 3) })
    expect(peakOf(out)).toBeLessThanOrEqual(1)
    expect(Array.from(out).every(Number.isFinite)).toBe(true)
    expect(peakOf(out)).toBeGreaterThan(0.3)
  })

  it('ducks the music by about 9 dB under dialogue and brings it back afterwards', () => {
    const steady = new Float32Array(6 * SR)
    for (let i = 0; i < steady.length; i++) steady[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / SR)
    const quiet = new Float32Array(SR) // a silent line still counts as a talking span
    const out = mixShot({ frames: 72, fps: 12, events: [{ frame: 24, kind: 'line', lineId: 'quiet' }], lines: { quiet }, sfx: {}, music: steady })
    const before = rmsOf(out, SR * 0.5, SR * 1.5)
    const during = rmsOf(out, Math.round(2.4 * SR), Math.round(2.9 * SR))
    const after = rmsOf(out, Math.round(5.5 * SR), 6 * SR)
    const db = 20 * Math.log10(during / before)
    expect(db).toBeLessThan(-7.5)
    expect(db).toBeGreaterThan(-10.5)
    expect(after / before).toBeGreaterThan(0.95)
  })

  it('places a line at its event frame', () => {
    const out = mixShot({ frames: 36, fps: 12, events: [{ frame: 12, kind: 'line', lineId: 'L1' }], lines: { L1: line }, sfx: {} })
    expect(peakOf(out.subarray(0, SR - 10))).toBe(0)
    expect(peakOf(out.subarray(SR, SR + 4000))).toBeGreaterThan(0.01)
  })
})

describe('mixEpisode', () => {
  it('joins title, shots and end, keeps shot durations, fades transitions and normalises without clipping', () => {
    const line = synthLine('Hello Tock, hello hello!', voice, 'excited', 2).samples
    const shotA = mixShot({
      frames: 48,
      fps: 12,
      events: [{ frame: 4, kind: 'line', lineId: 'L' }],
      lines: { L: line },
      sfx: {},
      music: renderMusic(music, [{ id: 's1', duration: 4 }]).s1
    })
    const shotB = mixShot({ frames: 36, fps: 12, events: [{ frame: 0, kind: 'sfx', cue: 'pop', gain: 1 }], lines: {}, sfx: { pop: synthSfx('pop') } })
    const jingle = renderTheme(music)
    const ep = mixEpisode({
      shots: [
        { id: 'shot-01', wav: shotA, transitionIn: 'fade', transitionOut: 'cut' },
        { id: 'shot-02', wav: shotB, transitionOut: 'fade' }
      ],
      title: jingle,
      end: jingle
    })
    expect(ep.samples).toHaveLength(5 * SR + shotA.length + shotB.length + 5 * SR)
    expect(ep.duration).toBeCloseTo(17, 3)
    expect(ep.shotStarts['shot-01']).toBeCloseTo(5, 6)
    expect(ep.shotStarts['shot-02']).toBeCloseTo(9, 6)
    expect(ep.endStart).toBeCloseTo(12, 6)
    expect(peakOf(ep.samples)).toBeLessThanOrEqual(dbToGain(-1) + 1e-6) // -1 dBFS ceiling
    expect(Array.from(ep.samples).every(Number.isFinite)).toBe(true)
    expect(gatedRmsDb(ep.samples)).toBeGreaterThan(-18)
    expect(gatedRmsDb(ep.samples)).toBeLessThan(-11)
    expect(Math.abs(ep.samples[5 * SR]!)).toBeLessThan(0.01) // faded in
  })

  it('works with no jingles and no shots', () => {
    expect(mixEpisode({ shots: [] }).samples).toHaveLength(10 * SR)
  })
})

describe('limiter ceiling', () => {
  it('softLimit never reaches its ceiling, even for a huge input', () => {
    const c = dbToGain(-1)
    expect(Math.abs(softLimit(50, 0.75, c))).toBeLessThanOrEqual(c)
    expect(Math.abs(softLimit(-50, 0.75, c))).toBeLessThanOrEqual(c)
    expect(softLimit(0.5, 0.75, c)).toBe(0.5)
  })
  it('a hot episode mix stays under -1 dBFS and near the target loudness', () => {
    const loud = new Float32Array(SR * 6)
    for (let i = 0; i < loud.length; i++) loud[i] = 1.4 * Math.sin((2 * Math.PI * 220 * i) / SR)
    const ep = mixEpisode({ shots: [{ id: 's', wav: loud }], titleSec: 1, endSec: 1 })
    expect(peakOf(ep.samples)).toBeLessThanOrEqual(dbToGain(-1))
    expect(gatedRmsDb(ep.samples)).toBeGreaterThan(-18)
  })
})
