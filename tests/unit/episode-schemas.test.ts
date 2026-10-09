import { describe, expect, it } from 'vitest'
import {
  ACTIONS, Beat, Brief, EMOTIONS, EpisodeMeta, FRAMINGS, INSTRUMENTS, MouthFile, Music, PROP_KINDS, PuppetSpec, QaResult, Script, SetLayout, Sfx,
  SFX_CUES, ShotActions, Shots, Style, Tracks, STAGES
} from '../../src/shared/episode'
import { buildStory } from '../fixtures/story/story'

describe('vocabularies match docs/contracts.md', () => {
  it('has the documented counts', () => {
    expect(ACTIONS).toHaveLength(25)
    expect(EMOTIONS).toHaveLength(10)
    expect(PROP_KINDS).toHaveLength(22)
    expect(SFX_CUES).toHaveLength(20)
    expect(INSTRUMENTS).toHaveLength(6)
    expect(FRAMINGS).toEqual(['establishing', 'wide', 'medium', 'close', 'two_shot', 'over_shoulder'])
    expect(STAGES.indexOf('review')).toBeLessThan(STAGES.indexOf('approve_script'))
    expect(STAGES.at(-1)).toBe('failed')
  })
})

describe('puppets and sets', () => {
  it('parses the contract example and fills defaults', () => {
    const p = PuppetSpec.parse({ id: 'tock', name: 'Tock', body: 'peg' })
    expect(p.material).toBe('wood')
    expect(p.vehicle).toBeNull()
    expect(p.voice.timbre).toBe('warm')
    expect(p.colors.skin).toMatch(/^#/)
  })
  it('rejects an unknown body, hat or colour', () => {
    expect(PuppetSpec.safeParse({ id: 'x', name: 'X', body: 'robot' }).success).toBe(false)
    expect(PuppetSpec.safeParse({ id: 'x', name: 'X', body: 'peg', hat: 'crown' }).success).toBe(false)
    expect(PuppetSpec.safeParse({ id: 'x', name: 'X', body: 'peg', colors: { skin: 'red' } }).success).toBe(false)
  })
  it('keeps unknown frontmatter fields on a puppet (a catalog file may carry notes)', () => {
    expect((PuppetSpec.parse({ id: 'x', name: 'X', body: 'cow', note: 'hello' }) as Record<string, unknown>).note).toBe('hello')
  })
  it('parses a set with props and marks', () => {
    const s = SetLayout.parse({
      id: 'town_square',
      name: 'Town Square',
      props: [{ kind: 'house', pos: [-3, 2], id: 'tocks_house' }],
      marks: { center: [0, 0] }
    })
    expect(s.size).toEqual([12, 8])
    expect(s.props[0]!.scale).toBe(1)
    expect(SetLayout.safeParse({ id: 'a', name: 'A', props: [{ kind: 'castle', pos: [0, 0] }] }).success).toBe(false)
    expect(SetLayout.safeParse({ id: 'a', name: 'A', marks: { x: [1] } }).success).toBe(false)
  })
  it('parses a style', () => {
    const s = Style.parse({ id: 'toyland-wood', fps: 12 })
    expect(s.output_fps).toBe(24)
    expect(s.key_light).toBe('#ffe2b8')
  })
})

describe('episode.md frontmatter', () => {
  it('has defaults for a fresh episode', () => {
    const m = EpisodeMeta.parse({ theme: 'windy day' })
    expect(m.stage).toBe('brief')
    expect(m.status).toBe('running')
    expect(m.approvals).toEqual({ script: true, animatic: true })
    expect(m.approved).toEqual({ script: false, animatic: false })
    expect(m.round).toBe(0)
    expect(m.error).toBeNull()
  })
  it('rejects an unknown stage', () => {
    expect(EpisodeMeta.safeParse({ stage: 'dancing' }).success).toBe(false)
  })
})

describe('story documents', () => {
  const story = buildStory()
  it('accepts the fixture episode', () => {
    expect(Brief.safeParse(story.brief).success).toBe(true)
    expect(Script.safeParse(story.script).success).toBe(true)
    expect(Shots.safeParse(story.shots).success).toBe(true)
    expect(Music.safeParse(story.music).success).toBe(true)
    expect(Sfx.safeParse(story.sfx).success).toBe(true)
    for (const a of Object.values(story.actions)) expect(ShotActions.safeParse(a).success).toBe(true)
    expect(story.shots.shots).toHaveLength(15)
  })
  it('requires speaker, line id and emotion on a line beat', () => {
    expect(Beat.safeParse({ id: 'b1', kind: 'line', text: 'Hi' }).success).toBe(false)
    expect(Beat.safeParse({ id: 'b1', kind: 'line', text: 'Hi', character: 'tock', lineId: 'L001', emotion: 'happy' }).success).toBe(true)
    expect(Beat.safeParse({ id: 'b1', kind: 'action', text: 'Tock waves.' }).success).toBe(true)
  })
  it('rejects an emotion outside the vocabulary', () => {
    expect(Beat.safeParse({ id: 'b1', kind: 'line', text: 'Hi', character: 'tock', lineId: 'L001', emotion: 'furious' }).success).toBe(false)
  })
  it('rejects actions outside the vocabulary and accepts [x, y] targets', () => {
    const ok = ShotActions.safeParse({ shotId: 'shot-01', actions: [{ t: 0, actor: 'tock', action: 'walk_to', target: [1, 2], dur: 2 }] })
    expect(ok.success).toBe(true)
    const bad = ShotActions.safeParse({ shotId: 'shot-01', actions: [{ t: 0, actor: 'tock', action: 'fly_to', target: 'center' }] })
    expect(bad.success).toBe(false)
    expect(ShotActions.safeParse({ shotId: 's', actions: [{ t: 0, actor: 'tock', action: 'wave', prop: 'sword' }] }).success).toBe(false)
  })
  it('rejects a shot with a bad framing or no duration', () => {
    const shot = story.shots.shots[0]!
    expect(Shots.safeParse({ shots: [{ ...shot, framing: 'dutch' }] }).success).toBe(false)
    expect(Shots.safeParse({ shots: [{ ...shot, duration: 0 }] }).success).toBe(false)
  })
  it('gives shots defaults for the optional fields', () => {
    const s = Shots.parse({ shots: [{ id: 'shot-01', sceneId: 'sc1', setId: 'a', duration: 8, framing: 'wide' }] }).shots[0]!
    expect(s.cameraMove).toBe('locked')
    expect(s.transitionIn).toBe('cut')
    expect(s.cast).toEqual([])
  })
  it('validates music and sound', () => {
    expect(Music.safeParse({ ...story.music, theme: { ...story.music.theme, instrument: 'banjo' } }).success).toBe(false)
    expect(Sfx.safeParse({ cues: [{ shotId: 'shot-01', t: 1, cue: 'kaboom' }] }).success).toBe(false)
    expect(Sfx.parse({ cues: [{ shotId: 'shot-01', t: 1, cue: 'boing' }] }).cues[0]!.gain).toBe(0.8)
  })
  it('validates the mouth file', () => {
    expect(MouthFile.safeParse({ lineId: 'L001', duration: 1.75, fps: 12, levels: [0, 1, 2, 1] }).success).toBe(true)
    expect(MouthFile.safeParse({ lineId: 'L001', duration: 1.75, fps: 12, levels: [0, 3] }).success).toBe(false)
  })
  it('validates the QA result', () => {
    expect(QaResult.safeParse({ ok: false, round: 0, checkedAt: 'x', issues: [{ task: 'actions', unit: 'shot-01', severity: 'error', code: 'c', message: 'm' }] }).success).toBe(true)
    expect(QaResult.safeParse({ ok: false, round: 0, checkedAt: 'x', issues: [{ task: 'script', severity: 'error', code: 'c', message: 'm' }] }).success).toBe(false)
  })
})

describe('tracks', () => {
  const frames = 4
  const v = (n: number) => Array.from({ length: n }, () => [0, 0, 0])
  const base = () => ({
    shotId: 'shot-01',
    setId: 'town_square',
    fps: 12,
    frames,
    seed: 1234,
    cast: ['tock'],
    camera: { loc: v(frames), target: v(frames), lens: Array(frames).fill(35) },
    objects: { tock: { loc: v(frames), rot: v(frames) }, 'tock.head': { rot: v(frames) } },
    mouths: { tock: [0, 1, 2, 0] },
    props: { tock: ['none', 'none', 'cap', 'cap'] },
    events: [{ frame: 1, kind: 'line', lineId: 'L001', actor: 'tock' }, { frame: 2, kind: 'sfx', cue: 'horn_parp' }]
  })
  it('accepts arrays with exactly `frames` entries', () => {
    expect(Tracks.safeParse(base()).success).toBe(true)
  })
  it('rejects an array of the wrong length', () => {
    const t = base()
    t.mouths.tock = [0, 1]
    const r = Tracks.safeParse(t)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]!.path.join('.')).toBe('mouths.tock')
    const u = base()
    u.camera.lens = [35]
    expect(Tracks.safeParse(u).success).toBe(false)
  })
})
