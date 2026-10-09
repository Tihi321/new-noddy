import { Biquad, SR, TAU, addInto, fadeInOut, midiToHz, samplesFor } from './dsp'
import { Rng, hashSeed } from './rng'

/** Music renderer: `music.json` cues and the theme jingle, from simple instrument synths. */

export type Instrument = 'music_box' | 'glockenspiel' | 'ukulele' | 'tuba' | 'xylophone' | 'recorder'

export interface NoteLike {
  /** note name ("C5", "F#4", "Bb3"), a MIDI number, or "r" for a rest */
  p: string | number
  /** length in beats */
  d: number
}

export interface MusicCueLike {
  id: string
  shots: string[]
  mood?: string
  instrument: Instrument | string
  tempo?: number
  melody: NoteLike[]
  bass?: NoteLike[]
  loop?: boolean
  gain?: number
}

export interface MusicLike {
  tempo: number
  key?: string
  theme: { instrument: Instrument | string; melody: NoteLike[]; bass?: NoteLike[] }
  cues: MusicCueLike[]
}

const SEMITONE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

/** Parses a note name or MIDI number. Returns null for a rest (or anything unparsable). */
export function parseNote(p: string | number): number | null {
  if (typeof p === 'number') return Number.isFinite(p) ? p : null
  const s = p.trim()
  if (s === '' || /^r(est)?$/i.test(s) || s === '-') return null
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)?$/.exec(s)
  if (!m) return null
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0
  const oct = m[3] === undefined ? 4 : Number(m[3])
  return 12 * (oct + 1) + SEMITONE[m[1]!.toLowerCase()]! + acc
}

const INSTRUMENT_GAIN: Record<string, number> = {
  music_box: 0.22,
  glockenspiel: 0.2,
  ukulele: 0.3,
  tuba: 0.27,
  xylophone: 0.24,
  recorder: 0.22
}

/** One note of an instrument. `dur` is the written length in seconds; the buffer includes the tail. */
export function noteVoice(instrument: string, midi: number, dur: number, rng: Rng): Float32Array {
  const f = midiToHz(midi)
  const g = INSTRUMENT_GAIN[instrument] ?? 0.4
  switch (instrument) {
    case 'music_box':
    case 'glockenspiel':
    case 'xylophone': {
      const spec =
        instrument === 'music_box'
          ? { partials: [[1, 1, 0.9], [2.76, 0.22, 0.25], [4.07, 0.08, 0.12]], tail: 1.4 }
          : instrument === 'glockenspiel'
            ? { partials: [[1, 1, 0.7], [2.76, 0.5, 0.35], [5.4, 0.3, 0.2], [8.9, 0.12, 0.1]], tail: 1.5 }
            : { partials: [[1, 1, 0.2], [3.0, 0.45, 0.07], [6.1, 0.2, 0.03]], tail: 0.6 }
      const n = samplesFor(spec.tail)
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const t = i / SR
        let v = 0
        for (const [ratio, amp, tau] of spec.partials as number[][]) v += amp! * Math.sin(TAU * f * ratio! * t) * Math.exp(-t / tau!)
        out[i] = v * g * Math.min(1, t / 0.0015)
      }
      return out
    }
    case 'ukulele': {
      const period = Math.max(2, Math.round(SR / f))
      const len = samplesFor(Math.min(1.8, Math.max(0.5, dur * 1.2 + 0.4)))
      const out = new Float32Array(len)
      const lp = new Biquad('lowpass', 3500, 0.6)
      const ring = new Float32Array(period + 1)
      for (let i = 0; i < ring.length; i++) ring[i] = lp.process(rng.signed())
      let idx = 0
      for (let i = 0; i < len; i++) {
        const a = ring[idx]!
        const b = ring[(idx + 1) % ring.length]!
        const y = 0.5 * (a + b) * 0.9965
        ring[idx] = y
        idx = (idx + 1) % ring.length
        out[i] = a * g * 1.4
      }
      return fadeInOut(out, 0.0, 0.05)
    }
    case 'tuba': {
      const len = samplesFor(dur + 0.12)
      const out = new Float32Array(len)
      let ph = 0
      const lp = new Biquad('lowpass', Math.min(900, f * 3.2), 0.9)
      const lp2 = new Biquad('lowpass', Math.min(1200, f * 4), 0.7)
      for (let i = 0; i < len; i++) {
        const t = i / SR
        ph += (f * (1 + 0.003 * Math.sin(TAU * 5 * t))) / SR
        const saw = 2 * (ph % 1) - 1
        const env = Math.min(1, t / 0.03) * (t < dur ? 1 - 0.15 * (t / dur) : Math.max(0, 1 - (t - dur) / 0.12))
        out[i] = lp2.process(lp.process(saw)) * env * g * 1.6
      }
      return out
    }
    case 'recorder': {
      const len = samplesFor(dur + 0.08)
      const out = new Float32Array(len)
      const bp = new Biquad('bandpass', Math.min(8000, f * 4), 1.2)
      for (let i = 0; i < len; i++) {
        const t = i / SR
        const vib = 1 + 0.006 * Math.sin(TAU * 5.2 * t) * Math.min(1, Math.max(0, (t - 0.2) / 0.3))
        const env = Math.min(1, t / 0.04) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.08))
        const tone = Math.sin(TAU * f * vib * t) + 0.14 * Math.sin(TAU * 2 * f * vib * t) + 0.05 * Math.sin(TAU * 3 * f * vib * t)
        out[i] = (tone + bp.process(rng.signed()) * 0.35) * env * g
      }
      return out
    }
    default:
      return noteVoice('music_box', midi, dur, rng)
  }
}

