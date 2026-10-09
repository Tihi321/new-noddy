import { existsSync } from 'node:fs'
import path from 'node:path'
import { Biquad, SR, TAU, addInto, fadeInOut, filterInPlace, midiToHz, normalizePeak, samplesFor } from './dsp'
import { Rng, hashSeed } from './rng'
import { readWavFile, toMono44k } from './wav'

/** Synthesised sound effects for every cue in the contract, plus the optional `<data>/sfx/<cue>.wav` override. */

type Gen = (rng: Rng) => Float32Array

const buf = (sec: number): Float32Array => new Float32Array(samplesFor(sec))
const exp = (t: number, tau: number): number => Math.exp(-t / tau)

/** A decaying sine ping with optional inharmonic partials, added into `out` at `at` seconds. */
function ping(out: Float32Array, at: number, freq: number, amp: number, tau: number, partials: [number, number][] = []): void {
  const start = samplesFor(at)
  const n = Math.min(out.length - start, samplesFor(tau * 6))
  for (let i = 0; i < n; i++) {
    const t = i / SR
    let v = Math.sin(TAU * freq * t)
    for (const [ratio, a] of partials) v += a * Math.sin(TAU * freq * ratio * t) * exp(t, tau * 0.5)
    const atk = Math.min(1, t / 0.002)
    out[start + i] = out[start + i]! + v * amp * exp(t, tau) * atk
  }
}

/** Noise burst through a band/low/high filter with exponential decay. */
function noiseBurst(out: Float32Array, rng: Rng, at: number, sec: number, tau: number, amp: number, type: 'lowpass' | 'highpass' | 'bandpass', freq: number, q = 0.8): void {
  const start = samplesFor(at)
  const n = Math.min(out.length - start, samplesFor(sec))
  const f = new Biquad(type, freq, q)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    out[start + i] = out[start + i]! + f.process(rng.signed()) * amp * exp(t, tau) * Math.min(1, t / 0.001)
  }
}

/** A tone with a frequency curve, shaped by an amplitude function. */
function sweep(out: Float32Array, at: number, sec: number, freqAt: (u: number) => number, ampAt: (u: number) => number, shape: 'sine' | 'saw' | 'square' = 'sine'): void {
  const start = samplesFor(at)
  const n = Math.min(out.length - start, samplesFor(sec))
  let ph = 0
  for (let i = 0; i < n; i++) {
    const u = i / Math.max(1, n - 1)
    ph += freqAt(u) / SR
    const p = ph % 1
    const v = shape === 'sine' ? Math.sin(TAU * p) : shape === 'saw' ? 2 * p - 1 : p < 0.5 ? 1 : -1
    out[start + i] = out[start + i]! + v * ampAt(u)
  }
}

