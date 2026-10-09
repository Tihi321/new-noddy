import { describe, expect, it } from 'vitest'
import { groupIssues, qaResult, resolvesTarget, validateEpisode } from '../../src/engine/pipeline/qa'
import type { QaInput } from '../../src/engine/pipeline/qa'
import { buildStory } from '../fixtures/story/story'
import type { Story } from '../fixtures/story/story'

function input(s: Story, over: Partial<QaInput> = {}): QaInput {
  return {
    cast: s.cast,
    sets: s.sets,
    script: s.script,
    shots: s.shots,
    actions: s.actions,
    music: s.music,
    sfx: s.sfx,
    targetSec: 300,
    shotsMin: 15,
    shotsMax: 25,
    ...over
  }
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const codes = (i: QaInput) => validateEpisode(i).map((x) => x.code)

describe('QA validator', () => {
  it('finds nothing wrong in the fixture episode', () => {
    expect(validateEpisode(input(buildStory()))).toEqual([])
  })

  it('reports a script character who is not in the cast, owned by cast', () => {
    const s = buildStory()
    const issues = validateEpisode(input(s, { cast: [s.cast[0]] }))
    const i = issues.find((x) => x.code === 'script_cast_missing')
    expect(i?.task).toBe('cast')
    expect(i?.message).toContain('bobbin')
    // the shots also use bobbin: their owner is the director
    expect(issues.some((x) => x.code === 'shot_cast_missing' && x.task === 'shots')).toBe(true)
  })

  it('reports a set that is missing, for the set designer (script) and the director (shot)', () => {
    const s = buildStory()
    const issues = validateEpisode(input(s, { sets: [s.sets[0]] }))
    expect(issues.some((x) => x.code === 'script_set_missing' && x.task === 'sets')).toBe(true)
    expect(issues.some((x) => x.code === 'shot_set_missing' && x.task === 'shots')).toBe(true)
  })

  it('checks that start marks resolve', () => {
    const s = buildStory()
    const shots = clone(s.shots)
    shots.shots[0]!.startMarks = { tock: 'nowhere', bobbin: 'tocks_house' }
    const issues = validateEpisode(input(s, { shots }))
    expect(issues.filter((x) => x.code === 'mark_unknown')).toHaveLength(1)
    expect(issues[0]!.task).toBe('shots')
  })

  it('checks the action targets', () => {
    const s = buildStory()
    const actions = clone(s.actions)
    actions['shot-02']!.actions.push({ t: 8, actor: 'tock', action: 'walk_to', target: 'the_moon', dur: 2 })
    actions['shot-02']!.actions.push({ t: 10, actor: 'tock', action: 'look_at', target: 'bobbin' })
    actions['shot-02']!.actions.push({ t: 11, actor: 'tock', action: 'run_to', target: [2, 2], dur: 1 })
    actions['shot-02']!.actions.push({ t: 12, actor: 'tock', action: 'walk_to', dur: 1 })
    const issues = validateEpisode(input(s, { actions }))
    expect(issues.map((x) => x.code).sort()).toEqual(['target_missing', 'target_unknown'])
    expect(issues.every((x) => x.task === 'actions' && x.unit === 'shot-02')).toBe(true)
  })

  it('wants a talk action for every line of the shot', () => {
    const s = buildStory()
    const actions = clone(s.actions)
    actions['shot-03']!.actions = actions['shot-03']!.actions.filter((a) => a.action !== 'talk')
    const issues = validateEpisode(input(s, { actions }))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'line_without_talk', task: 'actions', unit: 'shot-03' })
  })

  it('catches a talk by the wrong actor or for a line that is not in the shot', () => {
    const s = buildStory()
    const actions = clone(s.actions)
    const talk = actions['shot-03']!.actions.find((a) => a.action === 'talk')!
    talk.actor = talk.actor === 'tock' ? 'bobbin' : 'tock'
    expect(codes(input(s, { actions }))).toContain('talk_wrong_actor')
    const a2 = clone(s.actions)
    a2['shot-04']!.actions.push({ t: 5, actor: 'tock', action: 'talk', lineId: 'L001' })
    expect(codes(input(s, { actions: a2 }))).toContain('talk_line_not_in_shot')
  })

  it('catches actions that start after or run past the end of the shot, and actors who are not in it', () => {
    const s = buildStory()
    const actions = clone(s.actions)
    actions['shot-05']!.actions.push({ t: 25, actor: 'tock', action: 'wave', dur: 1 })
    actions['shot-05']!.actions.push({ t: 19, actor: 'tock', action: 'wave', dur: 3 })
    actions['shot-05']!.actions.push({ t: 1, actor: 'granny', action: 'wave', dur: 1 })
    expect(codes(input(s, { actions })).sort()).toEqual(['action_after_shot', 'action_overruns', 'actor_not_in_shot'])
  })

  it('reports an actions file that is missing or does not match the format, per shot', () => {
    const s = buildStory()
    const actions: Record<string, unknown> = { ...clone(s.actions), 'shot-06': null, 'shot-07': { shotId: 'shot-07', actions: [{ t: 0, actor: 'tock', action: 'moonwalk' }] } }
    const issues = validateEpisode(input(s, { actions }))
    expect(issues.map((x) => `${x.code}:${x.unit}`).sort()).toEqual(['invalid_file:shot-07', 'missing_file:shot-06'])
  })

  it('checks the shot count and the total duration (warnings)', () => {
    const s = buildStory()
    const few = clone(s.shots)
    few.shots = few.shots.slice(0, 10)
    const issues = validateEpisode(input(s, { shots: few }))
    const w = issues.filter((x) => x.severity === 'warning').map((x) => x.code)
    expect(w).toContain('shot_count')
    expect(w).toContain('total_duration')
    // shots without lines in the dropped part are now not covered
    expect(issues.some((x) => x.code === 'line_uncovered')).toBe(true)
  })

  it('accepts a total within 20 percent of the target and rejects one outside', () => {
    const s = buildStory()
    expect(validateEpisode(input(s, { targetSec: 300 * 1.19 })).map((x) => x.code)).not.toContain('total_duration')
    expect(validateEpisode(input(s, { targetSec: 300 / 0.79 })).map((x) => x.code)).toContain('total_duration')
    expect(validateEpisode(input(s, { targetSec: 600 })).map((x) => x.code)).toContain('total_duration')
  })

  it('warns about shots outside 6 to 20 seconds', () => {
    const s = buildStory()
    const shots = clone(s.shots)
    shots.shots[0]!.duration = 4
    const issues = validateEpisode(input(s, { shots, targetSec: 284 }))
    // the 4 s shot is also too short for the fixture's 4.5 s wave
    expect(issues.map((x) => x.code).sort()).toEqual(['action_overruns', 'shot_duration'])
  })

  it('checks beats, lines and speakers in shots', () => {
    const s = buildStory()
    const shots = clone(s.shots)
    shots.shots[0]!.beats.push('b999')
    shots.shots[1]!.lines.push('L099')
    shots.shots[2]!.cast = ['tock']
    shots.shots[2]!.subjects = ['tock']
    delete shots.shots[2]!.startMarks.bobbin
    const c = codes(input(s, { shots }))
    expect(c).toContain('beat_unknown')
    expect(c).toContain('line_unknown')
    expect(c).toContain('speaker_not_in_shot')
  })

  it('checks music and sound cues', () => {
    const s = buildStory()
    const music = clone(s.music)
    music.cues[0]!.shots.push('shot-99')
    music.cues.pop()
    const sfx = clone(s.sfx)
    sfx.cues.push({ shotId: 'shot-77', t: 1, cue: 'boing', gain: 0.8 }, { shotId: 'shot-01', t: 40, cue: 'boing', gain: 0.8 })
    delete sfx.voices.bobbin
    const issues = validateEpisode(input(s, { music, sfx }))
    expect(issues.map((x) => `${x.task}:${x.code}`).sort()).toEqual(
      ['music:music_gap', 'music:music_shot_unknown', 'sfx:sfx_after_shot', 'sfx:sfx_shot_unknown', 'sfx:voice_missing'].sort()
    )
  })

  it('reports missing and invalid files for their owners', () => {
    const s = buildStory()
    const issues = validateEpisode(input(s, { cast: null, sets: [{ id: 5 }], music: null, sfx: { cues: 'none' } }))
    const by = (t: string) => issues.filter((x) => x.task === t).map((x) => x.code)
    expect(by('cast')).toEqual(['missing_file'])
    expect(by('sets')).toEqual(['invalid_file'])
    expect(by('music')).toEqual(['missing_file'])
    expect(by('sfx')).toEqual(['invalid_file'])
    expect(validateEpisode(input(s, { shots: null })).map((x) => `${x.task}:${x.code}`)).toEqual(['shots:missing_file'])
  })

  it('groups issues by the job that fixes them, one actions job per shot', () => {
    const s = buildStory()
    const actions = clone(s.actions)
    actions['shot-03']!.actions = []
    actions['shot-06']!.actions.push({ t: 1, actor: 'tock', action: 'walk_to', dur: 1 })
    actions['shot-06']!.actions.push({ t: 2, actor: 'tock', action: 'walk_to', target: 'zzz', dur: 1 })
    const groups = groupIssues(validateEpisode(input(s, { actions, cast: [s.cast[0], s.cast[1]], music: null })))
    expect(groups.map((g) => `${g.task}:${g.unit ?? ''}:${g.issues.length}`).sort()).toEqual(['actions:shot-03:1', 'actions:shot-06:2', 'music::1'])
  })

  it('qaResult is ok only without issues', () => {
    expect(qaResult([], 1).ok).toBe(true)
    expect(qaResult([{ task: 'cast', severity: 'warning', code: 'x', message: 'm' }], 0)).toMatchObject({ ok: false, round: 0 })
  })

  it('resolvesTarget knows marks, prop ids, characters and coordinates', () => {
    const set = buildStory().sets[0]!
    const cast = new Set(['tock'])
    expect(resolvesTarget('center', set, cast)).toBe(true)
    expect(resolvesTarget('tocks_house', set, cast)).toBe(true)
    expect(resolvesTarget('tock', set, cast)).toBe(true)
    expect(resolvesTarget([1, 2], set, cast)).toBe(true)
    expect(resolvesTarget('lamp', set, cast)).toBe(false)
  })
})
