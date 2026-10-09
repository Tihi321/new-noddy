import type { AgentState, AgentSummary, EpisodeSummary, ModelSummary } from '../../shared/protocol'

/** Pipeline stages in order (docs/contracts.md). */
export const STAGES: { id: string; label: string; short: string }[] = [
  { id: 'brief', label: 'Brief', short: 'Brief' },
  { id: 'outline', label: 'Outline', short: 'Outline' },
  { id: 'script', label: 'Script', short: 'Script' },
  { id: 'review', label: 'Story review', short: 'Review' },
  { id: 'approve_script', label: 'Approve script', short: 'OK script' },
  { id: 'design', label: 'Design cast and sets', short: 'Design' },
  { id: 'shots', label: 'Shots', short: 'Shots' },
  { id: 'animate', label: 'Animate, music, sfx', short: 'Animate' },
  { id: 'qa', label: 'Quality check', short: 'QA' },
  { id: 'assets', label: 'Build puppets and sets', short: 'Build' },
  { id: 'voice', label: 'Mumble voices', short: 'Voice' },
  { id: 'compile', label: 'Compile tracks', short: 'Compile' },
  { id: 'mix', label: 'Mix audio', short: 'Mix' },
  { id: 'preview', label: 'Animatic preview', short: 'Preview' },
  { id: 'approve_animatic', label: 'Approve animatic', short: 'OK animatic' },
  { id: 'render', label: 'Render', short: 'Render' },
  { id: 'edit', label: 'Edit', short: 'Edit' },
  { id: 'done', label: 'Done', short: 'Done' }
]

export function stageIndex(stage: string): number {
  const i = STAGES.findIndex((s) => s.id === stage)
  return i < 0 ? 0 : i
}

export const ROOMS: { id: string; label: string }[] = [
  { id: 'writers_room', label: "Writers' Room" },
  { id: 'art_dept', label: 'Art Dept' },
  { id: 'stage', label: 'Stage' },
  { id: 'sound_booth', label: 'Sound Booth' },
  { id: 'workshop', label: 'Workshop' },
  { id: 'render_farm', label: 'Render Farm' },
  { id: 'edit_suite', label: 'Edit Suite' }
]

export function roomLabel(id: string): string {
  return ROOMS.find((r) => r.id === id)?.label ?? id
}

export const EPISODE_TYPE_INFO: Record<string, { icon: string; label: string; blurb: string }> = {
  adventure: { icon: '🧭', label: 'Adventure', blurb: 'A journey with a little problem to solve' },
  lesson: { icon: '🌟', label: 'Lesson', blurb: 'A gentle moral about being kind' },
  mystery: { icon: '🔍', label: 'Mystery', blurb: 'Who took the missing thing?' },
  holiday: { icon: '🎁', label: 'Holiday', blurb: 'A cosy special with presents and songs' },
  comedy: { icon: '🤪', label: 'Comedy', blurb: 'Silly mix-ups and wobbles' }
}

/** Role colours, shared by the Phaser puppets and the CSS chips. */
export const ROLE_COLORS: Record<string, string> = {
  producer: '#d9503f',
  screenwriter: '#8c63d4',
  story_editor: '#2f9e8f',
  character_designer: '#f0709c',
  set_designer: '#f0a030',
  director: '#3f72d6',
  animator: '#74b83c',
  composer: '#e8b800',
  sound_designer: '#f07a3a',
  qa: '#44448f',
  puppet_workshop: '#a0693c',
  animation_compiler: '#5f8a9a',
  foley_booth: '#c9627a',
  preview_crew: '#4ba3c7',
  render_farm: '#8a5a44',
  editor: '#6b7f3a'
}

export function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? '#8a7a68'
}

export const STATE_ICON: Record<AgentState, string> = {
  working: '🔨',
  reviewing: '🔍',
  'waiting-provider': '⏳',
  idle: '💤',
  error: '❗',
  paused: '⏸️'
}

export const STATE_LABEL: Record<AgentState, string> = {
  working: 'working',
  reviewing: 'reviewing',
  'waiting-provider': 'waiting for the model',
  idle: 'idle',
  error: 'error',
  paused: 'paused'
}

export function asAgentState(s: string): AgentState {
  return (['working', 'reviewing', 'waiting-provider', 'idle', 'error', 'paused'] as const).includes(s as AgentState) ? (s as AgentState) : 'idle'
}

export interface AgentView extends AgentSummary {
  since: number
}

export interface HandoverView {
  key: string
  from: string
  to: string
  label: string
  jobId?: string
  startedAt: number
  doneAt?: number
}

