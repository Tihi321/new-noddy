import type { ActionStep, PuppetSpec, SetLayout, Shot, ShotActions, Style, Tracks } from '../../shared/episode'
import { Rng, hashSeed } from '../audio/rng'
import { buildCamera, VEHICLE_LENGTH } from './camera'
import type { Vec3 } from './camera'
import { clamp, headingOf, keys, lerp, nearestAngle, smoothstep, TAU, wrap180 } from './curves'
import { resolveTarget } from './target'
import type { TargetSpec, XY } from './target'

/**
 * The animation compiler: a shot's action list becomes sampled transform tracks (12 fps, constant interpolation).
 * Everything is procedural puppet motion with a toy / stop-motion character. Deterministic for a given seed.
 *
 * Conventions (match docs/contracts.md and blender/toykit/puppets.py):
 * - Z-up, +Y into the set. A puppet faces -Y at rest, +X is its LEFT. Root `rot[2]` is its heading:
 *   facing direction (dx, dy) means rotZ = atan2(dx, -dy) degrees.
 * - Root `loc` is absolute (the root rests at the origin). Every other object's `loc`/`rot` is an offset from its rest pose.
 * - Euler XYZ degrees. On limbs hanging down: -rx swings forward, +ry swings the tip toward -X (so arm_l abducts with -ry
 *   and arm_r with +ry). On the head: +rx nods, +rz turns toward the puppet's left (counter-clockwise).
 * - The vehicle (`<id>.vehicle`) is a child of the root, so it travels with the puppet. Locomotion by a puppet that has a
 *   vehicle uses the driving motion (puppet at the wheel, bouncy suspension) whatever the action name.
 */

export interface LineMeta {
  duration: number
  levels: number[]
  /** Emotion of the line: drives gestures while it is spoken. */
  emotion?: string
}

export interface SfxCueLike {
  shotId?: string
  t: number
  cue: string
  gain?: number
}

export interface CompileInput {
  shot: Shot
  actions: ShotActions | ActionStep[]
  cast: PuppetSpec[]
  set: SetLayout
  lineMeta: Record<string, LineMeta>
  style: Pick<Style, 'jitter_pos' | 'jitter_rot'> & { fps?: number }
  seed: number
  /** Cues from sfx.json (all shots are fine, they are filtered by `shotId`). */
  sfxCues?: SfxCueLike[]
}

export interface CompileResult {
  tracks: Tracks
  warnings: string[]
}

export const JOINTS = ['hips', 'torso', 'head', 'arm_l', 'arm_r', 'leg_l', 'leg_r', 'hat'] as const
type Joint = (typeof JOINTS)[number]
type Axis = 'x' | 'y' | 'z'

// ---- pose: additive-free channel store with per-channel layering ----

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 }
const ROOT_RX = JOINTS.length * 3
const ROOT_RY = ROOT_RX + 1
const ROOT_RZ = ROOT_RX + 2
const DX = ROOT_RX + 3
const DY = ROOT_RX + 4
const DZ = ROOT_RX + 5
const VEH_RX = ROOT_RX + 6
const VEH_RY = ROOT_RX + 7
const VEH_Z = ROOT_RX + 8
const CHANNELS = ROOT_RX + 9

const rotChannel = (j: Joint, a: Axis): number => JOINTS.indexOf(j) * 3 + AXIS_INDEX[a]

class Pose {
  readonly v = new Float64Array(CHANNELS)
  mouth = -1
  /** Blends `value` over what lower layers wrote: w = 1 replaces, w = 0 leaves it. */
  set(ch: number, value: number, w = 1): void {
    this.v[ch] = this.v[ch]! * (1 - w) + value * w
  }
  rot(j: Joint, a: Axis, value: number, w = 1): void {
    this.set(rotChannel(j, a), value, w)
  }
  get(j: Joint, a: Axis): number {
    return this.v[rotChannel(j, a)]!
  }
}

// ---- actor timeline ----

interface Seg {
  t0: number
  t1: number
  from: XY
  to: XY
  /** (time, heading) keys: smooth between keys, held after the last one. The first key is the heading at t0. */
  yaw: [number, number][]
  /** 'trap' accelerates and brakes, 'linear' for hops. */
  profile: 'trap' | 'linear'
}

interface ActorRt {
  id: string
  spec: PuppetSpec
  start: XY
  segs: Seg[]
  posture: { t: number; sit: boolean }[]
  props: { t: number; prop: string }[]
  vehicle: boolean
  insts: Inst[]
}

function trap(u: number, a = 0.14): number {
  const x = clamp(u, 0, 1)
  if (x < a) return (x * x) / (2 * a) / (1 - a)
  if (x < 1 - a) return (a / 2 + (x - a)) / (1 - a)
  return 1 - ((1 - x) * (1 - x)) / (2 * a) / (1 - a)
}

/** Two puppets closer than this at the start or the end of a shot get side-stepped (toy units). */
export const MIN_SEPARATION = 0.6
/** How far beside the driver a passenger is seated. The van is 0.98 wide. */
const PASSENGER_OFFSET = 0.75
const STEP_APART = 0.75
/** A passenger counts as riding when this close to the vehicle owner. */
const RIDING_DIST = 0.95

function shiftActor(a: ActorRt, dx: number, dy: number): void {
  a.start = [a.start[0] + dx, a.start[1] + dy]
  for (const s of a.segs) {
    s.from = [s.from[0] + dx, s.from[1] + dy]
    s.to = [s.to[0] + dx, s.to[1] + dy]
  }
}

