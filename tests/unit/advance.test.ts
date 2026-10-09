import { describe, expect, it } from 'vitest'
import { advance, jobId } from '../../src/engine/pipeline/advance'
import type { EpisodeState, JobInfo, Plan } from '../../src/engine/pipeline/advance'
import { EpisodeMeta } from '../../src/shared/episode'
import type { QaIssue, Stage } from '../../src/shared/episode'
import { pipelineSchema } from '../../src/shared/schemas'

const config = pipelineSchema.parse({ kind: 'pipeline' })
const EP = 'windy'
const SHOTS = ['shot-01', 'shot-02', 'shot-03']

function state(over: Partial<Omit<EpisodeState, 'meta'>> & { meta?: Partial<EpisodeMeta>; done?: string[]; failed?: Record<string, string>; running?: string[] } = {}): EpisodeState {
  const jobs = new Map<string, JobInfo>()
  for (const id of over.done ?? []) jobs.set(id, { state: 'done' })
  for (const id of over.running ?? []) jobs.set(id, { state: 'running' })
  for (const [id, failure] of Object.entries(over.failed ?? {})) jobs.set(id, { state: 'failed', failure })
  return {
    id: EP,
    meta: EpisodeMeta.parse({ id: EP, theme: 'a windy day', ...over.meta }),
    jobs,
    reviews: over.reviews ?? new Map(),
    castIds: over.castIds ?? ['tock', 'bobbin'],
    setIds: over.setIds ?? ['town_square', 'pond'],
    shotIds: over.shotIds ?? SHOTS,
    qa: over.qa ?? null,
    writer: over.writer ?? { family: null, agent: null }
  }
}
const j = (task: string, unit: string | null, tag: string) => jobId(EP, task, unit, tag)
const ids = (p: Plan) => p.jobs.map((x) => x.id)
const meta = (stage: Stage, extra: Partial<EpisodeMeta> = {}): Partial<EpisodeMeta> => ({ stage, ...extra })

describe('advance(): job ids', () => {
  it('are episode--task--unit--tag', () => {
    expect(jobId('ep', 'actions', 'shot-01', 'c0')).toBe('ep--actions--shot-01--c0')
    expect(jobId('ep', 'brief', null, 'r0')).toBe('ep--brief--all--r0')
  })
})

