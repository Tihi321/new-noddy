import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ZodType } from 'zod'
import { EpisodeMeta } from '../../shared/episode'
import { QaResult as QaResultSchema } from '../../shared/episode'
import type { QaResult } from '../../shared/episode'
import { parseMd } from '../../shared/md'
import type { Checkpoint, EpisodeSummary, NewEpisodeCommand } from '../../shared/protocol'
import type { JobState, JobStore } from '../queue/jobs'
import { atomicWrite, writeMd } from '../store/atomic'
import type { EpisodeState } from './advance'

/** Folder name for a theme: lowercase words joined by single hyphens (never a double hyphen, job ids rely on that). */
export function slugify(text: string, max = 40): string {
  const s = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return s || 'episode'
}

const ASSET_FILES: [string, string][] = [
  ['brief', 'brief.md'],
  ['outline', 'outline.md'],
  ['script', 'script.md'],
  ['shots', 'shots.json'],
  ['qa', 'qa.json'],
  ['audio', 'audio/episode.wav'],
  ['animatic', 'preview/animatic.mp4'],
  ['final', 'out/episode.mp4']
]

export interface EpisodeStoreOptions {
  /** Spend of one episode in USD (the budget). */
  cost?: (episode: string) => number
}

/**
 * The episodes/ folder: one folder per episode, `episode.md` for its state, JSON files for the crew's output
 * (see docs/contracts.md). Every write is atomic.
 */
export class EpisodeStore {
  constructor(
    private readonly dataDir: string,
    private readonly jobs: JobStore,
    private readonly opts: EpisodeStoreOptions = {}
  ) {}

  get root(): string {
    return path.join(this.dataDir, 'episodes')
  }
  dir(id: string): string {
    return path.join(this.root, id)
  }
  file(id: string, ...parts: string[]): string {
    return path.join(this.dir(id), ...parts)
  }
  /** Path relative to the data folder, with forward slashes (for events and summaries). */
  rel(id: string, ...parts: string[]): string {
    return ['episodes', id, ...parts].join('/')
  }