/**
 * Keeps puppets from standing in each other. At the end of the shot and at its start, a puppet that is closer than
 * MIN_SEPARATION to another one is moved (its whole path, rigidly) sideways, perpendicular to the camera axis. A puppet
 * that rides with a vehicle owner is seated beside the vehicle instead (the passenger offset). The mover is the later one
 * in the cast, except that the vehicle owner never moves for a passenger.
 */
function separateActors(list: ActorRt[], ...times: number[]): void {
  for (const t of times) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!
        const b = list[j]!
        const pa = posAt(a, t)
        const pb = posAt(b, t)
        const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1])
        if (a.vehicle !== b.vehicle) {
          const owner = a.vehicle ? a : b
          const rider = a.vehicle ? b : a
          const po = owner === a ? pa : pb
          const pr = owner === a ? pb : pa
          if (d >= RIDING_DIST) continue
          // beside the vehicle, on the side the rider is already on (the camera side when it is a tie)
          const h = (yawAt(owner, t) * Math.PI) / 180
          const left: XY = [Math.cos(h), Math.sin(h)]
          const side = (pr[0] - po[0]) * left[0] + (pr[1] - po[1]) * left[1]
          const sign = Math.abs(side) > 0.05 ? Math.sign(side) : left[1] <= 0 ? 1 : -1
          const want: XY = [po[0] + sign * left[0] * PASSENGER_OFFSET, po[1] + sign * left[1] * PASSENGER_OFFSET]
          shiftActor(rider, want[0] - pr[0], want[1] - pr[1])
        } else if (d < MIN_SEPARATION) {
          const dxs = pb[0] - pa[0]
          const sign = dxs === 0 ? 1 : Math.sign(dxs)
          const need = STEP_APART - Math.abs(dxs)
          if (need > 0) shiftActor(b, sign * need, 0)
        }
      }
    }
  }
}

function segFor(a: ActorRt, t: number): Seg | undefined {
  let found: Seg | undefined
  for (const s of a.segs) {
    if (s.t0 <= t + 1e-9) found = s
    else break
  }
  return found
}

function posAt(a: ActorRt, t: number): XY {
  const s = segFor(a, t)
  if (!s) return a.start
  if (t >= s.t1 || s.t1 <= s.t0) return s.to
  const raw = (t - s.t0) / (s.t1 - s.t0)
  const u = s.profile === 'trap' ? trap(raw) : raw
  return [lerp(s.from[0], s.to[0], u), lerp(s.from[1], s.to[1], u)]
}

function yawAt(a: ActorRt, t: number): number {
  const s = segFor(a, t)
  if (!s) return 0
  return keys(s.yaw)(t)
}

function sitAmount(a: ActorRt, t: number): number {
  let start = 0
  let target = 0
  let lastT = -1e9
  for (const ev of a.posture) {
    if (ev.t > t + 1e-9) break
    start = start + (target - start) * smoothstep((ev.t - lastT) / 0.6)
    target = ev.sit ? 1 : 0
    lastT = ev.t
  }
  return start + (target - start) * smoothstep((t - lastT) / 0.6)
}

function heldAt(a: ActorRt, t: number): string {
  let cur = 'none'
  for (const e of a.props) {
    if (e.t <= t + 1e-9) cur = e.prop
    else break
  }
  return cur
}

// ---- action instances (pass 1 result) ----

type MoveMode = 'walk' | 'run' | 'drive'

interface Inst {
  idx: number
  step: ActionStep
  actor: ActorRt
  /** Start frame and number of frames the action is active. */
  f0: number
  nF: number
  dur: number
  t0: number
  mode?: MoveMode
  dist: number
  stepRate: number
  tgt?: XY
  tgtId?: string
  levels?: number[]
  emotion: string
  phase: number
  hopCount: number
  hopHeight: number
}

const DEFAULT_DUR: Record<string, number> = {
  hop: 1.0, turn_to: 0.9, look_at: 1.5, wave: 1.5, nod: 1.0, shake_head: 1.0, point: 1.4, jump_joy: 1.6, sad_slump: 2.0, shrug: 1.0,
  sit: 0.6, stand: 0.6, pick_up: 1.4, give: 1.4, talk: 1.5, gasp: 1.2, laugh: 1.5, sleep: 3, wobble: 1.2, idle: 2
}

const MOVES = new Set(['walk_to', 'run_to', 'drive_to', 'enter', 'exit'])

/** Measured: how a puppet moves, in toy units. */
const SIT_DROP = 0.3
const SQUEAK_EVERY = 4
const MAX_SQUEAKS = 10

