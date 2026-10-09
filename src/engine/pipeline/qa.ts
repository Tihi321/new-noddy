import { PROP_RADIUS } from '../anim/target'
import { ACTIONS_NEEDING_TARGET, Music, PuppetSpec, SetLayout, Script, Sfx, ShotActions, Shots } from '../../shared/episode'
import type { ZodType } from 'zod'
import type { QaIssue, QaOwnerTask, QaResult, Shot } from '../../shared/episode'

/** The raw files of an episode, as read from disk (not yet validated). A missing file is `null`. */
export interface QaInput {
  cast: unknown | null
  sets: unknown | null
  script: unknown | null
  shots: unknown | null
  /** Shot id -> raw actions file (null when the file does not exist). Needs a key for every shot id of shots.json. */
  actions: Record<string, unknown | null>
  music: unknown | null
  sfx: unknown | null
  /** Target running time, seconds. */
  targetSec: number
  shotsMin: number
  shotsMax: number
}

/** How far the total shot duration may be from the target (a fraction). */
export const DURATION_TOLERANCE = 0.2
export const SHOT_MIN_SEC = 6
export const SHOT_MAX_SEC = 20

type Mk = (task: QaOwnerTask, severity: 'error' | 'warning', code: string, message: string, unit?: string) => void

const fmt = (n: number) => Math.round(n * 100) / 100

/**
 * The deterministic continuity check. Returns every problem with the task that owns the fix, so the pipeline can send a
 * `fix_<task>` job to the right role. Files that fail their schema are reported as one error for their owner.
 */
