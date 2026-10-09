import { describe, expect, it } from 'vitest'
import { compileShot, compileShotDetailed } from '../../src/engine/anim/compile'
import type { CompileInput } from '../../src/engine/anim/compile'
import { resolveTarget } from '../../src/engine/anim/target'
import { PuppetSpec, SetLayout, Shot, Style, Tracks } from '../../src/shared/episode'

const tock = PuppetSpec.parse({ id: 'tock', name: 'Tock', body: 'peg', vehicle: { kind: 'van' }, hat: 'pompom' })
const bobbin = PuppetSpec.parse({ id: 'bobbin', name: 'Bobbin', body: 'teddy' })
const set = SetLayout.parse({
  id: 'town_square',
  name: 'Town Square',
  props: [{ kind: 'house', pos: [-3.8, 2.7], id: 'yellow_house' }],
  marks: { center: [0, 0], left: [-4, -0.2], right: [4, -0.2], shop_door: [3.6, 1.35] }
})
const style = Style.parse({})

function shot(over: Partial<Shot> = {}): Shot {
  return Shot.parse({
    id: 'shot-01',
    sceneId: 'sc1',
    setId: 'town_square',
    duration: 8,
    framing: 'medium',
    subjects: ['tock'],
    cast: ['tock', 'bobbin'],
    startMarks: { tock: 'left', bobbin: [1, 0.5] },
    ...over
  })
}

function input(over: Partial<CompileInput> = {}): CompileInput {
  return {
    shot: shot(),
    actions: [
      { t: 0, actor: 'bobbin', action: 'walk_to', target: 'shop_door', dur: 3 },
      { t: 0.5, actor: 'tock', action: 'wave', dur: 1 },
      { t: 4, actor: 'bobbin', action: 'talk', lineId: 'L001' },
      { t: 6, actor: 'tock', action: 'hop' }
    ],
    cast: [tock, bobbin],
    set,
    lineMeta: { L001: { duration: 1.75, levels: [0, 1, 2, 2, 1, 2, 0, 1, 2, 2, 1, 0, 0, 1, 2, 1, 0, 0, 0, 0, 0], emotion: 'happy' } },
    style,
    seed: 1234,
    sfxCues: [{ shotId: 'shot-01', t: 0.8, cue: 'boing', gain: 0.7 }, { shotId: 'shot-02', t: 1, cue: 'pop' }],
    ...over
  }
}