describe('advance(): the story stages', () => {
  it('starts with the producer brief job', () => {
    const p = advance(state(), config)
    expect(p.patch).toEqual({})
    expect(p.jobs).toHaveLength(1)
    expect(p.jobs[0]).toMatchObject({ id: j('brief', null, 'r0'), task: 'brief', role: 'producer', episode: EP, requested_by: 'engine' })
  })

  it('is idempotent: the same state gives the same plan, and a queued job is not enqueued again', () => {
    const a = advance(state(), config)
    const b = advance(state(), config)
    expect(a).toEqual(b)
    const waiting = advance(state({ running: [j('brief', null, 'r0')] }), config)
    expect(waiting).toEqual({ patch: {}, jobs: [] })
  })

  it('moves brief -> outline -> script -> review when each job is done', () => {
    const toOutline = advance(state({ done: [j('brief', null, 'r0')] }), config)
    expect(toOutline.patch).toMatchObject({ stage: 'outline', status: 'running' })
    expect(toOutline.jobs).toEqual([])
    expect(advance(state({ meta: meta('outline') }), config).jobs[0]).toMatchObject({ task: 'outline', role: 'screenwriter' })
    expect(advance(state({ meta: meta('outline'), done: [j('outline', null, 'r0')] }), config).patch.stage).toBe('script')
    expect(advance(state({ meta: meta('script'), done: [j('script', null, 'r0')] }), config).patch.stage).toBe('review')
  })

  it('asks the story editor for review 0 and prefers another model family than the writer', () => {
    const p = advance(state({ meta: meta('review'), writer: { family: 'claude', agent: 'screenwriter-x' } }), config)
    expect(p.jobs).toHaveLength(1)
    expect(p.jobs[0]).toMatchObject({ id: j('review', null, 'r0'), role: 'story_editor', round: 0, avoid_family: 'claude' })
  })

  it('a revise verdict leads to a rewrite by the writer, then to the next review', () => {
    const rv = new Map([[0, { verdict: 'revise' as const, source: 'editor' as const }]])
    const p = advance(state({ meta: meta('review'), reviews: rv, done: [j('review', null, 'r0')], writer: { family: 'claude', agent: 'screenwriter-x' } }), config)
    expect(p.jobs[0]).toMatchObject({ id: j('rewrite', null, 'r0'), task: 'rewrite', role: 'screenwriter', agent_hint: 'screenwriter-x' })
    const after = advance(state({ meta: meta('review'), reviews: rv, done: [j('review', null, 'r0'), j('rewrite', null, 'r0')] }), config)
    expect(after.patch).toEqual({ round: 1 })
    expect(after.jobs).toEqual([])
    const next = advance(state({ meta: meta('review', { round: 1 }), reviews: rv }), config)
    expect(next.jobs[0]).toMatchObject({ id: j('review', null, 'r1'), round: 1 })
  })

  it('stops the rewrite loop after max rounds and goes on to approval', () => {
    const rv = new Map([
      [0, { verdict: 'revise' as const, source: 'editor' as const }],
      [1, { verdict: 'revise' as const, source: 'editor' as const }],
      [2, { verdict: 'revise' as const, source: 'editor' as const }]
    ])
    const p = advance(state({ meta: meta('review', { round: 2 }), reviews: rv }), config)
    expect(p.jobs).toEqual([])
    expect(p.patch).toMatchObject({ stage: 'approve_script', status: 'awaiting_approval' })
    // with approvals switched off it goes straight to design
    expect(advance(state({ meta: meta('review', { round: 2, approvals: { script: false, animatic: true } }), reviews: rv }), config).patch.stage).toBe('design')
  })

  it('always rewrites after a change request from the user, and counts the editor rounds from there', () => {
    const rv = new Map([
      [2, { verdict: 'revise' as const, source: 'editor' as const }],
      [3, { verdict: 'revise' as const, source: 'user' as const }]
    ])
    const p = advance(state({ meta: meta('review', { round: 3, roundBase: 4 }), reviews: rv }), config)
    expect(p.jobs[0]).toMatchObject({ id: j('rewrite', null, 'r3'), task: 'rewrite' })
    // the editor may ask for rewrites again after the user's round
    rv.set(4, { verdict: 'revise', source: 'editor' })
    expect(advance(state({ meta: meta('review', { round: 4, roundBase: 4 }), reviews: rv }), config).jobs[0]).toMatchObject({ task: 'rewrite' })
  })

  it('a pass verdict goes to the script approval, which parks until approved', () => {
    const rv = new Map([[0, { verdict: 'pass' as const, source: 'editor' as const }]])
    const p = advance(state({ meta: meta('review'), reviews: rv }), config)
    expect(p.patch).toMatchObject({ stage: 'approve_script', status: 'awaiting_approval' })
    // parked: nothing to do while awaiting
    const parked = advance(state({ meta: meta('approve_script', { status: 'awaiting_approval' }) }), config)
    expect(parked).toEqual({ patch: {}, jobs: [] })
    // an engine restart in the middle: status says running, so it is restored
    expect(advance(state({ meta: meta('approve_script', { status: 'running' }) }), config).patch).toEqual({ status: 'awaiting_approval' })
    const approved = advance(state({ meta: meta('approve_script', { status: 'running', approved: { script: true, animatic: false } }) }), config)
    expect(approved.patch).toMatchObject({ stage: 'design', status: 'running' })
  })

  it('designs cast and sets in parallel, then moves to the director', () => {
    const p = advance(state({ meta: meta('design') }), config)
    expect(ids(p).sort()).toEqual([j('cast', null, 'r0'), j('sets', null, 'r0')])
    expect(p.jobs.map((x) => x.role).sort()).toEqual(['character_designer', 'set_designer'])
    expect(advance(state({ meta: meta('design'), done: [j('cast', null, 'r0')] }), config).jobs.map((x) => x.task)).toEqual(['sets'])
    expect(advance(state({ meta: meta('design'), done: [j('cast', null, 'r0'), j('sets', null, 'r0')] }), config).patch.stage).toBe('shots')
  })

  it('the director plans shots, then the animator, composer and sound designer run in parallel', () => {
    expect(advance(state({ meta: meta('shots') }), config).jobs[0]).toMatchObject({ id: j('shots', null, 'c0'), role: 'director' })
    expect(advance(state({ meta: meta('shots'), done: [j('shots', null, 'c0')] }), config).patch.stage).toBe('animate')
    const p = advance(state({ meta: meta('animate') }), config)
    expect(ids(p)).toEqual([...SHOTS.map((s) => j('actions', s, 'c0')), j('music', null, 'c0'), j('sfx', null, 'c0')])
    expect(p.jobs.filter((x) => x.task === 'actions').every((x) => x.role === 'animator')).toBe(true)
    // one of them still running: wait, and enqueue only what is missing
    const some = advance(state({ meta: meta('animate'), done: [j('actions', 'shot-01', 'c0')], running: [j('actions', 'shot-02', 'c0')] }), config)
    expect(ids(some)).toEqual([j('actions', 'shot-03', 'c0'), j('music', null, 'c0'), j('sfx', null, 'c0')])
    const all = [...SHOTS.map((s) => j('actions', s, 'c0')), j('music', null, 'c0'), j('sfx', null, 'c0')]
    expect(advance(state({ meta: meta('animate', { qaRound: 1 }), done: all }), config).patch).toMatchObject({ stage: 'qa', qaRound: 0 })
  })

  it('fails when the director produced no shots', () => {
    expect(advance(state({ meta: meta('animate'), shotIds: [] }), config).patch).toMatchObject({ stage: 'failed', status: 'failed' })
  })
})

