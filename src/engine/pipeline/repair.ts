import type { ActionStep, Shot } from '../../shared/episode'

/** Rough length of a spoken (mumbled) line in seconds, used only to place a talk action the animator forgot. */
export function estimateLineSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.min(4, Math.max(1.2, 0.35 * words + 0.6))
}

/**
 * Small deterministic repairs of an animator reply, so a local model's timing slips do not cost a whole QA round:
 * actions are sorted, an action that runs past the end of the shot gets a shorter `dur`, an action that starts after the
 * end is dropped, and a line of the shot that has no `talk` action gets one (at the next free moment of its speaker).
 * Anything else (unknown targets, wrong actors) is left for QA and the animator's fix job.
 */
export function repairActions(
  shot: Pick<Shot, 'duration' | 'lines' | 'cast'>,
  actions: ActionStep[],
  lines: { lineId: string; character: string; text: string }[]
): { actions: ActionStep[]; notes: string[] } {
  const notes: string[] = []
  const end = shot.duration
  let out: ActionStep[] = []
  const xy = /^\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]$/
  for (let a of [...actions].sort((x, y) => x.t - y.t)) {
    if (!shot.cast.includes(a.actor)) {
      notes.push(`dropped ${a.action} by ${a.actor} (not in the shot's cast)`)
      continue
    }
    if (typeof a.target === 'string') {
      const m = xy.exec(a.target.trim())
      if (m) a = { ...a, target: [Number(m[1]), Number(m[2])] }
    }
    if (a.t > end - 0.2) {
      notes.push(`dropped ${a.action} by ${a.actor} at ${a.t} s (after the end of the shot)`)
      continue
    }
    if (a.dur !== undefined && a.t + a.dur > end + 0.05) {
      const dur = Math.max(0.2, Math.round((end - a.t) * 100) / 100)
      notes.push(`shortened ${a.action} by ${a.actor} at ${a.t} s to ${dur} s`)
      out.push({ ...a, dur })
    } else out.push(a)
  }
  const talked = new Set(out.filter((a) => a.action === 'talk' && a.lineId).map((a) => a.lineId))
  for (const l of lines) {
    if (!shot.lines.includes(l.lineId) || talked.has(l.lineId)) continue
    // after the last talk of anyone in this shot, so voices do not overlap
    const sec = estimateLineSec(l.text)
    let t = 0.4
    for (const a of out) if (a.action === 'talk') t = Math.max(t, a.t + estimateLineSec(lines.find((x) => x.lineId === a.lineId)?.text ?? '') + 0.3)
    t = Math.min(t, Math.max(0, end - sec - 0.2))
    out.push({ t: Math.round(t * 100) / 100, actor: l.character, action: 'talk', lineId: l.lineId })
    notes.push(`added the missing talk for line ${l.lineId} at ${Math.round(t * 100) / 100} s`)
    out = out.sort((x, y) => x.t - y.t)
  }
  return { actions: out, notes }
}

/**
 * A director that plans a bit short (or long) is nudged to the target: when the shots add up to less than 85 percent
 * (or more than 115 percent) of the target, every duration is scaled towards it, within 6 to 20 s and in half seconds.
 * Local models often plan 13 shots of 150 s for a 300 s episode, and a re-ask rarely helps.
 */
export function fitShotDurations<T extends { duration: number }>(shots: T[], targetSec: number, min = 6, max = 20): { shots: T[]; note: string | null } {
  const total = shots.reduce((n, s) => n + s.duration, 0)
  if (shots.length === 0 || targetSec <= 0 || (total >= targetSec * 0.85 && total <= targetSec * 1.15)) return { shots, note: null }
  const goal = total < targetSec ? targetSec * 0.95 : targetSec * 1.05
  const k = Math.min(1.6, Math.max(0.6, goal / total))
  const out = shots.map((s) => ({ ...s, duration: Math.min(max, Math.max(min, Math.round(s.duration * k * 2) / 2)) }))
  const now = out.reduce((n, s) => n + s.duration, 0)
  return { shots: out, note: `scaled the shot durations by ${Math.round(k * 100) / 100}: ${Math.round(total)} s to ${Math.round(now)} s (target ${Math.round(targetSec)} s)` }
}