describe('compileShot', () => {
  it('produces arrays of exactly `frames` entries and passes the Tracks schema', () => {
    const t = compileShot(input())
    expect(t.frames).toBe(96)
    expect(t.fps).toBe(12)
    expect(Tracks.safeParse(t).success).toBe(true)
    expect(t.camera.loc).toHaveLength(96)
    expect(t.camera.target).toHaveLength(96)
    expect(t.camera.lens).toHaveLength(96)
    for (const [name, o] of Object.entries(t.objects)) {
      if (o.loc) expect(o.loc, name).toHaveLength(96)
      if (o.rot) expect(o.rot, name).toHaveLength(96)
    }
    for (const id of ['tock', 'bobbin']) {
      expect(t.mouths[id]).toHaveLength(96)
      expect(t.props[id]).toHaveLength(96)
      expect(t.objects[`${id}.head`]!.rot).toHaveLength(96)
      expect(t.objects[`${id}.arm_r`]!.rot).toHaveLength(96)
    }
    expect(t.objects['tock.vehicle']).toBeDefined()
    expect(t.objects['bobbin.vehicle']).toBeUndefined()
  })

  it('is deterministic and changes with the seed', () => {
    const a = JSON.stringify(compileShot(input()))
    const b = JSON.stringify(compileShot(input()))
    expect(a).toBe(b)
    expect(JSON.stringify(compileShot(input({ seed: 99 })))).not.toBe(a)
  })

  it('starts at the start marks and walk_to ends at the target, where the puppet stays', () => {
    const t = compileShot(input({ style: { ...style, jitter_pos: 0, jitter_rot: 0 } }))
    const loc = t.objects.bobbin!.loc!
    expect(loc[0]![0]).toBeCloseTo(1, 3)
    expect(loc[0]![1]).toBeCloseTo(0.5, 3)
    expect(loc[95]![0]).toBeCloseTo(3.6, 3)
    expect(loc[95]![1]).toBeCloseTo(1.35, 3)
    // mid way it is somewhere between
    expect(loc[18]![0]).toBeGreaterThan(1.2)
    expect(loc[18]![0]).toBeLessThan(3.5)
    // tock never moved but was placed on his mark
    expect(t.objects.tock!.loc![50]![0]).toBeCloseTo(-4, 3)
    // she turned to walk to the right (facing +X is rot Z = +90 degrees) and legs swung while walking
    expect(t.objects.bobbin!.rot![20]![2]).toBeGreaterThan(40)
    const swing = t.objects['bobbin.leg_l']!.rot!.slice(4, 30).map((r) => r[0])
    expect(Math.max(...swing) - Math.min(...swing)).toBeGreaterThan(20)
  })

  it('places talk mouth levels at the right frames and emits the line event', () => {
    const t = compileShot(input())
    const levels = [0, 1, 2, 2, 1, 2, 0, 1, 2, 2, 1, 0, 0, 1, 2, 1, 0, 0, 0, 0, 0]
    expect(t.mouths.bobbin!.slice(48, 48 + levels.length)).toEqual(levels)
    expect(t.mouths.bobbin!.slice(0, 48).every((m) => m === 0)).toBe(true)
    expect(t.mouths.bobbin!.slice(48 + levels.length).every((m) => m === 0)).toBe(true)
    expect(t.mouths.tock!.every((m) => m === 0)).toBe(true)
    expect(t.events).toContainEqual({ frame: 48, kind: 'line', lineId: 'L001', actor: 'bobbin' })
  })

  it('emits sfx events of this shot only, sorted by frame, plus sparse automatic footsteps', () => {
    const t = compileShot(input())
    const sfx = t.events.filter((e) => e.kind === 'sfx')
    expect(sfx.find((e) => e.cue === 'boing')).toMatchObject({ frame: 10, gain: 0.7 })
    expect(sfx.find((e) => e.cue === 'pop')).toBeUndefined()
    expect(sfx.filter((e) => e.cue === 'squeak_step').length).toBeGreaterThan(0)
    expect(sfx.filter((e) => e.cue === 'squeak_step').length).toBeLessThanOrEqual(10)
    const frames = t.events.map((e) => e.frame)
    expect(frames).toEqual([...frames].sort((a, b) => a - b))
    for (const e of t.events) expect(e.frame).toBeLessThan(t.frames)
  })

  it('drives a vehicle: the root travels, the horn parps once, the vehicle bounces', () => {
    const t = compileShot(
      input({
        shot: shot({ cast: ['tock'], startMarks: { tock: 'left' } }),
        actions: [{ t: 0, actor: 'tock', action: 'drive_to', target: 'right', dur: 4 }],
        style: { ...style, jitter_pos: 0, jitter_rot: 0 }
      })
    )
    expect(t.objects.tock!.loc![95]![0]).toBeCloseTo(4, 3)
    expect(t.events.filter((e) => e.cue === 'horn_parp')).toHaveLength(1)
    const rx = t.objects['tock.vehicle']!.rot!.map((r) => r[0])
    expect(Math.max(...rx) - Math.min(...rx)).toBeGreaterThan(1)
    expect(t.events.some((e) => e.cue === 'squeak_step')).toBe(false)
  })

  it('layers later actions over earlier ones per channel', () => {
    const t = compileShot(
      input({
        actions: [
          { t: 0, actor: 'tock', action: 'sad_slump', dur: 6 },
          { t: 2, actor: 'tock', action: 'wave', dur: 2 }
        ],
        style: { ...style, jitter_pos: 0, jitter_rot: 0 }
      })
    )
    const armR = t.objects['tock.arm_r']!.rot!
    const head = t.objects['tock.head']!.rot!
    expect(armR[36]![1]).toBeGreaterThan(100) // waving over the slump
    expect(head[36]![0]).toBeGreaterThan(20) // still looking down
    expect(armR[12]![1]).toBeLessThan(20)
  })

  it('enter starts off set and exit leaves it; props follow pick_up and give', () => {
    const t = compileShot(
      input({
        shot: shot({ cast: ['bobbin', 'tock'], startMarks: { bobbin: 'right', tock: 'left' } }),
        actions: [
          { t: 0, actor: 'bobbin', action: 'enter', dur: 2 },
          { t: 2.5, actor: 'bobbin', action: 'pick_up', prop: 'flower', dur: 1 },
          { t: 4, actor: 'bobbin', action: 'give', target: 'tock', dur: 1 },
          { t: 5.5, actor: 'bobbin', action: 'exit', dur: 2 }
        ],
        style: { ...style, jitter_pos: 0, jitter_rot: 0 }
      })
    )
    const loc = t.objects.bobbin!.loc!
    expect(Math.abs(loc[0]![0])).toBeGreaterThan(6)
    expect(loc[30]![0]).toBeCloseTo(4, 2)
    expect(Math.abs(loc[95]![0])).toBeGreaterThan(6)
    expect(t.props.bobbin![0]).toBe('none')
    expect(t.props.bobbin![45]).toBe('flower')
    expect(t.props.bobbin![60]).toBe('none')
    expect(t.props.tock![60]).toBe('flower')
  })

  it('every action in the vocabulary compiles without warnings about itself', () => {
    const acts = [
      'walk_to', 'run_to', 'hop', 'turn_to', 'look_at', 'wave', 'nod', 'shake_head', 'point', 'jump_joy', 'sad_slump', 'shrug', 'sit',
      'stand', 'drive_to', 'pick_up', 'give', 'talk', 'gasp', 'laugh', 'sleep', 'wobble', 'idle', 'enter', 'exit'
    ] as const
    const steps = acts.map((a, i) => ({
      t: i * 0.3,
      actor: 'bobbin',
      action: a,
      target: ['walk_to', 'run_to', 'drive_to', 'turn_to', 'look_at', 'point', 'give'].includes(a) ? (a === 'give' ? 'tock' : 'center') : undefined,
      lineId: a === 'talk' ? 'L001' : undefined
    }))
    const r = compileShotDetailed(input({ shot: shot({ duration: 12 }), actions: steps as CompileInput['actions'] }))
    expect(r.warnings.filter((w) => w.includes('needs a target') || w.includes('unknown target'))).toEqual([])
    expect(Tracks.safeParse(r.tracks).success).toBe(true)
    for (const o of Object.values(r.tracks.objects)) {
      for (const arr of [o.loc, o.rot]) for (const v of arr ?? []) for (const n of v) expect(Number.isFinite(n)).toBe(true)
    }
  })

  it('camera: in front of the set, looking +Y, lens in range, moves are smooth', () => {
    for (const framing of ['establishing', 'wide', 'medium', 'close', 'two_shot', 'over_shoulder'] as const) {
      for (const cameraMove of ['locked', 'pan_left', 'pan_right', 'push_in', 'pull_out', 'follow'] as const) {
        for (const angle of ['eye', 'low', 'high'] as const) {
          const t = compileShot(input({ shot: shot({ framing, cameraMove, angle, subjects: ['tock', 'bobbin'] }) }))
          expect(t.camera.loc).toHaveLength(96)
          for (let i = 0; i < 96; i++) {
            const loc = t.camera.loc[i]!
            const tgt = t.camera.target[i]!
            expect(loc[1], `${framing}/${cameraMove}/${angle} y`).toBeLessThan(tgt[1])
            expect(loc[1]).toBeLessThan(0)
            expect(loc[2]).toBeGreaterThan(0)
            expect(t.camera.lens[i]).toBeGreaterThanOrEqual(28)
            expect(t.camera.lens[i]).toBeLessThanOrEqual(60)
          }
        }
      }
    }
    const locked = compileShot(input({ shot: shot({ cameraMove: 'locked' }) }))
    expect(new Set(locked.camera.loc.map((l) => l.join(','))).size).toBe(1)
    const push = compileShot(input({ shot: shot({ cameraMove: 'push_in' }) }))
    const d = (i: number) => Math.hypot(push.camera.loc[i]![0] - push.camera.target[i]![0], push.camera.loc[i]![1] - push.camera.target[i]![1])
    expect(d(95)).toBeLessThan(d(0))
    const wide = compileShot(input({ shot: shot({ framing: 'wide', subjects: ['tock'] }) }))
    const close = compileShot(input({ shot: shot({ framing: 'close', subjects: ['tock'] }) }))
    expect(close.camera.lens[0]).toBeGreaterThan(wide.camera.lens[0]!)
  })

  it('jitter is small and changes every frame, and is absent when the style has none', () => {
    const t = compileShot(input({ actions: [] }))
    const loc = t.objects.tock!.loc!
    const xs = new Set(loc.map((l) => l[0]))
    expect(xs.size).toBeGreaterThan(40)
    for (const l of loc) expect(Math.abs(l[0] + 4)).toBeLessThan(0.0031)
    const still = compileShot(input({ actions: [], style: { ...style, jitter_pos: 0, jitter_rot: 0 } }))
    expect(new Set(still.objects.tock!.loc!.map((l) => l.join(','))).size).toBe(1)
  })
})

