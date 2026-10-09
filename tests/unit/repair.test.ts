import { describe, expect, it } from 'vitest'
import { repairActions } from '../../src/engine/pipeline/repair'

const shot = { duration: 8, lines: ['L1', 'L2'], cast: ['tock'] }
const lines = [
  { lineId: 'L1', character: 'tock', text: 'Oh no, my cap!' },
  { lineId: 'L2', character: 'tock', text: 'Please help me find it.' }
]

describe('repairActions', () => {
  it('shortens overrunning actions and drops those after the end', () => {
    const r = repairActions(shot, [
      { t: 0, actor: 'tock', action: 'talk', lineId: 'L1' },
      { t: 7, actor: 'tock', action: 'gasp', dur: 1.5 },
      { t: 8.5, actor: 'tock', action: 'talk', lineId: 'L2' }
    ], lines)
    expect(r.actions.find((a) => a.action === 'gasp')!.dur).toBe(1)
    expect(r.actions.every((a) => a.t <= 7.8)).toBe(true)
    // the dropped talk comes back inside the shot
    const talk2 = r.actions.find((a) => a.lineId === 'L2')!
    expect(talk2.t).toBeLessThan(8 - 0.2)
    expect(talk2.t).toBeGreaterThan(0)
  })
  it('adds missing talk actions after the other talks and keeps a clean list unchanged', () => {
    const r = repairActions(shot, [{ t: 0, actor: 'tock', action: 'walk_to', target: 'center', dur: 3 }], lines)
    const talks = r.actions.filter((a) => a.action === 'talk')
    expect(talks.map((a) => a.lineId)).toEqual(['L1', 'L2'])
    expect(talks[1]!.t).toBeGreaterThan(talks[0]!.t)
    const clean = repairActions(shot, r.actions, lines)
    expect(clean.notes).toEqual([])
    expect(clean.actions).toEqual(r.actions)
  })
})

import { fitShotDurations } from '../../src/engine/pipeline/repair'

describe('repair of cast and targets', () => {
  it('drops actions of things that are not in the cast and reads a stringified [x, y] target', () => {
    const r = repairActions({ duration: 10, lines: [], cast: ['tock'] }, [
      { t: 0, actor: 'cloud_a', action: 'idle' },
      { t: 1, actor: 'tock', action: 'look_at', target: '[2.2, -1.3]' }
    ], [])
    expect(r.actions).toEqual([{ t: 1, actor: 'tock', action: 'look_at', target: [2.2, -1.3] }])
  })
})

describe('fitShotDurations', () => {
  it('scales short plans up, within 6 to 20 s, and leaves good plans alone', () => {
    const short = Array.from({ length: 10 }, () => ({ duration: 12 }))
    const r = fitShotDurations(short, 200)
    expect(r.note).toContain('scaled')
    expect(r.shots.every((s) => s.duration >= 6 && s.duration <= 20)).toBe(true)
    expect(r.shots.reduce((n, s) => n + s.duration, 0)).toBeGreaterThan(170)
    expect(fitShotDurations(short, 120).note).toBeNull()
  })
})