export function compileShotDetailed(input: CompileInput): CompileResult {
  const { shot, set, lineMeta, style } = input
  const fps = style.fps ?? 12
  const frames = Math.max(1, Math.round(shot.duration * fps))
  const warnings: string[] = []
  const warn = (m: string) => warnings.push(`${shot.id}: ${m}`)
  const steps: ActionStep[] = Array.isArray(input.actions) ? input.actions : input.actions.actions
  const specs = new Map(input.cast.map((c) => [c.id, c]))
  const size = (set.size ?? [12, 8]) as [number, number]
  const center = (set.marks.center ?? [0, 0]) as XY

  // who is in the shot
  const ids: string[] = []
  for (const id of shot.cast) if (specs.has(id) && !ids.includes(id)) ids.push(id)
  for (const s of steps) {
    if (specs.has(s.actor) && !ids.includes(s.actor)) {
      ids.push(s.actor)
      warn(`${s.actor} acts but is not in the shot's cast`)
    }
  }
  for (const id of shot.cast) if (!specs.has(id)) warn(`cast member ${id} has no puppet spec`)

  const actors = new Map<string, ActorRt>()
  const tctx = {
    set,
    characters: ids,
    characterPos: (id: string): XY | undefined => {
      const a = actors.get(id)
      return a ? posAt(a, nowT) : undefined
    }
  }
  let nowT = 0
  ids.forEach((id, i) => {
    const spec = specs.get(id)!
    let start: XY
    const sm = shot.startMarks[id]
    if (sm !== undefined) {
      const r = resolveTarget(sm as TargetSpec, tctx)
      if (r.kind === 'unknown') warn(`start mark ${JSON.stringify(sm)} of ${id} is unknown, using the centre`)
      start = [...r.approach] as XY
    } else {
      start = [center[0] + (i - (ids.length - 1) / 2) * 1.6, center[1]]
      warn(`${id} has no start mark`)
    }
    actors.set(id, { id, spec, start, segs: [], posture: [], props: [], vehicle: !!spec.vehicle, insts: [] })
  })

  // ---------------------------------------------------------------- pass 1: plan every action
  const sorted = steps
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => actors.has(s.actor))
    .sort((a, b) => a.s.t - b.s.t || a.idx - b.idx)
  const events: (Tracks['events'][number] & { gain?: number })[] = []
  let squeaks = 0
  let horns = 0
  const auto = new Set<object>()

  const partnerYaw = (a: ActorRt, at: XY, t: number): number => {
    let best: XY | undefined
    let bd = 4.5
    for (const o of actors.values()) {
      if (o === a) continue
      const p = posAt(o, t)
      if (Math.abs(p[0]) > size[0] / 2 || Math.abs(p[1]) > size[1] / 2) continue
      const d = Math.hypot(p[0] - at[0], p[1] - at[1])
      if (d < bd) {
        bd = d
        best = p
      }
    }
    if (!best) return 0
    return clamp(0.45 * headingOf(best[0] - at[0], best[1] - at[1]), -50, 50)
  }

  for (const { s, idx } of sorted) {
    const a = actors.get(s.actor)!
    const f0 = Math.round(s.t * fps)
    const t0 = f0 / fps
    nowT = t0
    const rng = new Rng(hashSeed(input.seed, shot.id, a.id, idx))
    const kind = s.action
    const from = posAt(a, t0)
    const yaw0 = yawAt(a, t0)
    const meta = kind === 'talk' && s.lineId ? lineMeta[s.lineId] : undefined
    if (kind === 'talk') {
      if (!s.lineId) warn(`talk by ${a.id} has no lineId`)
      else if (!meta) warn(`line ${s.lineId} has no voice file yet, using a placeholder mouth`)
    }
    let dur = kind === 'talk' ? (meta ? meta.duration : s.dur ?? DEFAULT_DUR.talk!) : s.dur ?? DEFAULT_DUR[kind] ?? 1
    const inst: Inst = {
      idx, step: s, actor: a, f0, nF: 1, dur, t0, dist: 0, stepRate: 2.2, emotion: meta?.emotion ?? 'neutral',
      phase: rng.range(0, TAU), hopCount: 1, hopHeight: 0.3
    }
    if (kind === 'talk') {
      const n = meta ? meta.levels.length : Math.max(1, Math.ceil(dur * fps))
      inst.levels = meta ? meta.levels : Array.from({ length: n }, (_, i) => (i % 5 === 4 ? 0 : rng.chance(0.45) ? 2 : 1))
      if (meta) dur = Math.max(dur, n / fps)
      inst.dur = dur
    }

    // posture
    if (kind === 'sit') a.posture.push({ t: t0, sit: true })
    else if (kind === 'stand') a.posture.push({ t: t0, sit: false })
    else if ((MOVES.has(kind) || kind === 'hop') && sitAmount(a, t0) > 0.05) a.posture.push({ t: t0, sit: false })

    // held props
    if (kind === 'pick_up') a.props.push({ t: t0 + dur * 0.5, prop: s.prop ?? (typeof s.target === 'string' && isHeld(s.target) ? s.target : 'ball') })
    else if (kind === 'give') {
      const held = heldAt(a, t0 + dur * 0.5)
      a.props.push({ t: t0 + dur * 0.5, prop: 'none' })
      if (typeof s.target === 'string' && actors.has(s.target)) {
        const recv = actors.get(s.target)!
        const item = held !== 'none' ? held : s.prop
        if (item) recv.props.push({ t: t0 + dur * 0.55, prop: item })
      }
    } else if (s.prop) a.props.push({ t: t0, prop: s.prop })

    // movement and facing
    const resolveFor = (target: TargetSpec | undefined) => {
      if (target === undefined) return undefined
      const r = resolveTarget(target, tctx, from)
      if (r.kind === 'unknown') warn(`unknown target ${JSON.stringify(target)} for ${kind} by ${a.id}`)
      return r
    }
    if (MOVES.has(kind) || (kind === 'hop' && s.target !== undefined)) {
      let dest: XY | undefined
      let origin = from
      if (kind === 'enter') {
        const r = resolveFor(s.target)
        const sm = shot.startMarks[a.id]
        dest = r ? r.approach : sm !== undefined ? resolveTarget(sm as TargetSpec, tctx).approach : center
        const side = dest[0] >= 0 ? 1 : -1
        origin = [side * (size[0] / 2 + 1.3), dest[1]]
        if (a.segs.length === 0) a.start = origin
        else a.segs.push({ t0: Math.max(0, t0 - 1e-3), t1: Math.max(0, t0 - 1e-3), from: origin, to: origin, yaw: [[t0 - 1e-3, yaw0]], profile: 'linear' })
      } else if (kind === 'exit') {
        const r = resolveFor(s.target)
        const side = (r ? r.pos[0] : from[0]) >= 0 ? 1 : -1
        dest = [side * (size[0] / 2 + 1.5), r && r.kind !== 'unknown' ? r.pos[1] : from[1]]
      } else {
        const r = resolveFor(s.target)
        dest = r?.approach
      }
      if (!dest) {
        warn(`${kind} by ${a.id} needs a target`)
      } else {
        const mode: MoveMode = a.vehicle ? 'drive' : kind === 'run_to' ? 'run' : 'walk'
        const dx = dest[0] - origin[0]
        const dy = dest[1] - origin[1]
        const dist = Math.hypot(dx, dy)
        if (s.dur === undefined) {
          const speed = mode === 'run' ? 3.2 : mode === 'drive' ? 2.4 : 1.5
          dur = kind === 'hop' ? Math.max(0.9, dist / 0.9) : Math.max(0.7, dist / speed)
          inst.dur = dur
        }
        inst.mode = mode
        inst.dist = dist
        inst.tgt = dest
        const speed = dur > 0 ? dist / dur : 0
        inst.stepRate = mode === 'run' ? clamp(speed / 0.5, 2.4, 4) : clamp(speed / 0.42, 1.5, 3)
        const yawFrom = kind === 'enter' ? 0 : yaw0
        const keysYaw: [number, number][] = [[t0, yawFrom]]
        if (dist > 0.05) {
          const lead = Math.min(mode === 'drive' ? 0.6 : 0.35, dur * 0.3)
          const h = nearestAngle(headingOf(dx, dy), yawFrom)
          keysYaw.push([t0 + lead, h])
          if (kind !== 'exit' && dist > 0.3) {
            const settle = nearestAngle(partnerYaw(a, dest, t0 + dur), h)
            keysYaw.push([t0 + dur + 0.15, h], [t0 + dur + 0.6, settle])
          }
        }
        a.segs.push({ t0, t1: t0 + dur, from: origin, to: dest, yaw: keysYaw, profile: kind === 'hop' ? 'linear' : 'trap' })
        if (kind === 'hop') {
          inst.hopCount = Math.max(1, Math.round(dist / 0.7))
          inst.hopHeight = 0.28
        }
        // sounds that come with moving
        if (mode === 'drive' && (kind === 'drive_to' || kind === 'enter') && dist > 1 && horns < 1) {
          horns++
          const ev = { frame: f0, kind: 'sfx' as const, cue: 'horn_parp', gain: 0.35 }
          auto.add(ev)
          events.push(ev)
        }
        if (mode !== 'drive' && dist > 0.6) {
          const steps = Math.floor(dur * inst.stepRate)
          for (let k = 0; k < steps && squeaks < MAX_SQUEAKS; k += SQUEAK_EVERY) {
            const f = Math.round((t0 + (k + 0.5) / inst.stepRate) * fps)
            if (f < frames && f >= 0) {
              events.push({ frame: f, kind: 'sfx', cue: 'squeak_step', gain: 0.25 })
              squeaks++
            }
          }
        }
      }
    } else if (kind === 'turn_to' || kind === 'look_at') {
      const r = resolveFor(s.target)
      if (r) {
        const psi = headingOf(r.pos[0] - from[0], r.pos[1] - from[1])
        inst.tgt = r.pos
        inst.tgtId = typeof s.target === 'string' && actors.has(s.target) ? s.target : undefined
        const diff = wrap180(psi - yaw0)
        if (kind === 'turn_to') {
          const to = nearestAngle(psi, yaw0)
          a.segs.push({ t0, t1: t0, from, to: from, yaw: [[t0, yaw0], [t0 + 0.22, yaw0], [t0 + 0.72, to]], profile: 'linear' })
        } else if (Math.abs(diff) > 70) {
          const to = yaw0 + diff - Math.sign(diff) * 70
          a.segs.push({ t0, t1: t0, from, to: from, yaw: [[t0, yaw0], [t0 + 0.3, yaw0], [t0 + 0.8, to]], profile: 'linear' })
        }
      } else warn(`${kind} by ${a.id} needs a target`)
    } else if (kind === 'point' || kind === 'give' || (kind === 'talk' && s.target !== undefined)) {
      const r = resolveFor(s.target)
      if (r) {
        inst.tgt = r.pos
        inst.tgtId = typeof s.target === 'string' && actors.has(s.target) ? s.target : undefined
      }
    }

    inst.nF = Math.max(1, Math.ceil(inst.dur * fps - 1e-9))
    a.insts.push(inst)

    // events of the shot
    if (kind === 'talk' && s.lineId) {
      if (f0 < frames) events.push({ frame: f0, kind: 'line', lineId: s.lineId, actor: a.id })
      else warn(`line ${s.lineId} starts after the end of the shot`)
    }
  }
  for (const a of actors.values()) a.props.sort((x, y) => x.t - y.t)
  for (const c of input.sfxCues ?? []) {
    if (c.shotId !== undefined && c.shotId !== shot.id) continue
    const f = Math.round(c.t * fps)
    if (f >= frames) {
      warn(`sfx ${c.cue} at ${c.t}s is after the end of the shot`)
      continue
    }
    events.push({ frame: Math.max(0, f), kind: 'sfx', cue: c.cue, ...(c.gain !== undefined ? { gain: c.gain } : {}) })
  }
  // an explicit horn from the sound designer close to the automatic one replaces it
  const outEvents = events.filter((e) => !(auto.has(e) && events.some((o) => o !== e && o.cue === 'horn_parp' && Math.abs(o.frame - e.frame) <= Math.round(1.2 * fps))))
  outEvents.sort((x, y) => x.frame - y.frame)

  // ---------------------------------------------------------------- separation: no two puppets on the same spot
  separateActors([...actors.values()], 0, frames / fps)

  // ---------------------------------------------------------------- pass 2: sample every frame
  const objects: Tracks['objects'] = {}
  const mouths: Tracks['mouths'] = {}
  const props: Tracks['props'] = {}
  const jp = style.jitter_pos ?? 0
  const jr = style.jitter_rot ?? 0
  const r4 = (x: number) => Math.round(x * 10000) / 10000
  const r3 = (x: number) => Math.round(x * 1000) / 1000
  const posByActorFrame = new Map<string, XY[]>()
  const endsByActorFrame = new Map<string, XY[]>()

  for (const a of actors.values()) {
    const jit = new Rng(hashSeed(input.seed, shot.id, a.id, 'jitter'))
    const rootLoc: Vec3[] = []
    const rootRot: Vec3[] = []
    const jointRot: Record<Joint, Vec3[]> = { hips: [], torso: [], head: [], arm_l: [], arm_r: [], leg_l: [], leg_r: [], hat: [] }
    const vehLoc: Vec3[] = []
    const vehRot: Vec3[] = []
    const mouth: number[] = []
    const held: string[] = []
    const ground: XY[] = []
    const ends: XY[] = []
    const swayPhase = new Rng(hashSeed(input.seed, shot.id, a.id, 'sway')).range(0, TAU)
    const insts = a.insts
    for (let f = 0; f < frames; f++) {
      const t = f / fps
      nowT = t
      const pos = posAt(a, t)
      const yaw = yawAt(a, t)
      ground.push(pos)
      if (a.vehicle) {
        // front and back end of the vehicle: it lies along the heading
        const h = (yaw * Math.PI) / 180
        const ux = Math.sin(h) * (VEHICLE_LENGTH / 2)
        const uy = -Math.cos(h) * (VEHICLE_LENGTH / 2)
        ends.push([pos[0] + ux, pos[1] + uy], [pos[0] - ux, pos[1] - uy])
      }
      const p = new Pose()
      // base layer: posture, held item, a tiny idle sway
      const sit = sitAmount(a, t)
      if (sit > 0) {
        p.rot('leg_l', 'x', -82 * sit)
        p.rot('leg_r', 'x', -82 * sit)
        p.rot('torso', 'x', -3 * sit)
        p.rot('arm_l', 'x', -35 * sit)
        p.rot('arm_r', 'x', -35 * sit)
        p.set(DZ, -SIT_DROP * sit)
      }
      const heldNow = heldAt(a, t)
      held.push(heldNow)
      if (heldNow !== 'none') p.rot('arm_r', 'x', Math.min(p.get('arm_r', 'x'), -40))
      idleSway(p, t, swayPhase, 0.4)

      for (const inst of insts) {
        const lf = f - inst.f0
        if (lf < 0 || lf >= inst.nF) continue
        const lt = lf / fps
        const dur = inst.nF / fps
        const rampIn = Math.min(RAMP_IN[inst.step.action] ?? 0.12, dur / 3)
        const rampOut = Math.min(RAMP_OUT[inst.step.action] ?? 0.2, dur / 3)
        const w = smoothstep(rampIn > 0 ? (lt + 1 / fps) / rampIn : 1) * smoothstep(rampOut > 0 ? (dur - lt) / rampOut : 1)
        const c: PoseCtx = { p, w, lt, dur, u: clamp(lt / dur, 0, 1), inst, pos, yaw, t, fps, heldNow, partner: (id) => (actors.get(id) ? posAt(actors.get(id)!, t) : undefined) }
        applyAction(c)
      }

      // output
      const bodyYaw = yaw + p.v[ROOT_RZ]!
      const jx = jit.signed() * jp
      const jy = jit.signed() * jp
      rootLoc.push([r4(pos[0] + p.v[DX]! + jx), r4(pos[1] + p.v[DY]! + jy), r4(p.v[DZ]!)])
      rootRot.push([r3(p.v[ROOT_RX]! + jit.signed() * jr), r3(p.v[ROOT_RY]! + jit.signed() * jr), r3(bodyYaw + jit.signed() * jr)])
      for (const j of JOINTS) {
        jointRot[j].push([
          r3(p.get(j, 'x') + jit.signed() * jr),
          r3(p.get(j, 'y') + jit.signed() * jr),
          r3(p.get(j, 'z') + jit.signed() * jr)
        ])
      }
      if (a.vehicle) {
        vehLoc.push([0, 0, r4(p.v[VEH_Z]!)])
        vehRot.push([r3(p.v[VEH_RX]!), r3(p.v[VEH_RY]!), 0])
      }
      mouth.push(p.mouth < 0 ? 0 : clamp(Math.round(p.mouth), 0, 2))
    }
    posByActorFrame.set(a.id, ground)
    if (a.vehicle) endsByActorFrame.set(a.id, ends)
    objects[a.id] = { loc: rootLoc, rot: rootRot }
    for (const j of JOINTS) objects[`${a.id}.${j}`] = { rot: jointRot[j] }
    if (a.vehicle) objects[`${a.id}.vehicle`] = { loc: vehLoc, rot: vehRot }
    mouths[a.id] = mouth
    props[a.id] = held
  }

  // ---------------------------------------------------------------- camera
  const subjectIds = shot.subjects.filter((s) => actors.has(s))
  const camIds = subjectIds.length ? subjectIds : ids
  const extents = camIds.flatMap((id) => (endsByActorFrame.has(id) ? [endsByActorFrame.get(id)!] : []))
  const camera = buildCamera({
    shot,
    set: { size, props: set.props },
    frames,
    subjects: camIds.map((id) => posByActorFrame.get(id) ?? []),
    extents,
    vehicleLength: extents.length ? VEHICLE_LENGTH : 0
  })

  const tracks: Tracks = {
    shotId: shot.id,
    setId: shot.setId,
    fps,
    frames,
    seed: input.seed,
    cast: ids,
    camera,
    objects,
    mouths,
    props,
    events: outEvents
  }
  return { tracks, warnings }
}