describe('resolveTarget', () => {
  const ctx = { set, characters: ['tock'], characterPos: (id: string) => (id === 'tock' ? ([2, 2] as [number, number]) : undefined) }
  it('resolves points, marks, props and characters', () => {
    expect(resolveTarget([1, 2], ctx).pos).toEqual([1, 2])
    expect(resolveTarget('shop_door', ctx)).toMatchObject({ kind: 'mark', pos: [3.6, 1.35] })
    const prop = resolveTarget('yellow_house', ctx)
    expect(prop.kind).toBe('prop')
    expect(prop.pos).toEqual([-3.8, 2.7])
    expect(prop.approach[1]).toBeLessThan(2.7) // the door faces -Y
    const ch = resolveTarget('tock', ctx, [0, 0])
    expect(ch.kind).toBe('character')
    expect(Math.hypot(ch.approach[0] - 2, ch.approach[1] - 2)).toBeCloseTo(0.9, 3)
    expect(resolveTarget('nope', ctx).kind).toBe('unknown')
  })
})

describe('separation of puppets', () => {
  const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)
  const last = <T,>(a: T[]): T => a[a.length - 1]!

  it('side-steps two puppets that would end on the same mark', () => {
    const t = compileShot(
      input({
        shot: shot({ startMarks: { tock: 'left', bobbin: 'right' }, cast: ['bobbin', 'tock'], subjects: ['bobbin'] }),
        actions: [
          { t: 0, actor: 'bobbin', action: 'walk_to', target: 'center', dur: 3 },
          { t: 0, actor: 'tock', action: 'walk_to', target: 'center', dur: 3 }
        ]
      })
    )
    // tock drives a van, so use two plain puppets for the pure step-apart rule
    const a = last(t.objects.bobbin!.loc!)
    const b = last(t.objects.tock!.loc!)
    expect(dist(a, b)).toBeGreaterThanOrEqual(0.6)
  })

  it('two plain puppets on one mark end 0.6 or more apart, perpendicular to the camera axis', () => {
    const plain = PuppetSpec.parse({ id: 'squib', name: 'Squib', body: 'peg' })
    const t = compileShot(
      input({
        shot: shot({ cast: ['bobbin', 'squib'], subjects: ['bobbin'], startMarks: { bobbin: 'center', squib: 'center' } }),
        cast: [bobbin, plain],
        actions: []
      })
    )
    const a = t.objects.bobbin!.loc![10]!
    const b = t.objects.squib!.loc![10]!
    expect(dist(a, b)).toBeGreaterThanOrEqual(0.6)
    expect(Math.abs(a[1]! - b[1]!)).toBeLessThan(0.05) // side by side, not front to back
  })

  it('seats a rider beside the vehicle owner instead of on the same spot', () => {
    const t = compileShot(
      input({
        shot: shot({ cast: ['tock', 'bobbin'], startMarks: { tock: 'center', bobbin: 'center' } }),
        actions: [
          { t: 0, actor: 'tock', action: 'drive_to', target: 'right', dur: 4 },
          { t: 0, actor: 'bobbin', action: 'walk_to', target: 'right', dur: 4 }
        ]
      })
    )
    for (const f of [0, t.frames - 1]) {
      const a = t.objects.tock!.loc![f]!
      const b = t.objects.bobbin!.loc![f]!
      expect(dist(a, b), `frame ${f}`).toBeGreaterThanOrEqual(0.6)
    }
    expect(dist(last(t.objects.tock!.loc!), last(t.objects.bobbin!.loc!))).toBeCloseTo(0.75, 1)
  })

  it('leaves puppets that are far apart alone', () => {
    const t = compileShot(input())
    expect(t.objects.tock!.loc![0]![0]).toBeCloseTo(-4, 1)
  })
})
