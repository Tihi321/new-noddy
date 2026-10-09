import { describe, expect, it } from 'vitest'
import { buildCamera } from '../../src/engine/anim/camera'

type Input = Parameters<typeof buildCamera>[0]

const walkIn = (n: number): [number, number][] => {
  // enters from x=6 (the edge of a 12-wide set), walks to -2.2 in the first 40 percent, then stays
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) out.push([i < n * 0.4 ? 6 - (8.2 * i) / (n * 0.4) : -2.2, 0])
  return out
}

describe('buildCamera', () => {
  it('keeps a close-up on where the subject stays, not on where they walked in from', () => {
    const subject = walkIn(100)
    const cam = buildCamera({
      shot: { framing: 'close', angle: 'eye', cameraMove: 'locked', subjects: ['tock'] },
      set: { size: [12, 8] },
      subjects: [subject],
      frames: 100
    } as unknown as Input)
    expect(cam.target[0]![0]).toBeLessThan(0)
    expect(cam.lens[0]).toBeGreaterThan(55)
  })
})

describe('buildCamera framing', () => {
  const reach = (c: ReturnType<typeof buildCamera>) => Math.hypot(c.loc[0]![0] - c.target[0]![0], c.loc[0]![1] - c.target[0]![1])
  const base = { set: { size: [12, 8] as [number, number] }, frames: 24 }
  const still = (p: [number, number]) => Array.from({ length: 24 }, () => p)
  const cam = (over: Record<string, unknown>) =>
    buildCamera({ ...base, shot: { framing: 'close', angle: 'eye', cameraMove: 'locked', subjects: ['a'] }, subjects: [still([0, 0])], ...over } as unknown as Input)

  it('gives a close shot of a vehicle more room than the same close shot of a plain puppet', () => {
    // a van lying across the picture: front at x=+0.8, back at x=-0.8
    const ends = Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? ([0.8, 0] as [number, number]) : ([-0.8, 0] as [number, number])))
    const plain = cam({})
    const van = cam({ extents: [ends], vehicleLength: 1.6 })
    expect(reach(van)).toBeGreaterThan(reach(plain))
    const halfWidth = (c: ReturnType<typeof buildCamera>) => {
      const dist = Math.hypot(c.loc[0]![0] - c.target[0]![0], c.loc[0]![1] - c.target[0]![1])
      return (dist * 36) / c.lens[0]! / 2
    }
    expect(halfWidth(van)).toBeGreaterThan(0.8)
  })

  it('a followed vehicle needs the vehicle length as width', () => {
    const plain = cam({ shot: { framing: 'close', angle: 'eye', cameraMove: 'follow', subjects: ['a'] } })
    const van = cam({ shot: { framing: 'close', angle: 'eye', cameraMove: 'follow', subjects: ['a'] }, vehicleLength: 1.6 })
    expect(reach(van)).toBeGreaterThan(reach(plain))
  })

  it('keeps the camera low and looking nearly level on wide and establishing shots, with the subject below the middle', () => {
    for (const framing of ['establishing', 'wide'] as const) {
      const c = cam({ shot: { framing, angle: 'eye', cameraMove: 'locked', subjects: ['a'] } })
      expect(c.loc[0]![2], framing).toBeLessThan(1.6)
      expect(c.target[0]![2], framing).toBeGreaterThan(0.4) // the look-at point is lifted: the subject sits low in the picture
    }
  })

  it('frames the props of the set when an establishing shot has no cast', () => {
    const props = [
      { id: 'h1', kind: 'house', pos: [-4.5, 1], rot: 0, scale: 1 },
      { id: 's1', kind: 'shop', pos: [5, 1], rot: 0, scale: 1 }
    ]
    const withProps = cam({ shot: { framing: 'establishing', angle: 'eye', cameraMove: 'locked', subjects: [] }, subjects: [], set: { size: [12, 8], props } })
    const without = cam({ shot: { framing: 'establishing', angle: 'eye', cameraMove: 'locked', subjects: [] }, subjects: [] })
    const wide = (c: ReturnType<typeof buildCamera>) => (Math.hypot(c.loc[0]![0] - c.target[0]![0], c.loc[0]![1] - c.target[0]![1]) * 36) / c.lens[0]!
    expect(wide(withProps)).toBeGreaterThan(wide(without)) // props span ~12.5 units
    expect(withProps.target[0]![0]).toBeCloseTo(0.25, 1) // centred on the props' box, not on the set origin
  })
})