export function compileShot(input: CompileInput): Tracks {
  return compileShotDetailed(input).tracks
}

const HELD = new Set(['cap', 'ball', 'letter', 'flower', 'cake', 'key', 'umbrella', 'balloon'])
const isHeld = (s: string): boolean => HELD.has(s)

// ---------------------------------------------------------------- the motion library

interface PoseCtx {
  p: Pose
  /** envelope of the action: fades in and out so layers blend instead of popping */
  w: number
  lt: number
  dur: number
  u: number
  inst: Inst
  pos: XY
  yaw: number
  t: number
  fps: number
  heldNow: string
  partner: (id: string) => XY | undefined
}

const RAMP_IN: Record<string, number> = { sad_slump: 0.5, sleep: 0.6, sit: 0, stand: 0, talk: 0.08 }
const RAMP_OUT: Record<string, number> = { sad_slump: 0.5, sleep: 0.6, sit: 0, stand: 0, talk: 0.1, walk_to: 0.2 }

function idleSway(p: Pose, t: number, ph: number, k: number): void {
  p.rot('torso', 'x', 1.4 * k * Math.sin(TAU * 0.33 * t + ph))
  p.rot('hips', 'y', 1.6 * k * Math.sin(TAU * 0.21 * t + ph * 0.7))
  p.rot('head', 'y', 3 * k * Math.sin(TAU * 0.17 * t + ph + 1))
  p.rot('head', 'x', 1.2 * k * Math.sin(TAU * 0.29 * t + ph + 2))
  p.rot('arm_l', 'x', 1.5 * k * Math.sin(TAU * 0.33 * t + ph + 0.5))
  p.rot('arm_r', 'x', -1.5 * k * Math.sin(TAU * 0.33 * t + ph + 0.5))
}

