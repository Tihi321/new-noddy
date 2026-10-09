import { describe, expect, it } from 'vitest'
import { SR, peakOf } from '../../src/engine/audio/dsp'
import { syllabify, synthLine } from '../../src/engine/audio/mumble'
import { decodeWav, encodeWav } from '../../src/engine/audio/wav'
import { EMOTIONS } from '../../src/shared/episode'

const voice = { pitch: 1.2, speed: 1.1, timbre: 'bright' }
const text = 'Good morning, Bobbin! The van is all fixed now.'

describe('mumble voice', () => {
  it('is deterministic for the same inputs and differs with the seed', () => {
    const a = synthLine(text, voice, 'happy', 7)
    const b = synthLine(text, voice, 'happy', 7)
    expect(Buffer.from(a.samples.buffer).equals(Buffer.from(b.samples.buffer))).toBe(true)
    expect(a.levels).toEqual(b.levels)
    const c = synthLine(text, voice, 'happy', 8)
    expect(Buffer.from(a.samples.buffer).equals(Buffer.from(c.samples.buffer))).toBe(false)
  })

  it('level count is ceil(duration * 12), levels are 0, 1 or 2 and a line uses the open mouth', () => {
    for (const emotion of EMOTIONS) {
      const r = synthLine(text, voice, emotion, 1)
      expect(r.levels).toHaveLength(Math.ceil(r.duration * 12 - 1e-9))
      expect(r.levels.every((l) => l === 0 || l === 1 || l === 2)).toBe(true)
      expect(r.levels).toContain(2)
      expect(r.levels).toContain(0)
      expect(r.duration).toBeCloseTo(r.samples.length / SR, 6)
      expect(peakOf(r.samples)).toBeLessThanOrEqual(0.81)
      expect(Array.from(r.samples).every(Number.isFinite)).toBe(true)
    }
  })

  it('duration scales with text length and with speed', () => {
    const short = synthLine('Hello Tock.', voice, 'neutral', 1).duration
    const long = synthLine('Hello Tock, would you like to help me fix the clock tower today?', voice, 'neutral', 1).duration
    expect(long).toBeGreaterThan(short * 2)
    const slow = synthLine(text, { ...voice, speed: 0.7 }, 'neutral', 1).duration
    const fast = synthLine(text, { ...voice, speed: 1.6 }, 'neutral', 1).duration
    expect(slow).toBeGreaterThan(fast * 1.7)
  })

  it('keeps the syllable count of the words and emotions change the tempo', () => {
    expect(syllabify('banana', 1)).toHaveLength(3)
    expect(syllabify('Hello there, Tock!', 1)).toHaveLength(4)
    const sad = synthLine(text, voice, 'sad', 1).duration
    const excited = synthLine(text, voice, 'excited', 1).duration
    expect(sad).toBeGreaterThan(excited * 1.4)
  })

  it('every timbre produces sound, and laughter makes bursts', () => {
    for (const timbre of ['bright', 'warm', 'gruff', 'squeaky']) {
      const r = synthLine('Hello friend', { pitch: 1, speed: 1, timbre }, 'neutral', 3)
      expect(peakOf(r.samples)).toBeGreaterThan(0.5)
    }
    const laugh = synthLine('Ha ha ha!', voice, 'laugh', 1)
    expect(laugh.levels.filter((l) => l === 2).length).toBeGreaterThanOrEqual(3)
  })

  it('writes and reads 16-bit wav files', () => {
    const r = synthLine('Hello', voice, 'neutral', 1)
    const wav = decodeWav(encodeWav(r.samples))
    expect(wav.sampleRate).toBe(SR)
    expect(wav.channels).toHaveLength(1)
    expect(wav.channels[0]).toHaveLength(r.samples.length)
    expect(Math.abs(wav.channels[0]![5000]! - r.samples[5000]!)).toBeLessThan(1 / 16000)
    const st = decodeWav(encodeWav([r.samples, r.samples.map((x) => -x)]))
    expect(st.channels).toHaveLength(2)
    expect(st.channels[1]![5000]).toBeCloseTo(-st.channels[0]![5000]!, 3)
  })
})
