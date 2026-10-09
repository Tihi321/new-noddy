import { SR, addInto, clamp, dbToGain, fadeInOut, gainToDb, peakOf, rmsOf, samplesFor, softLimit } from './dsp'

/** Shot and episode mixing: dialogue, SFX, ducked music, soft limiter, loudness. */

export interface MixEvent {
  frame: number
  kind: string
  lineId?: string
  actor?: string
  cue?: string
  gain?: number
}

export interface MixShotInput {
  frames: number
  fps: number
  events: MixEvent[]
  /** voice wavs by line id (mono 44.1 kHz) */
  lines: Record<string, Float32Array>
  /** sfx buffers by cue name */
  sfx: Record<string, Float32Array>
  /** the music segment for this shot (any length, it is trimmed or padded to the shot) */
  music?: Float32Array
}

export const DUCK_DB = -9
export const DUCK_ATTACK_SEC = 0.08
export const DUCK_RELEASE_SEC = 0.25
export const LINE_GAIN = 0.9
export const SFX_GAIN = 0.55
export const MUSIC_GAIN = 0.8
export const TARGET_RMS_DB = -14
/** Limiter ceiling of the final episode mix: -1 dBFS, so AAC encoding and inter-sample peaks stay clean. */
export const CEILING_DB = -1
export const CEILING = dbToGain(CEILING_DB)
export const TITLE_CARD_SEC = 5
export const END_CARD_SEC = 5
/** Version of the `audio/episode.json` layout sidecar. */
export const EPISODE_AUDIO_VERSION = 1

/** Exact sample count of a shot: frames / fps seconds. */
export const shotSamples = (frames: number, fps: number): number => Math.round((frames / fps) * SR)

/** The mix of one shot. Its length is exactly frames / fps seconds. */
export function mixShot(input: MixShotInput): Float32Array {
  const n = shotSamples(input.frames, input.fps)
  const dialogue = new Float32Array(n)
  const effects = new Float32Array(n)
  const talking = new Float32Array(n) // 1 where a line speaks
  for (const ev of input.events) {
    const at = Math.round((ev.frame / input.fps) * SR)
    if (ev.kind === 'line' && ev.lineId) {
      const wav = input.lines[ev.lineId]
      if (!wav) continue
      addInto(dialogue, wav, at, LINE_GAIN)
      for (let i = Math.max(0, at); i < Math.min(n, at + wav.length); i++) talking[i] = 1
    } else if (ev.kind === 'sfx' && ev.cue) {
      const wav = input.sfx[ev.cue]
      if (!wav) continue
      const gain = SFX_GAIN * (ev.gain ?? 0.8)
      const clipped = wav.slice(0, Math.max(0, n - at))
      if (clipped.length < wav.length) fadeInOut(clipped, 0, 0.03) // a cue cut by the shot end does not click
      addInto(effects, clipped, at, gain)
    }
  }

  const out = new Float32Array(n)
  const duck = dbToGain(DUCK_DB)
  const atk = 1 - Math.exp(-1 / (DUCK_ATTACK_SEC * SR))
  const rel = 1 - Math.exp(-1 / (DUCK_RELEASE_SEC * SR))
  let g = 1
  const music = input.music
  for (let i = 0; i < n; i++) {
    const target = talking[i]! > 0 ? duck : 1
    g += (target - g) * (target < g ? atk : rel)
    const m = music && i < music.length ? music[i]! * MUSIC_GAIN * g : 0
    out[i] = softLimit(dialogue[i]! + effects[i]! + m)
  }
  return out
}

export interface EpisodeShotMix {
  id: string
  wav: Float32Array
  transitionIn?: string
  transitionOut?: string
}

export interface EpisodeMixInput {
  shots: EpisodeShotMix[]
  /** theme jingle for the title card (trimmed / padded to titleSec) */
  title?: Float32Array
  /** theme jingle for the end card */
  end?: Float32Array
  titleSec?: number
  endSec?: number
  targetRmsDb?: number
}

export interface EpisodeMix {
  samples: Float32Array
  /** start time (seconds) of every shot in the episode wav */
  shotStarts: Record<string, number>
  titleSec: number
  endStart: number
  endSec: number
  duration: number
}

const edgeFade = (kind: string | undefined): number => (kind === 'fade' ? 0.5 : kind === 'iris_in' || kind === 'iris_out' ? 0.3 : 0.006)

/** RMS of the non-silent 400 ms blocks (a cheap stand-in for gated loudness). */
export function gatedRmsDb(x: Float32Array): number {
  const block = Math.round(0.4 * SR)
  const gate = dbToGain(-50)
  let sum = 0
  let count = 0
  for (let a = 0; a < x.length; a += block) {
    const b = Math.min(x.length, a + block)
    const r = rmsOf(x, a, b)
    if (r > gate) {
      sum += r * r
      count++
    }
  }
  return count === 0 ? -120 : gainToDb(Math.sqrt(sum / count))
}

/**
 * Joins title jingle, shot mixes and end jingle, fades the transitions, normalises to about -14 dB (gated RMS,
 * a loudness stand-in) and soft limits to a -1 dBFS ceiling. Shots keep their exact durations, so the audio lines up with the video.
 */
export function mixEpisode(input: EpisodeMixInput): EpisodeMix {
  const titleSec = input.titleSec ?? TITLE_CARD_SEC
  const endSec = input.endSec ?? END_CARD_SEC
  const titleN = samplesFor(titleSec)
  const endN = samplesFor(endSec)
  const shotsN = input.shots.reduce((a, s) => a + s.wav.length, 0)
  const total = titleN + shotsN + endN
  const out = new Float32Array(total)
  const shotStarts: Record<string, number> = {}

  if (input.title) addInto(out, fadeInOut(input.title.slice(0, titleN), 0.01, 0.3), 0)
  let at = titleN
  for (const s of input.shots) {
    const w = s.wav.slice()
    const inF = Math.min(edgeFade(s.transitionIn), w.length / 3 / SR)
    const outF = Math.min(edgeFade(s.transitionOut), w.length / 3 / SR)
    fadeInOut(w, inF, outF)
    shotStarts[s.id] = at / SR
    addInto(out, w, at)
    at += w.length
  }
  const endStart = at
  if (input.end) addInto(out, fadeInOut(input.end.slice(0, endN), 0.01, 0.5), endStart)

  const target = input.targetRmsDb ?? TARGET_RMS_DB
  const rmsDb = gatedRmsDb(out)
  if (rmsDb > -100) {
    const peak = Math.max(peakOf(out), 1e-6)
    const gain = Math.min(dbToGain(target - rmsDb), 1.5 / peak, 6)
    const g = clamp(gain, 0.1, 6)
    for (let i = 0; i < total; i++) out[i] = softLimit(out[i]! * g, 0.75, CEILING)
  }
  return { samples: out, shotStarts, titleSec, endStart: endStart / SR, endSec, duration: total / SR }
}