/** Heading from the puppet to a point, relative to its body heading, limited to +-lim. */
function lookDiff(c: PoseCtx, to: XY | undefined, lim: number): number {
  if (!to) return 0
  const dx = to[0] - c.pos[0]
  const dy = to[1] - c.pos[1]
  if (Math.hypot(dx, dy) < 0.05) return 0
  return clamp(wrap180(headingOf(dx, dy) - c.yaw), -lim, lim)
}

function targetPos(c: PoseCtx): XY | undefined {
  const id = c.inst.tgtId
  if (id) return c.partner(id) ?? c.inst.tgt
  return c.inst.tgt
}

function applyAction(c: PoseCtx): void {
  const { p, w, lt, u, inst } = c
  const kind = inst.step.action
  switch (kind) {
    case 'walk_to':
    case 'run_to':
    case 'drive_to':
    case 'enter':
    case 'exit':
      gait(c)
      return
    case 'hop':
    case 'jump_joy':
      hopLike(c, kind === 'jump_joy')
      return
    case 'turn_to':
    case 'look_at': {
      const d = lookDiff(c, targetPos(c), 70)
      p.rot('head', 'z', d, w)
      p.rot('torso', 'z', d * 0.15, w)
      return
    }
    case 'wave': {
      const raise = keys([[0, 0], [0.22, 1], [Math.max(0.3, c.dur - 0.25), 1], [c.dur, 0]])(lt)
      const osc = Math.sin(TAU * 2.6 * lt + inst.phase)
      p.rot('arm_r', 'y', (150 + 17 * osc) * raise, w)
      p.rot('arm_r', 'x', -8 * raise, w)
      p.rot('head', 'y', 6 * raise, w)
      p.rot('torso', 'y', -3 * raise, w)
      return
    }
    case 'nod': {
      const n = Math.max(1, Math.round(c.dur * 1.8))
      const k = 0.5 - 0.5 * Math.cos(TAU * n * u)
      p.rot('head', 'x', 16 * k, w)
      p.rot('torso', 'x', 3 * k, w)
      return
    }
    case 'shake_head': {
      const n = Math.max(1, Math.round(c.dur * 2))
      p.rot('head', 'z', 24 * Math.sin(TAU * n * u), w)
      p.rot('head', 'y', 4 * Math.sin(TAU * n * u + 1), w)
      p.rot('torso', 'z', 3 * Math.sin(TAU * n * u + 0.5), w)
      return
    }
    case 'point': {
      const raise = keys([[0, 0], [0.28, 1], [Math.max(0.35, c.dur - 0.3), 1], [c.dur, 0]])(lt)
      const d = inst.tgt ? lookDiff(c, targetPos(c), 100) : -15
      p.rot('arm_r', 'x', -82 * raise, w)
      p.rot('arm_r', 'z', d * raise, w)
      p.rot('head', 'z', clamp(d, -55, 55) * 0.8 * raise, w)
      p.rot('torso', 'x', 3 * raise, w)
      return
    }
    case 'sad_slump': {
      const sway = Math.sin(TAU * 0.4 * lt + inst.phase)
      const sigh = keys([[0, 0], [0.55 * c.dur, 0], [0.65 * c.dur, 1], [0.8 * c.dur, 0]])(lt)
      p.rot('head', 'x', 32 + 2 * sway, w)
      p.rot('head', 'y', 3 * sway, w)
      p.rot('torso', 'x', 18 - 4 * sigh, w)
      p.rot('hips', 'x', 3, w)
      p.rot('arm_l', 'x', 14, w)
      p.rot('arm_r', 'x', 14, w)
      p.rot('arm_l', 'y', -6, w)
      p.rot('arm_r', 'y', 6, w)
      return
    }
    case 'shrug': {
      const up = keys([[0, 0], [0.25, 1], [Math.max(0.4, c.dur - 0.3), 1], [c.dur, 0]])(lt)
      const pulse = 1 + 0.12 * Math.sin(TAU * 2 * lt)
      p.rot('arm_l', 'y', -38 * up * pulse, w)
      p.rot('arm_r', 'y', 38 * up * pulse, w)
      p.rot('arm_l', 'x', -14 * up, w)
      p.rot('arm_r', 'x', -14 * up, w)
      p.rot('head', 'y', 14 * up, w)
      p.rot('torso', 'y', 4 * up, w)
      p.set(DZ, 0.012 * up * (0.5 + 0.5 * Math.sin(TAU * 2 * lt)), w)
      return
    }
    case 'sit':
    case 'stand':
    case 'idle': {
      if (kind === 'idle') idleSway(p, c.t, inst.phase, 1)
      return
    }
    case 'pick_up': {
      const bend = keys([[0, 0], [0.35, 1], [0.55, 1], [1, 0]])(u)
      p.rot('torso', 'x', 38 * bend, w)
      p.rot('head', 'x', 12 * bend, w)
      p.rot('hips', 'x', 4 * bend, w)
      p.rot('arm_r', 'x', -75 * bend - 40 * smoothstep((u - 0.55) / 0.3), w)
      p.rot('arm_l', 'x', -20 * bend, w)
      return
    }
    case 'give': {
      const reach = keys([[0, 0], [0.3, 1], [0.7, 1], [1, 0]])(u)
      const d = lookDiff(c, targetPos(c), 80)
      p.rot('arm_r', 'x', -85 * reach, w)
      p.rot('arm_r', 'z', d * reach * 0.8, w)
      p.rot('head', 'z', clamp(d, -55, 55) * reach, w)
      p.rot('torso', 'x', 6 * reach, w)
      return
    }
    case 'talk':
      talk(c)
      return
    case 'gasp': {
      const jolt = keys([[0, 0], [0.1, 1], [0.35, 0.2], [0.6, 0]])(lt)
      const hold = keys([[0, 0], [0.12, 1], [Math.max(0.3, c.dur - 0.3), 1], [c.dur, 0]])(lt)
      p.set(DZ, 0.07 * jolt, w)
      p.rot('arm_l', 'y', -40 * hold, w)
      p.rot('arm_r', 'y', 40 * hold, w)
      p.rot('arm_l', 'x', -22 * hold, w)
      p.rot('arm_r', 'x', -22 * hold, w)
      p.rot('head', 'x', -12 * hold, w)
      p.rot('torso', 'x', -8 * hold, w)
      if (lt < Math.min(c.dur, 0.9)) p.mouth = w > 0.3 ? 2 : p.mouth
      return
    }
    case 'laugh': {
      const sh = Math.sin(TAU * 4 * lt + inst.phase)
      p.rot('head', 'x', -11 + 7 * sh, w)
      p.rot('torso', 'x', -4 + 5 * Math.sin(TAU * 4 * lt + inst.phase + 0.6), w)
      p.rot('arm_l', 'x', -35 + 6 * sh, w)
      p.rot('arm_r', 'x', -35 - 6 * sh, w)
      p.set(DZ, 0.02 * Math.abs(sh), w)
      p.mouth = w > 0.3 ? (sh > 0 ? 2 : 1) : p.mouth
      return
    }
    case 'sleep': {
      const br = Math.sin(TAU * 0.22 * lt)
      p.rot('head', 'x', 22 + 1.5 * br, w)
      p.rot('head', 'y', 14, w)
      p.rot('torso', 'x', 8 + 2.5 * br, w)
      p.rot('arm_l', 'x', 8, w)
      p.rot('arm_r', 'x', 8, w)
      return
    }
    case 'wobble': {
      const decay = Math.exp(-3 * u)
      const s = Math.sin(TAU * 3 * lt)
      p.set(ROOT_RY, 12 * s * decay, w)
      p.set(ROOT_RX, 5 * Math.sin(TAU * 2.3 * lt + 1) * decay, w)
      p.rot('head', 'y', -8 * s * decay, w)
      p.rot('arm_l', 'y', -(25 + 25 * Math.sin(TAU * 3 * lt + 1.6)) * decay, w)
      p.rot('arm_r', 'y', (25 + 25 * Math.sin(TAU * 3 * lt + 1.6)) * decay, w)
      p.rot('hat', 'y', 10 * Math.sin(TAU * 3 * lt - 0.8) * decay, w)
      return
    }
    default:
      return
  }
}

