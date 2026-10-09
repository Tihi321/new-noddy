import { Biquad, SR, TAU, clamp, lerp, normalizePeak, rmsOf } from './dsp'
import { Rng, hashSeed } from './rng'

/**
 * Mumble voice: text becomes pseudo-syllables (same count and rhythm as the words), then a small formant synth
 * (glottal pulse source through three resonators, plus consonant noise bursts) sings them as playful gibberish.
 */

export type Timbre = 'bright' | 'warm' | 'gruff' | 'squeaky'

export interface Voice {
  pitch: number
  speed: number
  timbre: Timbre | string
}

export interface SynthResult {
  samples: Float32Array
  duration: number
  /** Mouth level per 12 fps frame: 0 closed, 1 mid, 2 open. Length is ceil(duration * 12). */
  levels: number[]
  sampleRate: number
}

export const MOUTH_FPS = 12

type OnsetType = 'none' | 'plosive' | 'fricative' | 'nasal' | 'liquid' | 'h'

interface Syllable {
  onset: OnsetType
  vowel: number[]
  long: boolean
  stressed: boolean
  /** index of this syllable in its clause and the clause length */
  pos: number
  clauseLen: number
  clauseEnd: '' | '?' | '!' | '.'
  last: boolean
  /** pause (seconds, before speed scaling) that follows */
  pauseAfter: number
}

const VOWELS: Record<string, number[]> = {
  a: [800, 1250, 2600],
  e: [480, 2000, 2700],
  i: [290, 2300, 3050],
  o: [500, 950, 2500],
  u: [330, 850, 2300],
  ae: [700, 1700, 2600],
  uh: [600, 1050, 2450],
  ou: [400, 1500, 2400]
}
const VOWEL_KEYS = Object.keys(VOWELS)
const LETTER_VOWEL: Record<string, string[]> = {
  a: ['a', 'a', 'ae'],
  e: ['e', 'e', 'ae'],
  i: ['i', 'i', 'e'],
  o: ['o', 'o', 'ou'],
  u: ['u', 'uh', 'ou'],
  y: ['i', 'e', 'i']
}

interface EmotionParams {
  rate: number
  pitch: number
  range: number
  amp: number
  glide: number
  vibrato: number
  breath: number
  staccato: number
}
const EMOTIONS: Record<string, EmotionParams> = {
  neutral: { rate: 1, pitch: 1, range: 0.12, amp: 1, glide: -0.03, vibrato: 0.004, breath: 0, staccato: 1 },
  happy: { rate: 1.08, pitch: 1.1, range: 0.22, amp: 1, glide: 0.03, vibrato: 0.006, breath: 0, staccato: 0.95 },
  excited: { rate: 1.25, pitch: 1.2, range: 0.32, amp: 1.1, glide: 0.08, vibrato: 0.008, breath: 0, staccato: 0.85 },
  sad: { rate: 0.8, pitch: 0.88, range: 0.07, amp: 0.8, glide: -0.09, vibrato: 0.008, breath: 0.04, staccato: 1.15 },
  worried: { rate: 1.02, pitch: 1.05, range: 0.16, amp: 0.95, glide: 0.0, vibrato: 0.03, breath: 0.02, staccato: 1 },
  angry: { rate: 1.05, pitch: 0.9, range: 0.1, amp: 1.15, glide: -0.05, vibrato: 0.003, breath: 0, staccato: 0.75 },
  surprised: { rate: 1.1, pitch: 1.15, range: 0.25, amp: 1.05, glide: 0.05, vibrato: 0.005, breath: 0, staccato: 0.9 },
  sleepy: { rate: 0.68, pitch: 0.85, range: 0.05, amp: 0.7, glide: -0.1, vibrato: 0.006, breath: 0.08, staccato: 1.25 },
  question: { rate: 1, pitch: 1.05, range: 0.15, amp: 1, glide: 0.02, vibrato: 0.005, breath: 0, staccato: 1 },
  laugh: { rate: 1, pitch: 1.1, range: 0.1, amp: 1, glide: 0, vibrato: 0.01, breath: 0.1, staccato: 1 }
}

