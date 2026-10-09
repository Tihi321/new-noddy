import type { Command, Checkpoint, EpisodeSummary, NewEpisodeCommand } from '../../shared/protocol'
import type { Engine } from '../engine'
import { advance, TERMINAL_STAGES } from './advance'
import type { EpisodeStore } from './episodeStore'

export interface PipelineOptions {
  engine: Engine
  store: EpisodeStore
  /** True when a handler is registered for the task. A stage whose task has no handler waits (one warning), it does not fail. */
  hasHandler: (task: string) => boolean
  /** Interval of the safety tick in ms. Default 5000. */
  tickMs?: number
  log?: (message: string) => void
}

/**
 * Runs the episodes: handles `newEpisode`, `approve` and `requestChanges`, and calls `advance()` for every active
 * episode after each finished job and on a timer. All work runs one after the other, so episode.md is never written twice at once.
 */
export class Pipeline {
  private chain: Promise<unknown> = Promise.resolve()
  private timer: NodeJS.Timeout | undefined
  private tickQueued = false
  private stopped = false
  private readonly warned = new Set<string>()
  private readonly lastSummary = new Map<string, string>()
  private readonly unsubscribe: (() => void)[] = []
  private readonly log: (m: string) => void

  constructor(private readonly o: PipelineOptions) {
    this.log = o.log ?? (() => undefined)
  }

  private get engine(): Engine {
    return this.o.engine
  }
  private get store(): EpisodeStore {
    return this.o.store
  }

  start(): void {
    const { engine } = this
    engine.setEpisodeSource(() => this.store.summaries())
    engine.onCommand('newEpisode', (cmd) => this.command(cmd, (c) => this.newEpisode(c as NewEpisodeCommand)))
    engine.onCommand('approve', (cmd) => this.command(cmd, (c) => this.approve(c as Extract<Command, { type: 'approve' }>)))
    engine.onCommand('retryEpisode', (cmd) => this.command(cmd, (c) => this.retry(c as Extract<Command, { type: 'retryEpisode' }>)))
    engine.onCommand('requestChanges', (cmd) => this.command(cmd, (c) => this.requestChanges(c as Extract<Command, { type: 'requestChanges' }>)))
    this.unsubscribe.push(engine.onEvent((e) => { if (e.type === 'job.done') this.kick() }))
    engine.onConfigChanged((name) => { if (name === 'pipeline') this.kick() })
    this.timer = setInterval(() => this.kick(), this.o.tickMs ?? 5000)
    this.timer.unref?.()
    this.kick()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    for (const u of this.unsubscribe) u()
    await this.chain
  }

  /** Runs one planning pass soon. Passes never overlap, and several requests collapse into one. */
  kick(): void {
    if (this.tickQueued || this.stopped) return
    this.tickQueued = true
    this.chain = this.chain.then(async () => {
      this.tickQueued = false
      try {
        await this.tick()
      } catch (err) {
        this.log(`pipeline tick failed: ${(err as Error).message}`)
      }
    })
  }

