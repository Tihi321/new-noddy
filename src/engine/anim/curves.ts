/** Small easing and keyframe helpers for the procedural puppet motion. Angles are degrees. */

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u
export const clamp01 = (x: number): number => clamp(x, 0, 1)

export const smoothstep = (u: number): number => {
  const x = clamp01(u)
  return x * x * (3 - 2 * x)
}

/** Ease with a stronger start and end than smoothstep. */
export const easeInOut = (u: number): number => {
  const x = clamp01(u)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

export const easeOut = (u: number): number => 1 - Math.pow(1 - clamp01(u), 2)

export const TAU = Math.PI * 2
export const rad = (deg: number): number => (deg * Math.PI) / 180
export const deg = (r: number): number => (r * 180) / Math.PI

/** Wraps an angle to (-180, 180]. */
export function wrap180(a: number): number {
  let x = a % 360
  if (x > 180) x -= 360
  if (x <= -180) x += 360
  return x
}

/** `angle` shifted by multiples of 360 so it is the closest equivalent to `ref`. */
export const nearestAngle = (angle: number, ref: number): number => ref + wrap180(angle - ref)

/** Heading (degrees, Blender rot Z of a puppet that faces -Y at rest) of a direction on the ground. */
export const headingOf = (dx: number, dy: number): number => deg(Math.atan2(dx, -dy))

/** Piecewise curve through [x, y] keys (x ascending), smoothstep between them, clamped outside. */
export function keys(points: [number, number][], ease: (u: number) => number = smoothstep): (x: number) => number {
  return (x) => {
    const first = points[0]!
    const last = points[points.length - 1]!
    if (x <= first[0]) return first[1]
    if (x >= last[0]) return last[1]
    for (let i = 1; i < points.length; i++) {
      const b = points[i]!
      if (x <= b[0]) {
        const a = points[i - 1]!
        const span = b[0] - a[0]
        return span <= 0 ? b[1] : lerp(a[1], b[1], ease((x - a[0]) / span))
      }
    }
    return last[1]
  }
}