  async ids(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true })
      const out: string[] = []
      for (const e of entries) if (e.isDirectory() && (await this.exists(e.name, 'episode.md'))) out.push(e.name)
      return out.sort()
    } catch {
      return []
    }
  }

  // ---- files ----

  async exists(id: string, ...parts: string[]): Promise<boolean> {
    try {
      await fs.access(this.file(id, ...parts))
      return true
    } catch {
      return false
    }
  }

  async readText(id: string, ...parts: string[]): Promise<string | null> {
    try {
      return await fs.readFile(this.file(id, ...parts), 'utf8')
    } catch {
      return null
    }
  }

  /** Parsed JSON, or null when the file is missing or not JSON. */
  async readJson(id: string, ...parts: string[]): Promise<unknown | null> {
    const text = await this.readText(id, ...parts)
    if (text === null) return null
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  /** Reads and validates. Throws when the file is missing or invalid. */
  async readValid<T>(id: string, rel: string, schema: ZodType<T>): Promise<T> {
    const raw = await this.readText(id, ...rel.split('/'))
    if (raw === null) throw new Error(`${rel} is missing in episode ${id}`)
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch (err) {
      throw new Error(`${rel} is not valid JSON: ${(err as Error).message}`, { cause: err })
    }
    const r = schema.safeParse(json)
    if (!r.success) throw new Error(`${rel} is invalid: ${r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
    return r.data
  }

  async writeJson(id: string, rel: string, value: unknown): Promise<void> {
    await atomicWrite(this.file(id, ...rel.split('/')), JSON.stringify(value, null, 2) + '\n')
  }

  async writeText(id: string, rel: string, text: string): Promise<void> {
    await atomicWrite(this.file(id, ...rel.split('/')), text.endsWith('\n') ? text : text + '\n')
  }

  /** File names in a sub folder of the episode (empty when it does not exist). */
  async list(id: string, ...parts: string[]): Promise<string[]> {
    try {
      return (await fs.readdir(this.file(id, ...parts))).filter((f) => !f.includes('.tmp-'))
    } catch {
      return []
    }
  }

  // ---- episode.md ----

  async readMeta(id: string): Promise<{ meta: EpisodeMeta; body: string; raw: Record<string, unknown> } | null> {
    let text: string
    try {
      text = await fs.readFile(this.file(id, 'episode.md'), 'utf8')
    } catch {
      return null
    }
    const doc = parseMd(text, `episodes/${id}/episode.md`)
    const parsed = EpisodeMeta.safeParse({ ...doc.data, id })
    if (!parsed.success) return null
    return { meta: parsed.data, body: doc.body, raw: doc.data }
  }

  /** Merges `patch` into episode.md (unknown fields are kept). Returns the new state. */
  async updateMeta(id: string, patch: Partial<EpisodeMeta>): Promise<EpisodeMeta> {
    const cur = await this.readMeta(id)
    if (!cur) throw new Error(`episode ${id} not found`)
    const merged = { ...cur.raw, ...patch, updatedAt: new Date().toISOString() } as Record<string, unknown>
    delete merged.id
    await writeMd(this.file(id, 'episode.md'), merged, cur.body)
    return EpisodeMeta.parse({ ...merged, id })
  }

  /** Writes the title into episode.md as soon as brief or script knows it (a no-op for an empty or unchanged title). */
  async setTitle(id: string, title: string): Promise<void> {
    const t = title.trim()
    if (!t) return
    const cur = await this.readMeta(id)
    if (!cur || cur.meta.title === t) return
    await this.updateMeta(id, { title: t })
  }

  /** Creates the folder and episode.md for a `newEpisode` command. */
  async create(cmd: NewEpisodeCommand): Promise<EpisodeMeta> {
    await fs.mkdir(this.root, { recursive: true })
    const base = slugify(cmd.theme)
    let id = base
    for (let n = 2; ; n++) {
      try {
        await fs.mkdir(this.dir(id))
        break
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        id = `${base}-${n}`
      }
    }
    const now = new Date().toISOString()
    const data = {
      kind: 'episode',
      title: '',
      theme: cmd.theme,
      type: cmd.episodeType,
      style: cmd.style || 'toyland-wood',
      lengthMin: cmd.lengthMin > 0 ? cmd.lengthMin : 5,
      characters: cmd.characters,
      stage: 'brief',
      status: 'running',
      approvals: { script: cmd.approvals.script, animatic: cmd.approvals.animatic },
      approved: { script: false, animatic: false },
      round: 0,
      roundBase: 0,
      qaRound: 0,
      cut: 0,
      cutNote: '',
      error: null,
      createdAt: now,
      updatedAt: now
    }
    await writeMd(this.file(id, 'episode.md'), data, `# ${cmd.theme}\n\nA ${cmd.episodeType} episode of about ${data.lengthMin} minutes. The crew's work is in the files next to this one.\n`)
    return EpisodeMeta.parse({ ...data, id })
  }

  // ---- state for advance() ----

  async loadState(id: string): Promise<EpisodeState | null> {
    const m = await this.readMeta(id)
    if (!m) return null
    const jobs = new Map<string, { state: JobState; failure?: string }>()
    const prefix = `${id}--`
    for (const state of ['queued', 'running', 'done', 'failed'] as const) {
      for (const jid of await this.jobs.ids(state)) {
        if (!jid.startsWith(prefix)) continue
        let failure: string | undefined
        if (state === 'failed') {
          const j = await this.jobs.read('failed', jid).catch(() => null)
          const f = (j?.data as Record<string, unknown> | undefined)?.failure
          failure = typeof f === 'string' ? f : undefined
        }
        jobs.set(jid, { state, ...(failure ? { failure } : {}) })
      }
    }
    const reviews = new Map<number, { verdict: 'pass' | 'revise'; source: 'editor' | 'user' }>()
    for (const f of await this.list(id, 'reviews')) {
      const mt = /^review-(\d+)\.json$/.exec(f)
      if (!mt) continue
      const raw = (await this.readJson(id, 'reviews', f)) as { verdict?: string; source?: string } | null
      if (!raw) continue
      reviews.set(Number(mt[1]), { verdict: raw.verdict === 'pass' ? 'pass' : 'revise', source: raw.source === 'user' ? 'user' : 'editor' })
    }
    const ids = async (rel: string, key: string): Promise<string[]> => {
      const raw = await this.readJson(id, rel)
      const arr = key ? (raw as Record<string, unknown> | null)?.[key] : raw
      if (!Array.isArray(arr)) return []
      return arr.map((x) => (x as { id?: unknown } | null)?.id).filter((x): x is string => typeof x === 'string')
    }
    const qaRaw = await this.readJson(id, 'qa.json')
    const qa = qaRaw ? QaResultSchema.safeParse(qaRaw) : null
    const writer = ((await this.readJson(id, 'notes', 'writer.json')) ?? {}) as { family?: string; agent?: string }
    return {
      id,
      meta: m.meta,
      jobs,
      reviews,
      castIds: await ids('cast.json', ''),
      setIds: await ids('sets.json', ''),
      shotIds: await ids('shots.json', 'shots'),
      qa: qa?.success ? (qa.data as QaResult) : null,
      writer: { family: writer.family ?? null, agent: writer.agent ?? null }
    }
  }

  // ---- summary for the UI ----

  async summary(id: string): Promise<EpisodeSummary | null> {
    const m = await this.readMeta(id)
    if (!m) return null
    const { meta } = m
    const script = (await this.readJson(id, 'script.json')) as { title?: unknown } | null
    const brief = (await this.readJson(id, 'brief.json')) as { title?: unknown } | null
    const title = [script?.title, brief?.title, meta.title].find((t): t is string => typeof t === 'string' && t.trim() !== '') ?? meta.theme
    const shotsRaw = (await this.readJson(id, 'shots.json')) as { shots?: unknown } | null
    const assets: Record<string, string> = {}
    for (const [key, rel] of ASSET_FILES) if (await this.exists(id, ...rel.split('/'))) assets[key] = this.rel(id, ...rel.split('/'))
    const awaiting: Checkpoint | null =
      meta.status === 'awaiting_approval' ? (meta.stage === 'approve_script' ? 'script' : meta.stage === 'approve_animatic' ? 'animatic' : null) : null
    return {
      id,
      title,
      theme: meta.theme,
      type: meta.type,
      stage: meta.stage,
      status: meta.status,
      awaiting,
      lengthMin: meta.lengthMin,
      shots: Array.isArray(shotsRaw?.shots) ? shotsRaw.shots.length : null,
      costUsd: this.opts.cost?.(id) ?? 0,
      assets,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt || meta.createdAt
    }
  }

  async summaries(): Promise<EpisodeSummary[]> {
    const out: EpisodeSummary[] = []
    for (const id of await this.ids()) {
      const s = await this.summary(id)
      if (s) out.push(s)
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
}