function gait(c: PoseCtx): void {
  const { p, w, lt, inst } = c
  const mode = inst.mode ?? 'walk'
  if (inst.dist < 0.05) return
  const s = Math.sin(Math.PI * inst.stepRate * lt)
  const cs = Math.abs(Math.cos(Math.PI * inst.stepRate * lt))
  if (mode === 'walk') {
    p.rot('leg_l', 'x', -25 * s, w)
    p.rot('leg_r', 'x', 25 * s, w)
    p.rot('arm_l', 'x', 20 * s, w)
    p.rot('arm_r', 'x', -20 * s, w)
    p.rot('hips', 'z', 6 * s, w)
    p.rot('hips', 'y', 5 * s, w)
    p.rot('torso', 'y', -3 * s, w)
    p.rot('torso', 'x', 5, w)
    p.rot('head', 'z', -3 * s, w)
    p.rot('head', 'x', 1.5 * cs - 1, w)
    p.set(DZ, 0.035 * cs, w)
  } else if (mode === 'run') {
    p.rot('leg_l', 'x', -45 * s, w)
    p.rot('leg_r', 'x', 45 * s, w)
    p.rot('arm_l', 'x', 50 * s - 10, w)
    p.rot('arm_r', 'x', -50 * s - 10, w)
    p.rot('hips', 'z', 8 * s, w)
    p.rot('hips', 'y', 6 * s, w)
    p.rot('torso', 'y', -4 * s, w)
    p.rot('torso', 'x', 14, w)
    p.rot('head', 'z', -4 * s, w)
    p.rot('head', 'x', -4, w)
    p.set(DZ, 0.1 * cs, w)
  } else {
    // driving: the puppet sits at the wheel, the little van bounces on its springs
    const t = c.t
    p.rot('arm_l', 'x', -55, w)
    p.rot('arm_r', 'x', -55, w)
    p.rot('arm_l', 'y', -8, w)
    p.rot('arm_r', 'y', 8, w)
    p.rot('torso', 'x', -1.5 * Math.sin(TAU * 3.2 * t), w)
    p.rot('head', 'y', 3 * Math.sin(TAU * 1.1 * t + inst.phase), w)
    p.set(VEH_RX, 1.6 * Math.sin(TAU * 3.2 * t + inst.phase) + 1.4 * Math.sin(TAU * 7 * t), w)
    p.set(VEH_RY, 1.2 * Math.sin(TAU * 2.3 * t + 1), w)
    p.set(VEH_Z, 0.014 * (0.5 + 0.5 * Math.sin(TAU * 5 * t)), w)
    p.set(DZ, 0.012 * Math.abs(Math.sin(TAU * 3.2 * t)), w)
  }
}

