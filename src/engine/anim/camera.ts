import type { SetLayout, Shot } from '../../shared/episode'
import { clamp, lerp, rad, smoothstep } from './curves'
import { PROP_RADIUS } from './target'
import type { XY } from './target'

export type Vec3 = [number, number, number]

export interface CameraTrack {
  loc: Vec3[]
  target: Vec3[]
  lens: number[]
}

export interface CameraInput {
  shot: Pick<Shot, 'framing' | 'angle' | 'cameraMove' | 'subjects'>
  set: Pick<SetLayout, 'size'> & Partial<Pick<SetLayout, 'props'>>
  frames: number
  /** Ground position per frame for every subject (`subjects[i]` of the shot, or the cast when there are none). */
  subjects: XY[][]
  /**
   * Extra ground points that must stay in the picture: the front and back end of a vehicle, two points per frame for
   * every subject that drives one (`[front0, back0, front1, back1, ...]`). They widen the box but do not move the "mean position".
   */
  extents?: XY[][]
  /** Length of the longest vehicle among the subjects (0 or missing: none). A followed vehicle needs this much room. */
  vehicleLength?: number
}

/** Length of a puppet's vehicle along its heading, in toy units. */
export const VEHICLE_LENGTH = 1.6

/** Blender's default sensor is 36 mm wide: horizontal field of view of a lens. */
const SENSOR = 36
export const LENS_MIN = 28
export const LENS_MAX = 60
const MAX_DISTANCE = 12.5

interface Framing {
  lens: number
  minWidth: number
  pad: number
  targetZ: number
  elevation: Record<'eye' | 'low' | 'high', number>
  /** The look-at point is raised by this fraction of the picture height, so the subjects sit in the lower middle third (toy-table look). */
  lift: number
}

const FRAMINGS: Record<string, Framing> = {
  establishing: { lens: 28, minWidth: 11, pad: 2, targetZ: 0.35, elevation: { eye: 5, low: 2, high: 26 }, lift: 0.12 },
  wide: { lens: 32, minWidth: 6.5, pad: 2.6, targetZ: 0.5, elevation: { eye: 4, low: 1, high: 24 }, lift: 0.14 },
  medium: { lens: 50, minWidth: 3.4, pad: 2.2, targetZ: 0.6, elevation: { eye: 3, low: 0, high: 20 }, lift: 0.08 },
  close: { lens: 60, minWidth: 1.7, pad: 1.2, targetZ: 0.75, elevation: { eye: 1.5, low: -6, high: 16 }, lift: 0.05 },
  two_shot: { lens: 45, minWidth: 4.2, pad: 2.4, targetZ: 0.6, elevation: { eye: 3, low: 0, high: 20 }, lift: 0.09 },
  over_shoulder: { lens: 50, minWidth: 2.4, pad: 1.4, targetZ: 0.7, elevation: { eye: 3, low: 0, high: 16 }, lift: 0 }
}

/** Ground box of the set's props (cloud and road excluded), or null when there are none on the set. */
export function propsBox(props: SetLayout['props'] | undefined, size: [number, number]): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let box: { minX: number; maxX: number; minY: number; maxY: number } | null = null
  for (const p of props ?? []) {
    const r = (PROP_RADIUS[p.kind] ?? 0.8) * (p.scale ?? 1)
    if (r <= 0 || Math.abs(p.pos[0]) > size[0] / 2 + 1 || Math.abs(p.pos[1]) > size[1] / 2 + 1) continue
    box = box
      ? { minX: Math.min(box.minX, p.pos[0] - r), maxX: Math.max(box.maxX, p.pos[0] + r), minY: Math.min(box.minY, p.pos[1] - r), maxY: Math.max(box.maxY, p.pos[1] + r) }
      : { minX: p.pos[0] - r, maxX: p.pos[0] + r, minY: p.pos[1] - r, maxY: p.pos[1] + r }
  }
  return box
}

const onSet = (p: XY, size: [number, number]): boolean => Math.abs(p[0]) <= size[0] / 2 + 0.25 && Math.abs(p[1]) <= size[1] / 2 + 0.25