const GENERATORS: Record<string, Gen> = {
  bell_jingle: (rng) => {
    const out = buf(1.9)
    const notes = [84, 88, 91, 96, 91, 96]
    notes.forEach((m, i) => ping(out, i * 0.095 + rng.range(0, 0.008), midiToHz(m), 0.32, 0.35, [[2.76, 0.35], [5.4, 0.15]]))
    return out
  },
  horn_parp: () => {
    const out = buf(0.75)
    const note = (at: number, f: number, sec: number) => {
      const tmp = buf(0.75)
      sweep(tmp, at, sec, (u) => f * (1 + 0.06 * Math.exp(-u * 14)), (u) => Math.min(1, u * 12) * Math.min(1, (1 - u) * 10) * 0.5, 'saw')
      addInto(out, filterInPlace(tmp, 'lowpass', f * 3.2, 1.4), 0)
    }
    note(0.02, 392, 0.2)
    note(0.3, 330, 0.3)
    return out
  },
  squeak_step: (rng) => {
    const out = buf(0.14)
    const f0 = rng.range(1100, 1500)
    sweep(out, 0, 0.12, (u) => f0 * (1 + 0.9 * u) * (1 + 0.04 * Math.sin(u * 40)), (u) => Math.sin(Math.PI * Math.min(1, u * 1.1)) * 0.5)
    return out
  },
  boing: () => {
    const out = buf(0.85)
    sweep(out, 0, 0.8, (u) => 180 + 260 * Math.exp(-u * 3) * (1 + 0.55 * Math.sin(u * 62 * (1 - u * 0.4))), (u) => Math.min(1, u * 40) * Math.exp(-u * 4.5) * 0.7)
    return out
  },
  door_knock: (rng) => {
    const out = buf(0.8)
    ;[0.02, 0.24, 0.43].forEach((at) => {
      const f = rng.range(150, 190)
      ping(out, at, f, 0.8, 0.045, [[1.9, 0.3]])
      noiseBurst(out, rng, at, 0.05, 0.012, 0.5, 'lowpass', 900)
    })
    return out
  },
  door_open: (rng) => {
    const out = buf(1.1)
    const raw = buf(1.1)
    let wob = 0
    sweep(raw, 0.02, 1.0, (u) => {
      wob += rng.signed() * 6
      return 140 + 140 * Math.sin(Math.PI * u * 0.9) + wob * 0.2 + 25 * Math.sin(u * 90)
    }, (u) => Math.sin(Math.PI * u) * 0.5, 'saw')
    filterInPlace(raw, 'bandpass', 520, 3.5)
    addInto(out, raw, 0, 2.2)
    noiseBurst(out, rng, 0.0, 0.08, 0.02, 0.2, 'lowpass', 600)
    return out
  },
  birds: (rng) => {
    const out = buf(2.2)
    let t = 0.1
    while (t < 1.9) {
      const group = 2 + rng.int(3)
      const base = rng.range(2600, 4200)
      for (let g = 0; g < group; g++) {
        const dir = rng.chance(0.5) ? 1 : -1
        sweep(out, t, 0.07, (u) => base * (1 + dir * 0.35 * u + 0.08 * Math.sin(u * 30)), (u) => Math.sin(Math.PI * u) * 0.22)
        t += 0.1
      }
      t += rng.range(0.25, 0.5)
    }
    return out
  },
  wind: (rng) => {
    const n = samplesFor(3.2)
    const out = new Float32Array(n)
    const bp = new Biquad('bandpass', 600, 1.0)
    for (let i = 0; i < n; i++) {
      const u = i / n
      const t = i / SR
      bp.set('bandpass', 380 + 420 * (0.5 + 0.5 * Math.sin(TAU * 0.4 * t)) + 150 * Math.sin(TAU * 0.13 * t + 1), 1.2)
      out[i] = bp.process(rng.signed()) * (0.5 + 0.5 * Math.sin(TAU * 0.3 * t + 0.5)) * Math.sin(Math.PI * u) * 1.8
    }
    return out
  },
  splash: (rng) => {
    const out = buf(1.1)
    noiseBurst(out, rng, 0, 0.5, 0.12, 0.9, 'bandpass', 1800, 0.6)
    noiseBurst(out, rng, 0.02, 0.9, 0.3, 0.45, 'lowpass', 700)
    for (let i = 0; i < 9; i++) {
      const at = 0.08 + rng.range(0, 0.7)
      const f = rng.range(500, 1100)
      sweep(out, at, 0.06, (u) => f * (1 + u * 1.2), (u) => Math.sin(Math.PI * u) * 0.12)
    }
    return out
  },
  pop: (rng) => {
    const out = buf(0.14)
    sweep(out, 0, 0.07, (u) => 900 * Math.exp(-u * 2.2), (u) => Math.exp(-u * 5) * 0.9)
    noiseBurst(out, rng, 0, 0.02, 0.004, 0.4, 'highpass', 2500)
    return out
  },
  whistle: (rng) => {
    const out = buf(0.9)
    sweep(out, 0, 0.8, (u) => 2000 + 700 * Math.sin(Math.PI * Math.min(1, u * 1.3)) * 0.8 + 35 * Math.sin(u * 140), (u) => Math.min(1, u * 14) * Math.min(1, (1 - u) * 8) * 0.4)
    const breath = buf(0.9)
    noiseBurst(breath, rng, 0, 0.8, 0.5, 0.12, 'bandpass', 2600, 4)
    addInto(out, breath, 0)
    return out
  },
  clock_tick: (rng) => {
    const out = buf(1.1)
    ;[0.02, 0.52].forEach((at, i) => {
      noiseBurst(out, rng, at, 0.03, 0.005, 0.8, 'bandpass', i === 0 ? 3200 : 2400, 2)
      ping(out, at, i === 0 ? 1500 : 1100, 0.35, 0.012)
    })
    return out
  },
  twinkle: (rng) => {
    const out = buf(1.5)
    const m = [84, 88, 91, 95, 100]
    m.forEach((n, i) => ping(out, i * 0.09 + rng.range(0, 0.01), midiToHz(n), 0.28, 0.3, [[2.76, 0.2], [4.1, 0.1]]))
    return out
  },
  soft_crash: (rng) => {
    const out = buf(1.2)
    noiseBurst(out, rng, 0, 0.8, 0.18, 0.9, 'lowpass', 1400)
    for (let i = 0; i < 5; i++) {
      const at = i * 0.08 + rng.range(0, 0.04)
      ping(out, at, rng.range(90, 220), 0.5 * (1 - i * 0.12), 0.07, [[1.5, 0.4]])
    }
    noiseBurst(out, rng, 0.3, 0.7, 0.2, 0.25, 'bandpass', 2500, 0.7)
    return out
  },
  engine_putter: (rng) => {
    const out = buf(1.6)
    const rate = 11
    const n = out.length
    let ph = 0
    const lp = new Biquad('lowpass', 420, 1.0)
    for (let i = 0; i < n; i++) {
      const t = i / SR
      const cycle = (t * rate) % 1
      const pulse = Math.exp(-cycle * 9) * (1 + 0.15 * Math.sin(t * 3))
      ph += (62 + 28 * pulse) / SR
      const saw = 2 * (ph % 1) - 1
      const miss = Math.floor(t * rate) % 7 === 5 ? 0.4 : 1
      out[i] = lp.process(saw * pulse * miss * 0.9 + rng.signed() * 0.04 * pulse) * 1.6
    }
    return fadeInOut(out, 0.05, 0.12)
  },
  rain: (rng) => {
    const n = samplesFor(3.2)
    const out = new Float32Array(n)
    const hp = new Biquad('highpass', 1800, 0.7)
    const lp = new Biquad('lowpass', 9000, 0.7)
    for (let i = 0; i < n; i++) out[i] = lp.process(hp.process(rng.signed())) * 0.45
    for (let i = 0; i < 60; i++) ping(out, rng.range(0, 3.1), rng.range(1800, 5000), 0.05, 0.008)
    return fadeInOut(out, 0.3, 0.4)
  },
  snore: (rng) => {
    const out = buf(2.6)
    const inh = buf(2.6)
    // inhale: rising rough breath
    for (let i = 0; i < samplesFor(0.9); i++) {
      const u = i / samplesFor(0.9)
      inh[i] = rng.signed() * Math.sin(Math.PI * u) * 0.5 * (0.6 + 0.4 * Math.sin(i / SR * 160))
    }
    filterInPlace(inh, 'bandpass', 420, 1.4)
    addInto(out, inh, 0, 2)
    // exhale: low buzzing saw
    const ex = buf(2.6)
    sweep(ex, 1.0, 1.2, (u) => 78 - 25 * u + 5 * Math.sin(u * 60), (u) => Math.sin(Math.PI * Math.pow(u, 0.7)) * 0.7, 'saw')
    filterInPlace(ex, 'lowpass', 520, 1.2)
    addInto(out, ex, 0)
    return out
  },
  gasp_whoosh: (rng) => {
    const n = samplesFor(0.55)
    const out = new Float32Array(n)
    const bp = new Biquad('bandpass', 600, 1.5)
    for (let i = 0; i < n; i++) {
      const u = i / n
      bp.set('bandpass', 500 + 2600 * u * u, 1.6)
      out[i] = bp.process(rng.signed()) * Math.sin(Math.PI * Math.pow(u, 0.7)) * 2.4
    }
    return out
  },
  drum_roll: (rng) => {
    const dur = 1.7
    const out = buf(dur)
    let t = 0
    let gap = 0.075
    while (t < dur - 0.3) {
      const a = 0.25 + 0.5 * (t / dur) + rng.range(0, 0.06)
      noiseBurst(out, rng, t, 0.06, 0.018, a, 'bandpass', 1400, 0.9)
      ping(out, t, 190, a * 0.5, 0.03)
      t += gap
      gap = Math.max(0.04, gap * 0.985)
    }
    ping(out, dur - 0.3, 110, 0.9, 0.12, [[1.6, 0.3]])
    noiseBurst(out, rng, dur - 0.3, 0.25, 0.08, 0.7, 'bandpass', 3500, 0.5)
    return out
  },
  ta_da: () => {
    const out = buf(1.5)
    const note = (at: number, midi: number, sec: number, amp: number) => {
      const tmp = buf(1.5)
      const f = midiToHz(midi)
      sweep(tmp, at, sec, () => f, (u) => Math.min(1, u * 30) * Math.min(1, (1 - u) * 6) * amp, 'saw')
      addInto(out, filterInPlace(tmp, 'lowpass', f * 3, 0.9), 0)
    }
    note(0.02, 72, 0.18, 0.4)
    ;[67, 72, 76].forEach((m) => note(0.24, m, 1.1, 0.28))
    return out
  }
}

/** Every cue this module can synthesise (the contract's cue library). */
export const SFX_LIBRARY = Object.keys(GENERATORS)

/** Synthesises one cue as 44.1 kHz mono, peak-normalised to 0.8 (the mixer applies gains). Throws on unknown cue names. */
export function synthSfx(cue: string, seed: number | string = 0): Float32Array {
  const gen = GENERATORS[cue]
  if (!gen) throw new Error(`unknown sfx cue: ${cue}`)
  const s = typeof seed === 'number' ? seed : hashSeed(seed)
  const out = gen(new Rng(hashSeed(s, cue)))
  const clean = fadeInOut(out, 0.001, 0.01)
  return normalizePeak(clean, 0.8)
}

/** The cue as a buffer: a `<dataDir>/sfx/<cue>.wav` sample wins over the synthesised one. */
export async function loadSfx(cue: string, dataDir?: string, seed: number | string = 0): Promise<Float32Array> {
  if (dataDir) {
    const file = path.join(dataDir, 'sfx', `${cue}.wav`)
    if (existsSync(file)) {
      try {
        return toMono44k(await readWavFile(file))
      } catch {
        // a broken sample falls back to the synthesised cue
      }
    }
  }
  return synthSfx(cue, seed)
}