interface TimbreParams {
  f0: number
  formant: number
  bw: number
  breath: number
  jitter: number
  f3: number
  openQ: number
  subharm: number
}
const TIMBRES: Record<string, TimbreParams> = {
  bright: { f0: 1.0, formant: 1.08, bw: 1, breath: 0.02, jitter: 0.004, f3: 0.5, openQ: 0.5, subharm: 0 },
  warm: { f0: 0.95, formant: 0.94, bw: 0.85, breath: 0.03, jitter: 0.003, f3: 0.2, openQ: 0.65, subharm: 0 },
  gruff: { f0: 0.78, formant: 0.92, bw: 1.3, breath: 0.07, jitter: 0.03, f3: 0.3, openQ: 0.45, subharm: 0.35 },
  squeaky: { f0: 1.35, formant: 1.25, bw: 1, breath: 0.015, jitter: 0.006, f3: 0.45, openQ: 0.5, subharm: 0 }
}

const BASE_F0 = 170

function onsetOf(ch: string | undefined): OnsetType {
  if (!ch) return 'none'
  if ('pbtdkgcq'.includes(ch)) return 'plosive'
  if ('fsvzxj'.includes(ch)) return 'fricative'
  if (ch === 'h') return 'h'
  if ('mn'.includes(ch)) return 'nasal'
  if ('lrwy'.includes(ch)) return 'liquid'
  return 'none'
}

/** Splits text into syllables that follow the vowel groups of the words. Exported for tests. */
export function syllabify(text: string, seed: number): Syllable[] {
  const rng = new Rng(hashSeed(seed, 'syl'))
  const words = text.split(/\s+/).filter(Boolean)
  const sylls: Syllable[] = []
  let clauseStart = 0
  const closeClause = (end: '' | '?' | '!' | '.') => {
    const len = sylls.length - clauseStart
    for (let i = clauseStart; i < sylls.length; i++) {
      sylls[i]!.pos = i - clauseStart
      sylls[i]!.clauseLen = len
      sylls[i]!.clauseEnd = end
    }
    if (len > 0) {
      const last = sylls[sylls.length - 1]!
      last.stressed = last.stressed || rng.chance(0.6)
    }
    clauseStart = sylls.length
  }
  for (const raw of words) {
    const punctMatch = /[.!?…,;:]+$/.exec(raw)
    const punct = punctMatch ? punctMatch[0] : ''
    const clean = raw
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[0-9]+/g, 'ono')
      .replace(/[^a-z]/g, '')
    const caps = raw.length > 1 && /[A-Z]/.test(raw) && raw === raw.toUpperCase() && /[A-Z]{2}/.test(raw)
    const before = sylls.length
    if (clean.length > 0) {
      const startAt = /^y[aeiou]/.test(clean) ? 1 : 0
      const re = /[aeiouy]+/g
      re.lastIndex = startAt
      const groups: { idx: number; text: string }[] = []
      let m: RegExpExecArray | null
      while ((m = re.exec(clean))) groups.push({ idx: m.index, text: m[0] })
      if (groups.length > 1) {
        const g = groups[groups.length - 1]!
        if (g.text === 'e' && g.idx === clean.length - 1 && g.idx > 0) groups.pop() // silent final e
      }
      if (groups.length === 0) {
        sylls.push({ onset: onsetOf(clean[0]), vowel: VOWELS[rng.chance(0.5) ? 'uh' : 'u']!, long: false, stressed: false, pos: 0, clauseLen: 1, clauseEnd: '', last: false, pauseAfter: 0 })
      }
      groups.forEach((g) => {
        const before1 = g.idx > 0 ? clean[g.idx - 1]! : ''
        const onsetCh = before1 && !'aeiouy'.includes(before1) ? before1 : undefined
        const lv = LETTER_VOWEL[g.text[0]!] ?? ['a']
        const key = rng.chance(0.25) ? rng.pick(VOWEL_KEYS) : rng.pick(lv)
        sylls.push({
          onset: onsetOf(onsetCh),
          vowel: VOWELS[key]!,
          long: g.text.length > 1,
          stressed: false,
          pos: 0,
          clauseLen: 1,
          clauseEnd: '',
          last: false,
          pauseAfter: 0
        })
      })
      const n = sylls.length - before
      if (n >= 2) sylls[before]!.stressed = true
      else if (caps || rng.chance(0.3)) sylls[before]!.stressed = true
      if (caps) for (let i = before; i < sylls.length; i++) sylls[i]!.stressed = true
    }
    if (punct) {
      const last = sylls[sylls.length - 1]
      const sentence = /[.!?…]/.test(punct)
      if (last && sylls.length > clauseStart) {
        last.pauseAfter = sentence ? 0.34 : 0.18
        if (sentence) {
          const end = punct.includes('?') ? '?' : punct.includes('!') ? '!' : '.'
          closeClause(end)
        }
      }
    }
  }
  closeClause('')
  if (sylls.length > 0) sylls[sylls.length - 1]!.last = true
  return sylls
}