function normalize(v: XY): XY {
  const l = Math.hypot(v[0], v[1])
  return l < 1e-9 ? [0, -1] : [v[0] / l, v[1] / l]
}

/**
 * Auto-frames the shot: a mostly locked camera in front (-Y side) of the set, looking toward +Y.
 * Pans, pushes and follows are smooth over the whole shot; the result is sampled per animation frame.
 */
export function buildCamera(input: CameraInput): CameraTrack {
  const { shot, frames } = input
  const size = (input.set.size ?? [12, 8]) as [number, number]
  const f = FRAMINGS[shot.framing] ?? FRAMINGS.medium!
  const subs = input.subjects.filter((s) => s.length > 0)

  // The box that the camera frames: where the subjects spend their time on the set. A locked shot whose subject walks much
  // further than the framing ignores the first and last fifth of their positions, so a character who walks in from the edge does not turn a close-up into a wide shot.
  const moves = shot.cameraMove === 'pan_left' || shot.cameraMove === 'pan_right' || shot.cameraMove === 'follow'
  const trimmable = shot.framing !== 'establishing' && !moves
  const xs: number[] = []
  const ys: number[] = []
  for (const s of subs) {
    for (const p of s) {
      if (!onSet(p, size)) continue
      xs.push(p[0])
      ys.push(p[1])
    }
  }
  for (const e of input.extents ?? []) {
    for (const p of e) {
      if (!onSet(p, size)) continue
      xs.push(p[0])
      ys.push(p[1])
    }
  }
  const quant = (v: number[], q: number): number => {
    const a = [...v].sort((m, n) => m - n)
    return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))]!
  }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  if (xs.length > 0) {
    minX = quant(xs, 0)
    maxX = quant(xs, 1)
    minY = quant(ys, 0)
    maxY = quant(ys, 1)
    // only when the walk is much wider than the framing: then the middle three fifths of the time decide
    if (trimmable && maxX - minX > f.minWidth * 1.5) {
      minX = quant(xs, 0.2)
      maxX = quant(xs, 0.8)
      minY = quant(ys, 0.2)
      maxY = quant(ys, 0.8)
    }
  }
  // an establishing shot with nobody in it shows the set: frame the box around its props
  const noSubjects = subs.length === 0
  if (shot.framing === 'establishing' && noSubjects) {
    const pb = propsBox(input.set.props, size)
    if (pb) {
      minX = pb.minX
      maxX = pb.maxX
      minY = pb.minY
      maxY = pb.maxY
    }
  }
  const any = Number.isFinite(minX)
  if (!any) {
    minX = maxX = 0
    minY = maxY = 0
  }
  const move = shot.cameraMove
  const meanAt = (i: number): XY => {
    let sx = 0
    let sy = 0
    let n = 0
    for (const s of subs) {
      const p = s[Math.min(i, s.length - 1)]!
      sx += p[0]
      sy += p[1]
      n++
    }
    return n ? [sx / n, sy / n] : [0, 0]
  }

  let center: XY = [(minX + maxX) / 2, (minY + maxY) / 2]
  let spread = maxX - minX
  if (move === 'follow') {
    center = meanAt(0)
    spread = input.vehicleLength ?? 0
  }
  if (shot.framing === 'establishing') {
    if (any && noSubjects) {
      // the props decide; do not let a one-prop set shrink the shot below its minimum width
      spread = maxX - minX
    } else {
      center = [0, 0.2]
      spread = 0
    }
  }

  const panAmount = move === 'pan_left' || move === 'pan_right' ? Math.min(2.2, 0.15 * Math.max(f.minWidth, spread) + 0.6) : 0
  const width = Math.max(f.minWidth, spread + f.pad) + panAmount
  let lens = f.lens
  let dist = (width * lens) / SENSOR
  if (dist > MAX_DISTANCE) {
    lens = clamp((MAX_DISTANCE * SENSOR) / width, LENS_MIN, LENS_MAX)
    dist = (width * lens) / SENSOR
  }
  lens = clamp(lens, LENS_MIN, LENS_MAX)

  // base position and look-at point
  const tz = f.targetZ
  // vertical extent of the picture at the subject, for the "lower middle third" lift
  const pictureHeight = width * (9 / 16)
  let target: Vec3 = [center[0], center[1], tz + f.lift * pictureHeight]
  const eyeEl = f.elevation[shot.angle] ?? f.elevation.eye
  let loc: Vec3
  if (shot.framing === 'over_shoulder') {
    const at = (i: number) => subs.map((s) => s[Math.min(i, s.length - 1)]!)
    const mid = at(Math.floor(frames / 2))
    const a = mid[0] ?? [0, 0]
    const b = mid[1] ?? [a[0] + 1, a[1] + 0.6]
    const aIsNear = a[1] <= b[1] + 0.3
    const fg = aIsNear ? a : b
    const bg = aIsNear ? b : a
    const dir = normalize([fg[0] - bg[0], fg[1] - bg[1]])
    const back = normalize([dir[0] === 0 ? 0.5 : dir[0], Math.min(dir[1], -0.35)])
    const cam: XY = [fg[0] + back[0] * 1.7, Math.min(fg[1] + back[1] * 1.7, fg[1] - 0.9)]
    const z = shot.angle === 'low' ? 0.45 : shot.angle === 'high' ? 1.7 : 0.95
    loc = [cam[0], cam[1], z]
    target = [bg[0], bg[1], 0.7]
  } else {
    const el = rad(eyeEl)
    let cz = tz + dist * Math.sin(el)
    if (shot.angle === 'low') cz = Math.max(0.15, tz * 0.35 + dist * Math.sin(el))
    cz = Math.max(0.12, cz)
    const horizontal = Math.sqrt(Math.max(0.01, dist * dist - (cz - tz) * (cz - tz)))
    loc = [center[0], center[1] - horizontal, cz]
  }
  // the camera always stays in front of everything that matters
  const frontLimit = (any ? minY : center[1]) - 0.8
  if (shot.framing !== 'over_shoulder' && loc[1] > frontLimit) loc[1] = Math.min(loc[1], frontLimit)

  const locs: Vec3[] = []
  const targets: Vec3[] = []
  const lenses: number[] = []
  let sm: XY = meanAt(0)
  const base0 = meanAt(0)
  for (let i = 0; i < frames; i++) {
    const u = frames > 1 ? smoothstep(i / (frames - 1)) : 0
    let l: Vec3 = [loc[0], loc[1], loc[2]]
    let t: Vec3 = [target[0], target[1], target[2]]
    if (move === 'pan_left' || move === 'pan_right') {
      const dir = move === 'pan_right' ? 1 : -1
      t = [target[0] + dir * lerp(-panAmount, panAmount, u) * 0.9, target[1], target[2]]
    } else if (move === 'push_in' || move === 'pull_out') {
      const k = move === 'push_in' ? lerp(1, 0.72, u) : lerp(0.72, 1, u)
      l = [t[0] + (l[0] - t[0]) * k, t[1] + (l[1] - t[1]) * k, t[2] + (l[2] - t[2]) * k]
    } else if (move === 'follow') {
      const m = meanAt(i)
      sm = [sm[0] + (m[0] - sm[0]) * 0.18, sm[1] + (m[1] - sm[1]) * 0.18]
      const dx = sm[0] - base0[0]
      const dy = sm[1] - base0[1]
      l = [l[0] + dx, l[1] + dy * 0.6, l[2]]
      t = [t[0] + dx, t[1] + dy, t[2]]
    }
    // never behind the set's front edge of the actors; never below the table
    l[2] = Math.max(0.1, l[2])
    locs.push([r4(l[0]), r4(l[1]), r4(l[2])])
    targets.push([r4(t[0]), r4(t[1]), r4(t[2])])
    lenses.push(r4(lens))
  }
  return { loc: locs, target: targets, lens: lenses }
}

const r4 = (x: number): number => Math.round(x * 10000) / 10000