/** 1 while a handover is alive, fading to 0. Without a `done` event it expires after a few seconds. */
export function handoverAlpha(h: HandoverView, now: number): number {
  if (h.doneAt !== undefined) {
    const fade = now - h.doneAt
    return fade > 2500 ? 0 : 1 - fade / 2500
  }
  const age = now - h.startedAt
  return age > 7000 ? Math.max(0, 1 - (age - 7000) / 1500) : 1
}

export interface RenderShotProgress {
  label: string
  done: number
  total: number
  firstAt: number
  firstDone: number
  updatedAt: number
}

export interface RenderView {
  jobId: string
  shots: Record<string, RenderShotProgress>
  order: string[]
}

export interface SpendView {
  today: number
  month: number
  dailyCap: number
  monthlyCap: number
}

export function formatUsd(n: number): string {
  if (n === 0) return '$0'
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--'
  const s = Math.round(sec)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** ETA in seconds for one shot, from its own rate since the first sample. Null when unknown. */
export function shotEta(p: RenderShotProgress): number | null {
  const dt = (p.updatedAt - p.firstAt) / 1000
  const df = p.done - p.firstDone
  if (dt <= 0 || df <= 0) return null
  return ((p.total - p.done) * dt) / df
}

/** Overall render summary across the shots seen so far. */
export function renderTotals(r: RenderView | undefined, totalShots: number | null): { done: number; total: number; etaSec: number | null; shotsDone: number; shotsSeen: number } {
  if (!r) return { done: 0, total: 0, etaSec: null, shotsDone: 0, shotsSeen: 0 }
  const list = Object.values(r.shots)
  if (list.length === 0) return { done: 0, total: 0, etaSec: null, shotsDone: 0, shotsSeen: 0 }
  const done = list.reduce((n, p) => n + p.done, 0)
  let total = list.reduce((n, p) => n + p.total, 0)
  const shotsDone = list.filter((p) => p.done >= p.total).length
  if (totalShots && totalShots > list.length) total += Math.round((total / list.length) * (totalShots - list.length))
  const first = Math.min(...list.map((p) => p.firstAt))
  const last = Math.max(...list.map((p) => p.updatedAt))
  const firstDone = list.reduce((n, p) => n + p.firstDone, 0)
  const dt = (last - first) / 1000
  const rate = dt > 0 ? (done - firstDone) / dt : 0
  return { done, total, etaSec: rate > 0 ? (total - done) / rate : null, shotsDone, shotsSeen: list.length }
}

export function providerOf(ref: string | null | undefined): string {
  if (!ref) return ''
  const i = ref.indexOf('/')
  return i < 0 ? ref : ref.slice(0, i)
}

export function modelNameOf(ref: string | null | undefined): string {
  if (!ref) return ''
  const i = ref.indexOf('/')
  return i < 0 ? ref : ref.slice(i + 1)
}

/** Short badge text, for example `qwen3.6-35b`. */
export function shortModel(ref: string | null | undefined): string {
  return modelNameOf(ref)
    .replace(/^ista-daslab-/, '')
    .replace(/^nail-/, '')
    .replace(/-(mtp|gsq|rco|unsloth)\b/g, '')
    .replace(/^claude-/, '')
    .slice(0, 18)
}

export function isLocalModel(ref: string | null | undefined, models: ModelSummary[]): boolean {
  if (!ref) return false
  const m = models.find((x) => x.ref === ref)
  if (m) return m.local
  return ['lmstudio', 'ollama'].includes(providerOf(ref))
}

export function isActiveStatus(e: EpisodeSummary): boolean {
  return e.status === 'running' || e.status === 'awaiting_approval'
}

export function stageLabel(stage: string): string {
  return STAGES.find((s) => s.id === stage)?.label ?? stage
}

/** A made-up mumble for a line of dialogue, the same every time for the same text. */
export function mumbleOf(text: string): string {
  const syl = ['mu', 'ba', 'bo', 'mi', 'da', 'pa', 'lu', 'nee', 'ko', 'wa', 'poo', 'ti']
  const words = text
    .replace(/[^\p{L}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
  let h = 7
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const out = words.map((w) => {
    const n = Math.max(1, Math.min(3, Math.round(w.length / 3)))
    let s = ''
    for (let i = 0; i < n; i++) {
      h = (Math.imul(h, 1103515245) + 12345) >>> 0
      s += syl[(h >>> 8) % syl.length]
    }
    return s
  })
  const tail = /[!?]$/.exec(text.trim())?.[0] ?? '.'
  const joined = out.join(' ')
  return joined.charAt(0).toUpperCase() + joined.slice(1) + tail
}