class Resonator {
  private y1 = 0
  private y2 = 0
  private a1 = 0
  private a2 = 0
  private g = 1
  set(freq: number, bw: number): void {
    const r = Math.exp((-Math.PI * bw) / SR)
    this.a1 = 2 * r * Math.cos((TAU * clamp(freq, 80, 10000)) / SR)
    this.a2 = -r * r
    this.g = 1 - r
  }
  process(x: number): number {
    const y = this.g * x + this.a1 * this.y1 + this.a2 * this.y2
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

/** Glottal flow derivative for phase p in [0, 1). */
function glottal(p: number, oq: number): number {
  return p < oq ? 0.5 * (1 - Math.cos((Math.PI * p) / oq)) : Math.cos(((Math.PI / 2) * (p - oq)) / (1 - oq))
}

interface Renderer {
  push(n: number, fill: (i: number, u: number) => { f0: number; voice: number; breath: number; noise: number; noiseHp: number; formants: number[] }): void
  finish(): Float32Array
}

function makeRenderer(seed: number, timbre: TimbreParams, formantScale: number, emo: EmotionParams): Renderer {
  const rng = new Rng(hashSeed(seed, 'voice'))
  const out: number[] = []
  const res = [new Resonator(), new Resonator(), new Resonator()]
  const cur = [500, 1500, 2500]
  let phase = 0
  let periodGain = 1
  let periodJitter = 1
  let period = 0
  let prevG = 0
  let t = 0
  let counter = 0
  const smooth = 1 - Math.exp(-1 / (0.018 * SR))
  const nzHp = new Biquad('highpass', 4200, 0.8)
  const nzBand = new Biquad('bandpass', 2400, 1.2)
  const bws = [90, 120, 190]
  return {
    push(n, fill) {
      for (let i = 0; i < n; i++) {
        const s = fill(i, n > 1 ? i / (n - 1) : 0)
        for (let k = 0; k < 3; k++) cur[k] = cur[k]! + (s.formants[k]! * formantScale - cur[k]!) * smooth
        if (counter++ % 24 === 0) for (let k = 0; k < 3; k++) res[k]!.set(cur[k]!, bws[k]! * timbre.bw)
        const vib = 1 + emo.vibrato * Math.sin(TAU * 5.4 * t) + periodJitter - 1
        phase += (s.f0 * vib) / SR
        if (phase >= 1) {
          phase -= 1
          period++
          periodJitter = 1 + timbre.jitter * rng.signed()
          periodGain = timbre.subharm > 0 && period % 2 === 1 ? 1 - timbre.subharm : 1
        }
        const g = glottal(phase, timbre.openQ)
        const d = (g - prevG) * 25
        prevG = g
        const white = rng.signed()
        const src = d * periodGain * s.voice + white * (s.breath + timbre.breath * s.voice + emo.breath * s.voice)
        let y = res[0]!.process(src) * 1.0 + res[1]!.process(src) * 0.7 + res[2]!.process(src) * timbre.f3
        y *= 3.2
        if (s.noise > 0) y += nzBand.process(white) * s.noise
        if (s.noiseHp > 0) y += nzHp.process(white) * s.noiseHp
        out.push(y)
        t += 1 / SR
      }
    },
    finish() {
      return Float32Array.from(out)
    }
  }
}

/** Levels (0/1/2) per 12 fps frame from the RMS envelope of the samples. */
export function levelsFromSamples(samples: Float32Array, fps = MOUTH_FPS): number[] {
  const duration = samples.length / SR
  const n = Math.max(0, Math.ceil(duration * fps - 1e-9))
  const rms: number[] = []
  for (let k = 0; k < n; k++) {
    const a = Math.floor((k / fps) * SR)
    const b = Math.min(samples.length, Math.floor(((k + 1) / fps) * SR))
    rms.push(rmsOf(samples, a, b))
  }
  const sorted = [...rms].sort((x, y) => x - y)
  const ref = sorted.length ? Math.max(sorted[Math.floor(sorted.length * 0.85)]!, 1e-4) : 1
  return rms.map((v) => {
    if (v < 0.004) return 0
    const r = v / ref
    return r >= 0.62 ? 2 : r >= 0.2 ? 1 : 0
  })
}

export function synthLine(text: string, voice: Voice, emotion: string, seed: number | string = 0): SynthResult {
  const seedN = typeof seed === 'number' ? seed : hashSeed(seed)
  const emo = EMOTIONS[emotion] ?? EMOTIONS.neutral!
  const timbre = TIMBRES[voice.timbre] ?? TIMBRES.bright!
  const pitch = clamp(voice.pitch || 1, 0.4, 2.5)
  const speed = clamp(voice.speed || 1, 0.4, 2.5)
  const rate = speed * emo.rate
  const f0Base = BASE_F0 * pitch * timbre.f0 * emo.pitch
  const formantScale = timbre.formant * Math.pow(pitch, 0.25)
  const rng = new Rng(hashSeed(seedN, 'line'))
  const r = makeRenderer(seedN, timbre, formantScale, emo)
  const lead = 0.03
  const tail = 0.09
  r.push(Math.round(lead * SR), () => ({ f0: f0Base, voice: 0, breath: 0, noise: 0, noiseHp: 0, formants: VOWELS.a! }))

  const pushPause = (sec: number) => {
    const n = Math.round((sec / rate) * SR)
    r.push(n, () => ({ f0: f0Base, voice: 0, breath: 0, noise: 0, noiseHp: 0, formants: VOWELS.u! }))
  }

  if (emotion === 'laugh') {
    const count = clamp(syllabify(text, seedN).length, 3, 9)
    for (let b = 0; b < count; b++) {
      const f = f0Base * (1.35 - (0.5 * b) / count) * (1 + 0.05 * rng.signed())
      const hN = Math.round((0.045 / rate) * SR)
      const vN = Math.round((0.1 / rate) * SR)
      r.push(hN, (_, u) => ({ f0: f, voice: 0.0, breath: 1.4 * (1 - u * 0.2), noise: 0, noiseHp: 0, formants: VOWELS.a! }))
      r.push(vN, (_, u) => {
        const env = Math.min(1, u * 8) * (1 - u * 0.5) * (u > 0.85 ? (1 - u) / 0.15 : 1)
        return { f0: lerp(f * 1.05, f * 0.88, u), voice: env, breath: 0.12 * env, noise: 0, noiseHp: 0, formants: VOWELS.a! }
      })
      pushPause(0.07 + 0.03 * rng.float())
    }
  } else {
    const sylls = syllabify(text, seedN)
    sylls.forEach((s, idx) => {
      const stress = s.stressed ? 1 : 0
      const vDur = (0.115 * (s.long ? 1.25 : 1) * (1 + 0.28 * stress) * emo.staccato * (0.9 + 0.2 * rng.float())) / rate
      const onsetDur =
        (s.onset === 'plosive' ? 0.05 : s.onset === 'fricative' ? 0.075 : s.onset === 'h' ? 0.05 : s.onset === 'none' ? 0 : 0.055) / rate
      const prog = s.clauseLen > 1 ? s.pos / (s.clauseLen - 1) : 0
      const wander = 0.5 * Math.sin(idx * 1.9 + seedN * 0.001) + 0.5 * rng.signed()
      let mult = 1 + emo.range * wander - 0.1 * prog + 0.1 * stress
      let glide = emo.glide + 0.05 * stress
      const fromEnd = s.clauseLen - 1 - s.pos
      const questionish = s.clauseEnd === '?' || (emotion === 'question' && s.clauseEnd === '')
      if (questionish && fromEnd <= 2) {
        const ramp = (2 - fromEnd + 1) / 3
        mult *= 1 + 0.22 * ramp
        if (fromEnd === 0) glide = 0.3
      } else if (s.clauseEnd === '!' && fromEnd === 0) {
        mult *= 1.08
        glide = 0.02
      } else if (s.clauseEnd === '.' && fromEnd === 0) {
        glide = Math.min(glide, -0.1)
      }
      if (emotion === 'surprised' && ((idx === 0) || (s.stressed && s.pos <= 1) || s.last)) glide = 0.45
      const f0 = f0Base * mult
      const amp = emo.amp * (s.stressed ? 1 : 0.82) * (0.9 + 0.1 * rng.float())
      const onsetN = Math.round(onsetDur * SR)
      const vowelN = Math.round(vDur * SR)
      const onsetFormants = s.onset === 'nasal' ? [270, 1000, 2300] : s.onset === 'liquid' ? [380, 1250, 2400] : s.vowel
      const total = onsetN + vowelN
      const f0At = (i: number) => lerp(f0 * (1 - glide / 2), f0 * (1 + glide / 2), total > 1 ? i / (total - 1) : 0)
      if (onsetN > 0) {
        r.push(onsetN, (i, u) => {
          const f = f0At(i)
          switch (s.onset) {
            case 'plosive': {
              const burst = u > 0.6 ? Math.exp(-(u - 0.6) * 9) * 0.8 : 0
              return { f0: f, voice: 0.12, breath: 0, noise: burst * 0.55, noiseHp: burst * 0.35, formants: s.vowel }
            }
            case 'fricative':
              return { f0: f, voice: 0.15 * amp, breath: 0, noise: 0.1, noiseHp: 0.55 * Math.sin(Math.PI * Math.min(1, u * 1.1)), formants: s.vowel }
            case 'h':
              return { f0: f, voice: 0, breath: 1.2 * amp, noise: 0, noiseHp: 0, formants: s.vowel }
            default:
              return { f0: f, voice: 0.55 * amp * Math.min(1, u * 6), breath: 0, noise: 0, noiseHp: 0, formants: onsetFormants }
          }
        })
      }
      r.push(vowelN, (i, u) => {
        const atk = Math.min(1, (i / SR) / 0.012)
        const rel = Math.min(1, ((vowelN - i) / SR) / 0.03)
        const env = atk * rel * (1 - 0.22 * u) * amp
        return { f0: f0At(onsetN + i), voice: env, breath: emo.breath * env * 0.5, noise: 0, noiseHp: 0, formants: s.vowel }
      })
      if (s.pauseAfter > 0) pushPause(s.pauseAfter)
      else if (s.last) pushPause(0.01)
      else pushPause(0.025 + (s.stressed ? 0 : 0.01))
    })
  }
  r.push(Math.round(tail * SR), () => ({ f0: f0Base, voice: 0, breath: 0, noise: 0, noiseHp: 0, formants: VOWELS.u! }))

  const samples = r.finish()
  // remove DC drift and normalise
  let mean = 0
  for (let i = 0; i < samples.length; i++) mean += samples[i]!
  mean /= Math.max(1, samples.length)
  for (let i = 0; i < samples.length; i++) samples[i] = samples[i]! - mean
  normalizePeak(samples, 0.8)
  const duration = samples.length / SR
  const levels = levelsFromSamples(samples)
  return { samples, duration, levels, sampleRate: SR }
}