const issue = (task: QaIssue['task'], severity: 'error' | 'warning', unit?: string): QaIssue => ({ task, severity, code: 'x', message: `${task} ${unit ?? ''} is wrong`, ...(unit ? { unit } : {}) })
const qaDone = (q: number) => j('qa', null, `c0q${q}`)

describe('advance(): QA', () => {
  it('enqueues the QA check, then waits for it', () => {
    const p = advance(state({ meta: meta('qa') }), config)
    expect(p.jobs[0]).toMatchObject({ id: qaDone(0), task: 'qa', role: 'qa', round: 0 })
    expect(advance(state({ meta: meta('qa'), running: [qaDone(0)] }), config)).toEqual({ patch: {}, jobs: [] })
  })

  it('goes on to the assets when QA is clean', () => {
    const qa = { ok: true, round: 0, issues: [], checkedAt: 'now' }
    expect(advance(state({ meta: meta('qa'), done: [qaDone(0)], qa }), config).patch.stage).toBe('assets')
  })

  it('sends each problem to its owner as fix_<task>, one actions job per shot', () => {
    const issues = [issue('shots', 'error'), issue('actions', 'error', 'shot-02'), issue('actions', 'error', 'shot-02'), issue('actions', 'warning', 'shot-03'), issue('cast', 'error')]
    const qa = { ok: false, round: 0, issues, checkedAt: 'now' }
    const p = advance(state({ meta: meta('qa'), done: [qaDone(0)], qa }), config)
    expect(ids(p).sort()).toEqual(
      [j('fix_shots', null, 'c0q1'), j('fix_actions', 'shot-02', 'c0q1'), j('fix_cast', null, 'c0q1')].sort() // shot-03 has only a warning
    )
    const byTask = Object.fromEntries(p.jobs.map((x) => [x.task + (x.unit ?? ''), x]))
    expect(byTask['fix_shots']!.role).toBe('director')
    expect(byTask['fix_actionsshot-02']!.role).toBe('animator')
    expect(byTask['fix_cast']!.role).toBe('character_designer')
    expect(byTask['fix_actionsshot-02']!.body).toContain('actions shot-02 is wrong')
    // when the fixes are done, QA runs again as round 1
    const fixed = [...ids(p)]
    expect(advance(state({ meta: meta('qa'), done: [qaDone(0), ...fixed], qa }), config).patch).toEqual({ qaRound: 1 })
    expect(advance(state({ meta: meta('qa', { qaRound: 1 }), done: [qaDone(0), ...fixed] }), config).jobs[0]).toMatchObject({ id: qaDone(1), round: 1 })
  })

  it('never spends a fix round on warnings alone, and lets warnings ride along with an error of the same owner', () => {
    const warnOnly = { ok: false, round: 0, issues: [issue('shots', 'warning'), issue('actions', 'warning', 'shot-01')], checkedAt: 'now' }
    const p = advance(state({ meta: meta('qa'), done: [qaDone(0)], qa: warnOnly }), config)
    expect(p.patch.stage).toBe('assets')
    expect(p.jobs).toEqual([])
    const mixed = { ok: false, round: 0, issues: [issue('shots', 'warning'), issue('shots', 'error')], checkedAt: 'now' }
    const q = advance(state({ meta: meta('qa'), done: [qaDone(0)], qa: mixed }), config)
    expect(q.jobs).toHaveLength(1)
    expect(q.jobs[0]!.body).toContain('[warning]')
  })

  it('after the last fix round, errors fail the episode and warnings do not', () => {
    const errors = { ok: false, round: 2, issues: [issue('shots', 'error'), issue('music', 'warning')], checkedAt: 'now' }
    const failed = advance(state({ meta: meta('qa', { qaRound: 2 }), done: [qaDone(2)], qa: errors }), config)
    expect(failed.patch).toMatchObject({ stage: 'failed', status: 'failed' })
    expect(failed.patch.error).toContain('shots')
    const warnings = { ok: false, round: 2, issues: [issue('music', 'warning')], checkedAt: 'now' }
    expect(advance(state({ meta: meta('qa', { qaRound: 2 }), done: [qaDone(2)], qa: warnings }), config).patch.stage).toBe('assets')
  })

  it('fails when QA wrote no result for its round', () => {
    expect(advance(state({ meta: meta('qa'), done: [qaDone(0)] }), config).patch.stage).toBe('failed')
  })
})