function hopLike(c: PoseCtx, joy: boolean): void {
  const { p, w, inst } = c
  const count = joy ? Math.max(2, Math.round(c.dur / 0.8)) : inst.hopCount === 1 && inst.dist === 0 ? Math.max(1, Math.round(c.dur / 0.7)) : inst.hopCount
  const h = joy ? 0.55 : inst.hopHeight
  const cyc = c.u * count
  const q = Math.min(0.9999, cyc - Math.floor(cyc))
  const crouch = keys([[0, 0], [0.2, 1], [0.28, 0.25], [0.78, 0], [0.86, 0.9], [1, 0]])(q)
  const air = keys([[0, 0], [0.26, 0], [0.52, 1], [0.78, 0], [1, 0]])(q)
  p.set(DZ, h * air, w)
  p.rot('torso', 'x', 16 * crouch - 4 * air, w)
  p.rot('head', 'x', 8 * crouch - (joy ? 12 : 4) * air, w)
  p.rot('hips', 'x', 5 * crouch, w)
  if (joy) {
    p.rot('arm_l', 'y', -(10 + 140 * air), w)
    p.rot('arm_r', 'y', 10 + 140 * air, w)
    p.rot('arm_l', 'x', 25 * crouch, w)
    p.rot('arm_r', 'x', 25 * crouch, w)
    p.rot('leg_l', 'y', -20 * air, w)
    p.rot('leg_r', 'y', 20 * air, w)
    p.set(ROOT_RZ, 15 * Math.sin(Math.PI * (q * 2 - 1)) * air, w)
  } else {
    p.rot('arm_l', 'x', 25 * crouch - 55 * air, w)
    p.rot('arm_r', 'x', 25 * crouch - 55 * air, w)
    p.rot('leg_l', 'x', -18 * air, w)
    p.rot('leg_r', 'x', -18 * air, w)
  }
  p.rot('hat', 'x', 12 * crouch - 18 * air, w)
}

