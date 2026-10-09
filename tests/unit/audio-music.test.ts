import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SR, peakOf, rmsOf } from '../../src/engine/audio/dsp'
import { parseNote, renderMusic, renderTheme } from '../../src/engine/audio/music'
import type { MusicLike } from '../../src/engine/audio/music'
import { SFX_LIBRARY, loadSfx, synthSfx } from '../../src/engine/audio/sfx'
import { writeWavFile } from '../../src/engine/audio/wav'
import { INSTRUMENTS, SFX_CUES } from '../../src/shared/episode'

const melody = [
  { p: 'C5', d: 1 },
  { p: 'E5', d: 1 },
  { p: 'r', d: 1 },
  { p: 67, d: 1 }
]

const music = (instrument: string): MusicLike => ({
  tempo: 120,
  key: 'C',
  theme: { instrument, melody, bass: [{ p: 'C3', d: 4 }] },
  cues: [
    { id: 'a', shots: ['s1', 's2'], mood: 'cheerful', instrument, tempo: 120, melody, bass: [{ p: 'C3', d: 4 }], loop: true, gain: 0.5 },
    { id: 'b', shots: ['s4'], mood: 'calm', instrument, tempo: 120, melody, bass: [], loop: false, gain: 0.5 }
  ]
})

describe('music', () => {
  it('parses note names, midi numbers and rests', () => {
    expect(parseNote('C4')).toBe(60)
    expect(parseNote('A4')).toBe(69)
    expect(parseNote('F#3')).toBe(54)
    expect(parseNote('Bb3')).toBe(58)
    expect(parseNote(72)).toBe(72)
    expect(parseNote('r')).toBeNull()
  })

  it('renders every instrument into per-shot segments of the exact shot length, looping across the cue shots', () => {
    const shots = [
      { id: 's1', duration: 3 },
      { id: 's2', duration: 5.5 },
      { id: 's3', duration: 2 },
      { id: 's4', duration: 8 }
    ]
    for (const instrument of INSTRUMENTS) {
      const out = renderMusic(music(instrument), shots)
      expect(Object.keys(out).sort()).toEqual(['s1', 's2', 's4'])
      expect(out.s1).toHaveLength(Math.round(3 * SR))
      expect(out.s2).toHaveLength(Math.round(5.5 * SR))
      expect(out.s4).toHaveLength(8 * SR)
      expect(Array.from(out.s1!).every(Number.isFinite)).toBe(true)
      expect(peakOf(out.s1!), instrument).toBeGreaterThan(0.03)
      expect(peakOf(out.s2!), instrument).toBeLessThan(1)
      // the looping cue is still playing near the end of its second shot, the one-shot cue has ended by the end of its shot
      expect(rmsOf(out.s2!, Math.round(3.5 * SR), Math.round(4.5 * SR)), instrument).toBeGreaterThan(0.003)
      expect(rmsOf(out.s4!, Math.round(6.5 * SR), 8 * SR), instrument).toBeLessThan(0.002)
    }
  })

  it('is deterministic', () => {
    const a = renderMusic(music('ukulele'), [{ id: 's1', duration: 2 }])
    const b = renderMusic(music('ukulele'), [{ id: 's1', duration: 2 }])
    expect(Buffer.from(a.s1!.buffer).equals(Buffer.from(b.s1!.buffer))).toBe(true)
  })

  it('renders a theme jingle of about five seconds, and a default one without a melody', () => {
    const t = renderTheme(music('music_box'))
    expect(t.length / SR).toBeCloseTo(5, 1)
    expect(peakOf(t)).toBeGreaterThan(0.05)
    expect(peakOf(t)).toBeLessThanOrEqual(1)
    expect(peakOf(renderTheme(undefined))).toBeGreaterThan(0.05)
  })
})

describe('sfx', () => {
  it('the library covers every cue in the contract', () => {
    expect([...SFX_LIBRARY].sort()).toEqual([...SFX_CUES].sort())
  })

  it('every cue makes finite, audible, unclipped, deterministic sound', () => {
    for (const cue of SFX_CUES) {
      const a = synthSfx(cue)
      expect(a.length, cue).toBeGreaterThan(SR * 0.05)
      expect(a.length, cue).toBeLessThan(SR * 4)
      expect(Array.from(a).every(Number.isFinite), cue).toBe(true)
      expect(peakOf(a), cue).toBeGreaterThan(0.5)
      expect(peakOf(a), cue).toBeLessThanOrEqual(0.801)
      expect(Buffer.from(a.buffer).equals(Buffer.from(synthSfx(cue).buffer)), cue).toBe(true)
    }
  })

  it('a wav in <data>/sfx wins over the synthesised cue', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'toybox-sfx-'))
    try {
      await mkdir(path.join(dir, 'sfx'))
      await writeWavFile(path.join(dir, 'sfx', 'pop.wav'), new Float32Array(SR / 10).fill(0.25))
      const got = await loadSfx('pop', dir)
      expect(got).toHaveLength(SR / 10)
      expect(got[100]).toBeCloseTo(0.25, 3)
      expect(await loadSfx('boing', dir)).toHaveLength(synthSfx('boing').length)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