describe('advance(): the tool stages', () => {
  it('builds a puppet per cast member and a set per set, with the tool roles', () => {
    const p = advance(state({ meta: meta('assets') }), config)
    expect(ids(p)).toEqual([j('build_puppet', 'tock', 'r0'), j('build_puppet', 'bobbin', 'r0'), j('build_set', 'town_square', 'r0'), j('build_set', 'pond', 'r0')])
    expect(new Set(p.jobs.map((x) => x.role))).toEqual(new Set(['puppet_workshop']))
  })

  it('walks voice, compile, mix with the contract task names and roles', () => {
    const cases: [Stage, string, string, Stage][] = [
      ['voice', 'voice_lines', 'foley_booth', 'compile'],
      ['compile', 'compile_tracks', 'animation_compiler', 'mix'],
      ['mix', 'mix_audio', 'foley_booth', 'preview']
    ]
    for (const [stage, task, role, next] of cases) {
      const p = advance(state({ meta: meta(stage) }), config)
      expect(p.jobs).toHaveLength(1)
      expect(p.jobs[0]).toMatchObject({ task, role })
      const tag = stage === 'voice' ? 'r0' : 'c0'
      expect(advance(state({ meta: meta(stage), done: [j(task, null, tag)] }), config).patch.stage).toBe(next)
    }
  })

  it('previews every shot, then the animatic, then parks at the animatic approval', () => {
    const p = advance(state({ meta: meta('preview') }), config)
    expect(ids(p)).toEqual(SHOTS.map((s) => j('preview_shot', s, 'c0')))
    expect(p.jobs[0]!.role).toBe('preview_crew')
    const previews = SHOTS.map((s) => j('preview_shot', s, 'c0'))
    const anim = advance(state({ meta: meta('preview'), done: previews }), config)
    expect(ids(anim)).toEqual([j('animatic', null, 'c0')])
    const next = advance(state({ meta: meta('preview'), done: [...previews, j('animatic', null, 'c0')] }), config)
    expect(next.patch).toMatchObject({ stage: 'approve_animatic', status: 'awaiting_approval' })
    expect(advance(state({ meta: meta('approve_animatic', { status: 'awaiting_approval' }) }), config)).toEqual({ patch: {}, jobs: [] })
    expect(advance(state({ meta: meta('approve_animatic', { approved: { script: true, animatic: true } }) }), config).patch.stage).toBe('render')
    const skip = advance(state({ meta: meta('preview', { approvals: { script: true, animatic: false } }), done: [...previews, j('animatic', null, 'c0')] }), config)
    expect(skip.patch.stage).toBe('render')
  })

  it('renders every shot, edits, and finishes', () => {
    const r = advance(state({ meta: meta('render') }), config)
    expect(ids(r)).toEqual(SHOTS.map((s) => j('render_shot', s, 'c0')))
    expect(r.jobs[0]!.role).toBe('render_farm')
    expect(advance(state({ meta: meta('render'), done: ids(r) }), config).patch.stage).toBe('edit')
    const e = advance(state({ meta: meta('edit') }), config)
    expect(e.jobs[0]).toMatchObject({ task: 'edit_episode', role: 'editor' })
    expect(advance(state({ meta: meta('edit'), done: [j('edit_episode', null, 'c0')] }), config).patch).toMatchObject({ stage: 'done', status: 'done' })
  })

  it('does nothing for a finished or failed episode', () => {
    expect(advance(state({ meta: meta('done', { status: 'done' }) }), config)).toEqual({ patch: {}, jobs: [] })
    expect(advance(state({ meta: meta('failed', { status: 'failed' }) }), config)).toEqual({ patch: {}, jobs: [] })
  })
})