export function validateEpisode(input: QaInput): QaIssue[] {
  const issues: QaIssue[] = []
  const mk: Mk = (task, severity, code, message, unit) => issues.push({ task, severity, code, message, ...(unit ? { unit } : {}) })

  const parsed = <T>(label: string, task: QaOwnerTask, raw: unknown, schema: ZodType<T>, unit?: string): T | null => {
    if (raw === null || raw === undefined) {
      mk(task, 'error', 'missing_file', `${label} is missing`, unit)
      return null
    }
    const r = schema.safeParse(raw)
    if (r.success) return r.data
    mk(task, 'error', 'invalid_file', `${label} does not match its format: ${r.error.issues.slice(0, 4).map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`, unit)
    return null
  }
  const listOf = <T>(schema: { safeParse(v: unknown): { success: boolean; data?: unknown } }, raw: unknown): T[] | null => {
    if (!Array.isArray(raw)) return null
    const out: T[] = []
    for (const item of raw) {
      const r = schema.safeParse(item)
      if (!r.success) return null
      out.push(r.data as T)
    }
    return out
  }

  const cast = input.cast === null ? null : listOf<PuppetSpec>(PuppetSpec, input.cast)
  if (input.cast === null) mk('cast', 'error', 'missing_file', 'cast.json is missing')
  else if (!cast) mk('cast', 'error', 'invalid_file', 'cast.json must be a list of puppet specs that match the format')
  const sets = input.sets === null ? null : listOf<SetLayout>(SetLayout, input.sets)
  if (input.sets === null) mk('sets', 'error', 'missing_file', 'sets.json is missing')
  else if (!sets) mk('sets', 'error', 'invalid_file', 'sets.json must be a list of set layouts that match the format')
  const script = input.script === null ? null : Script.safeParse(input.script).data ?? null
  const shotsFile = parsed('shots.json', 'shots', input.shots, Shots)
  const music = parsed('music.json', 'music', input.music, Music)
  const sfx = parsed('sfx.json', 'sfx', input.sfx, Sfx)

  const castIds = new Set((cast ?? []).map((c) => c.id))
  const setById = new Map((sets ?? []).map((s) => [s.id, s]))

  // ---- the script against cast and sets ----
  const lineChar = new Map<string, string>()
  const beatIds = new Set<string>()
  if (script) {
    const usedChars = new Set<string>()
    for (const sc of script.scenes) {
      if (sets && !setById.has(sc.setId)) mk('sets', 'error', 'script_set_missing', `scene ${sc.id} happens in set "${sc.setId}", which is not in sets.json`)
      for (const b of sc.beats) {
        beatIds.add(b.id)
        if (b.kind === 'line' && b.character && b.lineId) {
          lineChar.set(b.lineId, b.character)
          usedChars.add(b.character)
        }
      }
    }
    if (cast) for (const c of usedChars) if (!castIds.has(c)) mk('cast', 'error', 'script_cast_missing', `the script has lines for "${c}", who is not in cast.json`)
  }

  // ---- marks must stand clear of hills (a puppet on a mark inside a hill is hidden by it) ----
  for (const set of sets ?? []) {
    for (const [name, m] of Object.entries(set.marks)) {
      for (const prop of set.props) {
        // only hills: a house or a shop has a door mark in front of it on purpose, but a puppet in a hill is buried by it
        if (prop.kind !== 'hill') continue
        const r = (PROP_RADIUS[prop.kind] ?? 0) * prop.scale * 0.85
        if (Math.hypot(m[0] - prop.pos[0], m[1] - prop.pos[1]) < r) {
          mk('sets', 'warning', 'mark_in_prop', `set ${set.id}: mark "${name}" at [${m[0]}, ${m[1]}] is inside the ${prop.kind} ${prop.id ?? ''} (at [${prop.pos[0]}, ${prop.pos[1]}], scale ${prop.scale}); move the mark or the prop so puppets are not hidden`)
        }
      }
    }
  }

  // ---- shots ----
  const shots: Shot[] = shotsFile?.shots ?? []
  if (shotsFile) {
    const seen = new Set<string>()
    const coveredLines = new Set<string>()
    let total = 0
    for (const s of shots) {
      if (seen.has(s.id)) mk('shots', 'error', 'duplicate_shot', `shot id ${s.id} is used twice`, s.id)
      seen.add(s.id)
      total += s.duration
      if (s.duration < SHOT_MIN_SEC || s.duration > SHOT_MAX_SEC) {
        mk('shots', 'warning', 'shot_duration', `${s.id} lasts ${fmt(s.duration)} s: shots should be ${SHOT_MIN_SEC} to ${SHOT_MAX_SEC} s`, s.id)
      }
      const set = setById.get(s.setId)
      if (sets && !set) mk('shots', 'error', 'shot_set_missing', `${s.id} uses set "${s.setId}", which is not in sets.json`, s.id)
      for (const c of s.cast) if (cast && !castIds.has(c)) mk('shots', 'error', 'shot_cast_missing', `${s.id} has "${c}" in its cast, who is not in cast.json`, s.id)
      for (const c of s.subjects) if (!s.cast.includes(c)) mk('shots', 'error', 'subject_not_in_cast', `${s.id}: subject "${c}" is not in the shot's cast`, s.id)
      for (const [actor, where] of Object.entries(s.startMarks)) {
        if (!s.cast.includes(actor)) mk('shots', 'error', 'mark_actor', `${s.id}: startMarks names "${actor}", who is not in the shot's cast`, s.id)
        if (set && !resolvesTarget(where, set, castIds)) mk('shots', 'error', 'mark_unknown', `${s.id}: start mark "${String(where)}" for ${actor} is not a mark or prop of set ${set.id} (marks: ${Object.keys(set.marks).join(', ') || 'none'})`, s.id)
      }
      if (script) {
        for (const b of s.beats) if (!beatIds.has(b)) mk('shots', 'error', 'beat_unknown', `${s.id} lists beat "${b}", which is not in the script`, s.id)
        for (const l of s.lines) {
          if (!lineChar.has(l)) mk('shots', 'error', 'line_unknown', `${s.id} lists line "${l}", which is not in the script`, s.id)
          else {
            coveredLines.add(l)
            const speaker = lineChar.get(l)!
            if (!s.cast.includes(speaker)) mk('shots', 'error', 'speaker_not_in_shot', `${s.id}: ${speaker} says line ${l} but is not in the shot's cast`, s.id)
          }
        }
      }
    }
    if (script) for (const l of lineChar.keys()) if (!coveredLines.has(l)) mk('shots', 'error', 'line_uncovered', `line ${l} (${lineChar.get(l)}) is not in any shot`)
    if (shots.length < input.shotsMin || shots.length > input.shotsMax) {
      mk('shots', 'warning', 'shot_count', `${shots.length} shots: the plan is ${input.shotsMin} to ${input.shotsMax} shots`)
    }
    const lo = input.targetSec * (1 - DURATION_TOLERANCE)
    const hi = input.targetSec * (1 + DURATION_TOLERANCE)
    if (total < lo || total > hi) {
      mk('shots', 'warning', 'total_duration', `the shots add up to ${fmt(total)} s: the target is ${fmt(input.targetSec)} s (allowed ${fmt(lo)} to ${fmt(hi)} s)`)
    }

    // ---- actions per shot ----
    for (const s of shots) {
      const raw = input.actions[s.id] ?? null
      const file = parsed(`actions/${s.id}.json`, 'actions', raw, ShotActions, s.id)
      if (!file) continue
      const set = setById.get(s.setId)
      if (file.shotId !== s.id) mk('actions', 'error', 'action_shot_id', `actions/${s.id}.json says shotId "${file.shotId}"`, s.id)
      const talked = new Set<string>()
      file.actions.forEach((a, i) => {
        const where = `${s.id} action ${i + 1} (${a.actor} ${a.action} at ${fmt(a.t)} s)`
        if (!s.cast.includes(a.actor)) mk('actions', 'error', 'actor_not_in_shot', `${where}: ${a.actor} is not in the shot's cast (${s.cast.join(', ')})`, s.id)
        if (a.t > s.duration - 0.2) mk('actions', 'error', 'action_after_shot', `${where} starts after the shot ends (${fmt(s.duration)} s)`, s.id)
        else if (a.dur !== undefined && a.t + a.dur > s.duration + 0.05) mk('actions', 'error', 'action_overruns', `${where} runs to ${fmt(a.t + a.dur)} s, past the end of the shot (${fmt(s.duration)} s)`, s.id)
        if (a.target !== undefined) {
          if (set && !resolvesTarget(a.target, set, castIds)) mk('actions', 'error', 'target_unknown', `${where}: target "${String(a.target)}" is not a mark or prop of set ${set.id}, a character, or [x, y]`, s.id)
        } else if (ACTIONS_NEEDING_TARGET.includes(a.action)) {
          mk('actions', 'error', 'target_missing', `${where} needs a target`, s.id)
        }
        if (a.action === 'talk') {
          if (!a.lineId) mk('actions', 'error', 'talk_no_line', `${where}: talk needs a lineId`, s.id)
          else {
            talked.add(a.lineId)
            if (!s.lines.includes(a.lineId)) mk('actions', 'error', 'talk_line_not_in_shot', `${where}: line ${a.lineId} is not in this shot's lines (${s.lines.join(', ') || 'none'})`, s.id)
            const speaker = lineChar.get(a.lineId)
            if (speaker && speaker !== a.actor) mk('actions', 'error', 'talk_wrong_actor', `${where}: line ${a.lineId} belongs to ${speaker}`, s.id)
          }
        }
      })
      for (const l of s.lines) if (!talked.has(l)) mk('actions', 'error', 'line_without_talk', `${s.id}: line ${l} has no talk action`, s.id)
    }
  }

  // ---- music and sfx ----
  const shotIds = new Set(shots.map((s) => s.id))
  if (music && shotsFile) {
    const covered = new Set<string>()
    for (const c of music.cues) {
      for (const sid of c.shots) {
        if (!shotIds.has(sid)) mk('music', 'error', 'music_shot_unknown', `music cue ${c.id} names shot ${sid}, which does not exist`)
        covered.add(sid)
      }
    }
    const bare = shots.filter((s) => !covered.has(s.id)).map((s) => s.id)
    if (bare.length > 0) mk('music', 'warning', 'music_gap', `no music cue covers: ${bare.join(', ')}`)
  }
  if (sfx && shotsFile) {
    for (const c of sfx.cues) {
      const shot = shots.find((s) => s.id === c.shotId)
      if (!shot) mk('sfx', 'error', 'sfx_shot_unknown', `sound cue ${c.cue} names shot ${c.shotId}, which does not exist`)
      else if (c.t > shot.duration) mk('sfx', 'error', 'sfx_after_shot', `sound cue ${c.cue} at ${fmt(c.t)} s is past the end of ${shot.id} (${fmt(shot.duration)} s)`)
    }
    if (cast) for (const id of castIds) if (!sfx.voices[id]) mk('sfx', 'warning', 'voice_missing', `no voice profile for ${id}`)
  }
  return issues
}