  /** Waits until the work asked for so far has run. For tests. */
  async idle(): Promise<void> {
    await this.chain
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn)
    this.chain = p.catch((err) => this.log(`pipeline: ${(err as Error).message}`))
    return p
  }

  private command(cmd: Command, fn: (c: Command) => Promise<void>): Promise<void> {
    return this.run(() => fn(cmd))
  }

  // ---- the planning pass ----

  async tick(): Promise<void> {
    for (const id of await this.store.ids()) {
      const m = await this.store.readMeta(id)
      if (!m || TERMINAL_STAGES.has(m.meta.stage)) continue
      await this.advanceEpisode(id)
    }
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.log(`warning: ${message}`)
    this.engine.emit({ type: 'engine.warning', message })
  }

  /** Applies `advance` to one episode until it has to wait for a job or the user. */
  async advanceEpisode(id: string): Promise<void> {
    for (let depth = 0; depth < 40; depth++) {
      const state = await this.store.loadState(id)
      if (!state) return
      const plan = advance(state, this.engine.pipelineConfig)
      const changed = Object.keys(plan.patch).length > 0
      if (changed) {
        await this.store.updateMeta(id, plan.patch)
        if (plan.patch.stage === 'failed') {
          this.log(`episode ${id} failed: ${plan.patch.error}`)
          this.engine.emit({ type: 'engine.warning', message: `Episode ${id} failed: ${plan.patch.error}` })
        } else if (plan.patch.stage) this.log(`episode ${id}: stage ${state.meta.stage} -> ${plan.patch.stage}`)
      }
      const missing = new Set<string>()
      for (const { body, ...job } of plan.jobs) {
        if (!this.o.hasHandler(job.task)) {
          missing.add(job.task)
          continue
        }
        await this.engine.jobs.enqueue(job, body ?? '')
      }
      if (missing.size > 0) {
        const tasks = [...missing].sort().join(', ')
        this.warnOnce(`${id}:${state.meta.stage}:${tasks}`, `Episode ${id} waits at the "${state.meta.stage}" stage: no handler for ${tasks}. The tool module that runs it is not installed.`)
      }
      if (plan.jobs.length > 0) this.engine.scheduler.kick()
      if (!changed || plan.jobs.length > 0) break
      // the stage changed and there was nothing to enqueue: plan the next stage at once
    }
    await this.announce(id)
  }

  /** Sends `episode.updated` when the summary differs from the last one sent. */
  async announce(id: string): Promise<void> {
    const s = await this.store.summary(id)
    if (!s) return
    const key = JSON.stringify({ ...s, updatedAt: '' })
    if (this.lastSummary.get(id) === key) return
    this.lastSummary.set(id, key)
    this.engine.emit({ type: 'episode.updated', episode: s })
  }

  // ---- commands ----

  async newEpisode(cmd: NewEpisodeCommand): Promise<void> {
    if (!cmd.theme?.trim()) {
      this.engine.emit({ type: 'engine.warning', message: 'newEpisode needs a theme' })
      return
    }
    const meta = await this.store.create({ ...cmd, theme: cmd.theme.trim() })
    this.log(`new episode ${meta.id}: "${meta.theme}" (${meta.type}, ${meta.lengthMin} min)`)
    await this.advanceEpisode(meta.id)
  }

  private async atCheckpoint(id: string, checkpoint: Checkpoint) {
    const m = await this.store.readMeta(id)
    const stage = checkpoint === 'script' ? 'approve_script' : 'approve_animatic'
    if (!m || m.meta.stage !== stage) {
      this.log(`ignored: episode ${id} is not waiting at the ${checkpoint} checkpoint`)
      return null
    }
    return m.meta
  }

  async approve(cmd: { episode: string; checkpoint: Checkpoint }): Promise<void> {
    const meta = await this.atCheckpoint(cmd.episode, cmd.checkpoint)
    if (!meta) return
    await this.store.updateMeta(cmd.episode, { approved: { ...meta.approved, [cmd.checkpoint]: true }, status: 'running' })
    await this.advanceEpisode(cmd.episode)
  }

  async requestChanges(cmd: { episode: string; checkpoint: Checkpoint; note: string }): Promise<void> {
    const meta = await this.atCheckpoint(cmd.episode, cmd.checkpoint)
    if (!meta) return
    const note = cmd.note.trim() || 'Please try again, a little differently.'
    if (cmd.checkpoint === 'script') {
      // The note becomes a review of its own: a revise verdict that always leads to a rewrite, then the story editor looks again.
      const n = meta.round + 1
      await this.store.writeJson(cmd.episode, `reviews/review-${n}.json`, {
        verdict: 'revise',
        source: 'user',
        summary: note,
        issues: [{ problem: note, fix: note }]
      })
      await this.store.updateMeta(cmd.episode, { stage: 'review', status: 'running', round: n, roundBase: n + 1, approved: { ...meta.approved, script: false } })
    } else {
      // A new cut: the director and animator run again with the note; music, sound, QA and the tool stages follow with the new cut number.
      await this.store.updateMeta(cmd.episode, {
        stage: 'shots',
        status: 'running',
        cut: meta.cut + 1,
        cutNote: note,
        qaRound: 0,
        approved: { ...meta.approved, animatic: false }
      })
    }
    await this.advanceEpisode(cmd.episode)
  }

  /** Puts a failed episode back at the stage that failed and queues its failed jobs again. */
  async retry(cmd: { episode: string }): Promise<void> {
    const m = await this.store.readMeta(cmd.episode)
    if (!m || m.meta.stage !== 'failed') {
      this.log(`ignored: episode ${cmd.episode} has not failed`)
      return
    }
    const stage = m.meta.failedStage ?? 'brief'
    for (const jid of await this.engine.jobs.ids('failed')) {
      if (jid.startsWith(`${cmd.episode}--`)) await this.engine.jobs.retryFailed(jid)
    }
    await this.store.updateMeta(cmd.episode, { stage, status: stage.startsWith('approve_') ? 'awaiting_approval' : 'running', error: null, failedStage: null })
    this.warned.clear()
    await this.advanceEpisode(cmd.episode)
    this.engine.scheduler.kick()
  }

  /** For tests and the UI: the summaries as the snapshot would list them. */
  summaries(): Promise<EpisodeSummary[]> {
    return this.store.summaries()
  }
}