const TALK: Record<string, { hx: number; hy: number; ga: number; lean: number; bounce: number }> = {
  neutral: { hx: 0, hy: 3, ga: 0, lean: 0, bounce: 0 },
  happy: { hx: -1, hy: 5, ga: 20, lean: -2, bounce: 0.01 },
  excited: { hx: -2, hy: 6, ga: 42, lean: -3, bounce: 0.035 },
  sad: { hx: 14, hy: 2, ga: 0, lean: 8, bounce: 0 },
  worried: { hx: 6, hy: 5, ga: 30, lean: 3, bounce: 0 },
  angry: { hx: 3, hy: 2, ga: 32, lean: 7, bounce: 0.01 },
  surprised: { hx: -8, hy: 2, ga: 25, lean: -5, bounce: 0.02 },
  sleepy: { hx: 14, hy: 6, ga: 0, lean: 4, bounce: 0 },
  question: { hx: 0, hy: 9, ga: 8, lean: 0, bounce: 0 },
  laugh: { hx: -10, hy: 3, ga: 15, lean: -4, bounce: 0.02 }
}

function talk(c: PoseCtx): void {
  const { p, w, lt, inst } = c
  const levels = inst.levels ?? []
  const lvl = levels[Math.min(levels.length - 1, Math.floor(lt * c.fps + 1e-6))] ?? 0
  const e = TALK[inst.emotion] ?? TALK.neutral!
  p.mouth = lvl
  p.rot('head', 'x', e.hx + (lvl === 2 ? 1.8 : 0), w)
  p.rot('head', 'y', e.hy * Math.sin(TAU * 0.55 * lt + inst.phase), w)
  p.rot('torso', 'x', e.lean, w)
  if (inst.tgt) p.rot('head', 'z', lookDiff(c, targetPos(c), 45) * 0.7, w)
  if (e.ga > 0) {
    const g = 0.5 + 0.5 * Math.sin(TAU * 1.1 * lt + inst.phase)
    p.rot('arm_r', 'x', -e.ga * (0.35 + 0.65 * g), w * 0.9)
    p.rot('arm_l', 'x', -e.ga * (0.35 + 0.65 * (1 - g)) * 0.8, w * 0.9)
  }
  if (e.bounce > 0) p.set(DZ, e.bounce * (lvl === 2 ? 1 : 0.2), w)
  if (inst.emotion === 'laugh') p.rot('torso', 'x', -4 + 4 * Math.sin(TAU * 4 * lt), w)
}