/** Renders a note line (looped to `totalSec` when asked) with one instrument. */
export function renderLine(notes: NoteLike[], instrument: string, tempo: number, totalSec: number, loop: boolean, seed: number): Float32Array {
  const out = new Float32Array(samplesFor(totalSec))
  const beat = 60 / Math.max(20, tempo)
  const clean = notes.filter((n) => Number.isFinite(n.d) && n.d > 0)
  const lineBeats = clean.reduce((s, n) => s + n.d, 0)
  if (clean.length === 0 || lineBeats <= 0) return out
  const rng = new Rng(hashSeed(seed, instrument))
  let t = 0
  let guard = 0
  while (t < totalSec && guard++ < 10000) {
    for (const n of clean) {
      if (t >= totalSec) break
      const midi = parseNote(n.p)
      const dur = n.d * beat
      if (midi !== null) {
        const v = noteVoice(instrument, midi, dur * 0.95, rng)
        addInto(out, v, Math.round(t * SR))
      }
      t += dur
    }
    if (!loop) break
  }
  return out
}

function renderVoices(melody: NoteLike[], bass: NoteLike[], instrument: string, tempo: number, totalSec: number, loop: boolean, seed: number): Float32Array {
  const out = renderLine(melody, instrument, tempo, totalSec, loop, seed)
  if (bass.length > 0) {
    const bassInstr = instrument === 'tuba' ? 'ukulele' : 'tuba'
    addInto(out, renderLine(bass, bassInstr, tempo, totalSec, loop, seed + 1), 0, 0.8)
  }
  return out
}

export interface ShotSpan {
  id: string
  /** seconds */
  duration: number
}

/**
 * Renders every cue across the shots it names and slices the result per shot.
 * A cue plays continuously over its (consecutive) shots; a shot without a cue is absent from the result.
 * If a shot is named by several cues the later cue is mixed in on top.
 */
export function renderMusic(music: MusicLike, shots: ShotSpan[]): Record<string, Float32Array> {
  const result: Record<string, Float32Array> = {}
  const spans = new Map(shots.map((s) => [s.id, s]))
  for (const cue of music.cues) {
    const members = cue.shots.map((id) => spans.get(id)).filter((s): s is ShotSpan => !!s)
    if (members.length === 0) continue
    const total = members.reduce((a, s) => a + s.duration, 0)
    const tempo = cue.tempo ?? music.tempo ?? 100
    const loop = cue.loop ?? true
    const line = renderVoices(cue.melody ?? [], cue.bass ?? [], String(cue.instrument), tempo, total, loop, hashSeed(cue.id, music.key ?? ''))
    const gain = cue.gain ?? 0.5
    for (let i = 0; i < line.length; i++) line[i] = line[i]! * gain
    fadeInOut(line, 0.02, Math.min(0.4, total * 0.2))
    let at = 0
    for (const s of members) {
      const n = samplesFor(s.duration)
      const seg = line.subarray(at, at + n)
      const dst = (result[s.id] ??= new Float32Array(n))
      addInto(dst, seg, 0)
      at += n
    }
  }
  return result
}

const DEFAULT_THEME: NoteLike[] = [
  { p: 'C5', d: 0.5 },
  { p: 'E5', d: 0.5 },
  { p: 'G5', d: 0.5 },
  { p: 'E5', d: 0.5 },
  { p: 'A5', d: 1 },
  { p: 'G5', d: 1 },
  { p: 'E5', d: 0.5 },
  { p: 'D5', d: 0.5 },
  { p: 'C5', d: 2 }
]

/** The theme jingle for the title and end cards, about `sec` seconds, with a soft tail. */
export function renderTheme(music: Pick<MusicLike, 'tempo' | 'theme'> | undefined, sec = 5): Float32Array {
  const theme = music?.theme
  const melody = theme?.melody?.length ? theme.melody : DEFAULT_THEME
  const instrument = theme?.melody?.length ? String(theme.instrument) : 'music_box'
  const tempo = music?.tempo ?? 100
  const out = renderVoices(melody, theme?.bass ?? [], instrument, tempo, sec, true, hashSeed('theme', instrument))
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * 0.9
  return fadeInOut(out, 0.01, 0.6)
}
