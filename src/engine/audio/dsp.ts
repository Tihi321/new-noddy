/** Tiny DSP toolbox: everything is mono Float32Array at 44.1 kHz. */

export const SR = 44100
export const TAU = Math.PI * 2

export const dbToGain = (db: number): number => Math.pow(10, db / 20)
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-9))
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u
export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

export const samplesFor = (sec: number, sr = SR): number => Math.max(0, Math.round(sec * sr))

export type FilterType = 'lowpass' | 'highpass' | 'bandpass'

/** RBJ biquad, direct form I. */
export class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0
  constructor(
    type: FilterType,
    freq: number,
    q = 0.707,
    private readonly sr = SR
  ) {
    this.set(type, freq, q)
  }
  set(type: FilterType, freq: number, q = 0.707): void {
    const f = clamp(freq, 10, this.sr * 0.49)
    const w0 = (TAU * f) / this.sr
    const cos = Math.cos(w0)
    const alpha = Math.sin(w0) / (2 * Math.max(q, 0.01))
    let b0: number, b1: number, b2: number
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2
      b1 = 1 - cos
      b2 = b0
    } else if (type === 'highpass') {
      b0 = (1 + cos) / 2
      b1 = -(1 + cos)
      b2 = b0
    } else {
      b0 = alpha
      b1 = 0
      b2 = -alpha
    }
    const a0 = 1 + alpha
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = (-2 * cos) / a0
    this.a2 = (1 - alpha) / a0
  }
  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

export function filterInPlace(buf: Float32Array, type: FilterType, freq: number, q = 0.707, passes = 1): Float32Array {
  for (let p = 0; p < passes; p++) {
    const f = new Biquad(type, freq, q)
    for (let i = 0; i < buf.length; i++) buf[i] = f.process(buf[i]!)
  }
  return buf
}

export function fadeInOut(buf: Float32Array, inSec: number, outSec: number, sr = SR): Float32Array {
  const nIn = Math.min(buf.length, samplesFor(inSec, sr))
  const nOut = Math.min(buf.length, samplesFor(outSec, sr))
  for (let i = 0; i < nIn; i++) buf[i] = buf[i]! * (i / nIn)
  for (let i = 0; i < nOut; i++) buf[buf.length - 1 - i] = buf[buf.length - 1 - i]! * (i / nOut)
  return buf
}

/** dst[offset + i] += src[i] * gain, clipped to the bounds of dst. */
export function addInto(dst: Float32Array, src: ArrayLike<number>, offset: number, gain = 1): void {
  const start = Math.max(0, offset)
  const end = Math.min(dst.length, offset + src.length)
  for (let i = start; i < end; i++) dst[i] = dst[i]! + src[i - offset]! * gain
}

export function peakOf(buf: ArrayLike<number>): number {
  let p = 0
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]!)
    if (a > p) p = a
  }
  return p
}

export function rmsOf(buf: ArrayLike<number>, from = 0, to = buf.length): number {
  let s = 0
  const n = Math.max(0, to - from)
  if (n === 0) return 0
  for (let i = from; i < to; i++) s += buf[i]! * buf[i]!
  return Math.sqrt(s / n)
}

export function normalizePeak(buf: Float32Array, target = 0.8): Float32Array {
  const p = peakOf(buf)
  if (p > 1e-9) {
    const g = target / p
    for (let i = 0; i < buf.length; i++) buf[i] = buf[i]! * g
  }
  return buf
}

/** Smooth saturation: transparent below `knee`, asymptotically approaches 1 above it. Never exceeds 1. */
export function softLimit(x: number, knee = 0.7, ceiling = 1): number {
  const a = Math.abs(x)
  if (a <= knee) return x
  const over = (a - knee) / (ceiling - knee)
  const y = knee + (ceiling - knee) * Math.tanh(over)
  return x < 0 ? -y : y
}

/** A new silent buffer. */
export const silence = (sec: number, sr = SR): Float32Array => new Float32Array(samplesFor(sec, sr))