describe('advance(): cuts after "request changes" at the animatic', () => {
  it('uses new job ids for the new cut and gives the user note to the director', () => {
    const p = advance(state({ meta: meta('shots', { cut: 1, cutNote: 'make it shorter' }), done: [j('shots', null, 'c0')] }), config)
    expect(p.jobs).toHaveLength(1)
    expect(p.jobs[0]).toMatchObject({ id: j('shots', null, 'c1'), body: 'make it shorter', round: 1 })
    const animate = advance(state({ meta: meta('animate', { cut: 1, cutNote: 'make it shorter' }) }), config)
    expect(animate.jobs[0]).toMatchObject({ id: j('actions', 'shot-01', 'c1'), body: 'make it shorter' })
    expect(animate.jobs.find((x) => x.task === 'music')!.id).toBe(j('music', null, 'c1'))
  })
})

describe('advance(): failures', () => {
  it('a failed job fails the stage with its reason', () => {
    const p = advance(state({ meta: meta('brief'), failed: { [j('brief', null, 'r0')]: 'the model did not return valid JSON twice' } }), config)
    expect(p.patch).toMatchObject({ stage: 'failed', status: 'failed' })
    expect(p.patch.error).toContain('brief failed')
    expect(p.patch.error).toContain('valid JSON')
    expect(p.jobs).toEqual([])
  })
  it('a failed unit job in a parallel stage fails the episode, naming the unit', () => {
    const p = advance(state({ meta: meta('animate'), failed: { [j('actions', 'shot-02', 'c0')]: 'boom' } }), config)
    expect(p.patch.stage).toBe('failed')
    expect(p.patch.error).toContain('actions shot-02')
  })
  it('a failed tool job fails the episode', () => {
    const p = advance(state({ meta: meta('render'), failed: { [j('render_shot', 'shot-01', 'c0')]: 'blender crashed' } }), config)
    expect(p.patch.error).toBe('render_shot shot-01 failed: blender crashed')
  })
  it('review finishing without a verdict file fails instead of looping', () => {
    expect(advance(state({ meta: meta('review'), done: [j('review', null, 'r0')] }), config).patch.stage).toBe('failed')
  })
})

describe('advance(): a whole episode', () => {
  it('visits every stage of the contract in order and ends at done', () => {
    let s = state()
    const visited: string[] = [s.meta.stage]
    const doneJobs = new Set<string>()
    for (let step = 0; step < 200 && s.meta.stage !== 'done'; step++) {
      const plan = advance(s, config)
      let meta2 = { ...s.meta, ...plan.patch } as EpisodeMeta
      for (const job of plan.jobs) doneJobs.add(job.id) // the jobs finish at once
      const reviews = new Map(s.reviews)
      if (s.meta.stage === 'review') reviews.set(s.meta.round, { verdict: 'pass', source: 'editor' })
      const approved = { ...meta2.approved }
      if (meta2.stage === 'approve_script') approved.script = true
      if (meta2.stage === 'approve_animatic') approved.animatic = true
      meta2 = { ...meta2, approved }
      const qa = s.meta.stage === 'qa' && plan.jobs.length ? { ok: true, round: 0, issues: [], checkedAt: 'now' } : s.qa
      s = state({ meta: meta2, reviews, qa, done: [...doneJobs] })
      if (visited.at(-1) !== s.meta.stage) visited.push(s.meta.stage)
    }
    expect(visited).toEqual([
      'brief', 'outline', 'script', 'review', 'approve_script', 'design', 'shots', 'animate', 'qa', 'assets', 'voice', 'compile', 'mix', 'preview',
      'approve_animatic', 'render', 'edit', 'done'
    ])
  })
})
