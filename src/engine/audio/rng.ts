/** Small deterministic helpers shared by the audio synths and the animation compiler. */

/** FNV-1a over the string form of the parts: a stable 32-bit seed. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5
  const s = parts.join('\u0001')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Rng {
  private readonly next: () => number
  constructor(seed: number | string) {
    this.next = mulberry32(typeof seed === 'number' ? seed : hashSeed(seed))
  }
  /** [0, 1) */
  float(): number {
    return this.next()
  }
  /** [lo, hi) */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next()
  }
  /** [-1, 1) */
  signed(): number {
    return this.next() * 2 - 1
  }
  /** Integer in [0, n) */
  int(n: number): number {
    return Math.min(n - 1, Math.floor(this.next() * n))
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!
  }
  chance(p: number): boolean {
    return this.next() < p
  }
}