/** True when `target` is a mark of the set, a prop id of the set, a character id, or [x, y]. */
export function resolvesTarget(target: string | [number, number], set: SetLayout, castIds: Set<string>): boolean {
  if (Array.isArray(target)) return true
  if (target in set.marks) return true
  if (set.props.some((p) => p.id === target)) return true
  return castIds.has(target)
}

/** Issues grouped by the job that fixes them: `fix_<task>` with the unit (the shot id for actions). */
export interface FixGroup {
  task: QaOwnerTask
  unit: string | null
  issues: QaIssue[]
}

export function groupIssues(issues: QaIssue[]): FixGroup[] {
  const groups = new Map<string, FixGroup>()
  for (const i of issues) {
    const unit = i.task === 'actions' ? (i.unit ?? null) : null
    const key = `${i.task}:${unit ?? ''}`
    const g = groups.get(key) ?? { task: i.task, unit, issues: [] }
    g.issues.push(i)
    groups.set(key, g)
  }
  return [...groups.values()]
}

export function qaResult(issues: QaIssue[], round: number, now = new Date()): QaResult {
  return { ok: issues.length === 0, round, issues, checkedAt: now.toISOString() }
}

/** The issues as plain lines for a prompt. */
export function issueLines(issues: QaIssue[]): string {
  return issues.map((i) => `- [${i.severity}] ${i.message}`).join('\n')
}
