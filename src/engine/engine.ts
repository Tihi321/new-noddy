import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CastInfo, Command, CommandType, EngineEvent, EpisodeSummary, SnapshotEvent, StyleInfo, ToolInfo } from '../shared/protocol'
import { parseMd, parseMdWith } from '../shared/md'
import { pipelineSchema, toolsSchema } from '../shared/schemas'
import type { PipelineConfig, ToolsConfig } from '../shared/schemas'
import { AgentStore } from './agents/agents'
import { Budget } from './budget/spend'
import { LogWriter } from './logs/logs'
import { resolveKey } from './models/keys'
import { ModelRegistry } from './models/registry'
import type { RegistryOptions } from './models/registry'
import { ModelRouter } from './models/router'
import type { RouterOptions } from './models/router'
import { JobStore } from './queue/jobs'
import { Scheduler } from './queue/scheduler'
import { readMd, writeMd } from './store/atomic'
import { findSeedDir, resetToSeed } from './store/dataFolder'
import { loadCastCatalog } from './pipeline/catalog'
import { detectAll } from './tools/detect'
import { openGodotInteractive } from './tools/handlers/godot'
import type { WatchEvent } from './store/watcher'
import { agentSummary, modelSummaries, roleDefaults } from './summary'

export interface EngineOptions {
  dataDir: string
  emit: (e: EngineEvent) => void
  log?: (message: string) => void
  registry?: RegistryOptions
  router?: RouterOptions
  pollMs?: number
  /** Ask LM Studio and other `discover: true` providers for their models at start. Default true. */
  discover?: boolean
  /** Look for Blender, Godot and ffmpeg at start (runs them to read their versions). Default true, except under vitest. */
  detectTools?: boolean
  /** Seed folder for `resetSeed`. Default: TOYBOX_SEED, else the repo's `seed/`. */
  seedDir?: string
}

export type CommandHandler = (cmd: Command) => Promise<void>

/**
 * The engine core: config, models, budget, agents, jobs and the scheduler, plus the command handler.
 * The episode pipeline plugs in from outside: it registers job handlers on `scheduler`, command handlers with
 * `onCommand()` (newEpisode, approve, requestChanges) and an episode list with `setEpisodeSource()`.
 */
export class Engine {
  readonly registry: ModelRegistry
  readonly budget: Budget
  readonly router: ModelRouter
  readonly jobs: JobStore
  readonly agents: AgentStore
  readonly logs: LogWriter
  readonly scheduler: Scheduler
  pipelineConfig: PipelineConfig = pipelineSchema.parse({ kind: 'pipeline' })
  toolsConfig: ToolsConfig = toolsSchema.parse({ kind: 'tools' })
  private readonly startedAt = Date.now()
  private readonly log: (m: string) => void
  /** Every event goes out through here, so the pipeline can also hook in with `onEvent`. */
  readonly emit: (e: EngineEvent) => void
  private readonly commandHandlers = new Map<CommandType, CommandHandler>()
  private readonly eventListeners = new Set<(e: EngineEvent) => void>()
  private episodeSource: () => Promise<EpisodeSummary[]> = async () => []
  private configListeners: ((name: string) => void | Promise<void>)[] = []
  private toolsCache: ToolInfo[] = []
  private toolsRefresh: Promise<void> | null = null
  private catalogCache: { cast: CastInfo[]; styles: StyleInfo[] } | null = null

  constructor(private readonly opts: EngineOptions) {
    this.emit = (e) => {
      opts.emit(e)
      for (const l of this.eventListeners) l(e)
    }
    this.log = opts.log ?? (() => undefined)
    const dir = opts.dataDir
    this.registry = new ModelRegistry(dir, opts.registry)
    this.budget = new Budget(dir, {
      onWarn: (message) => {
        this.log(`budget warning: ${message}`)
        this.emit({ type: 'engine.warning', message })
      }
    })
    this.router = new ModelRouter(this.registry, this.budget, opts.router)
    this.jobs = new JobStore(dir)
    this.agents = new AgentStore(dir)
    this.logs = new LogWriter(dir)
    this.scheduler = new Scheduler({
      jobs: this.jobs,
      agents: this.agents,
      router: this.router,
      budget: this.budget,
      logs: this.logs,
      getPipeline: () => this.pipelineConfig,
      emit: this.emit,
      pollMs: opts.pollMs
    })
  }

  get dataDir(): string {
    return this.opts.dataDir
  }

  // ---- plug-in points for the pipeline ----

  onCommand(type: CommandType, handler: CommandHandler): void {
    this.commandHandlers.set(type, handler)
  }

  /** Listens to every event the engine emits (for example `job.done`, to wake the planner). Returns an unsubscribe function. */
  onEvent(listener: (e: EngineEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /** Where snapshots get the episode list from. */
  setEpisodeSource(source: () => Promise<EpisodeSummary[]>): void {
    this.episodeSource = source
  }

  /** Called after a config file other than the model/budget ones was reloaded (`pipeline`, `tools`, ...). */
  onConfigChanged(listener: (name: string) => void | Promise<void>): void {
    this.configListeners.push(listener)
  }

  async start(): Promise<void> {
    await this.loadPipeline()
    await this.loadTools()
    await this.registry.load()
    if (this.opts.discover !== false) {
      void this.registry.discover().then((r) => {
        for (const d of r) this.log(`models: ${d.provider} ${d.error ? 'discovery failed: ' + d.error : d.found + ' found'}`)
        this.scheduler.kick()
      })
    }
    await this.budget.load()
    const rec = await this.jobs.recoverRunning()
    if (rec.requeued.length || rec.dropped.length) {
      this.log(`recovery: ${rec.requeued.length} running job(s) back to queued, ${rec.dropped.length} duplicate(s) dropped`)
    }
    await this.agents.loadAll((file, err) => this.log(`invalid agent file ${file}: ${err.message}`))
    this.scheduler.start()
    await this.budget.writeSummary().catch(() => undefined)
    if (this.opts.detectTools ?? !process.env.VITEST) void this.refreshTools()
  }

  /** Looks for Blender, Godot and ffmpeg again, then sends a fresh snapshot. */
  refreshTools(): Promise<void> {
    this.toolsRefresh ??= (async () => {
      try {
        const found = await detectAll(this.toolsConfig)
        this.toolsCache = found.map((t) => ({ name: t.name, ok: t.found, version: t.version ?? '', path: t.path ?? '' }))
        this.emit(await this.snapshot())
      } catch (err) {
        this.log(`tool detection failed: ${(err as Error).message}`)
      } finally {
        this.toolsRefresh = null
      }
    })()
    return this.toolsRefresh
  }

  /** The cast and styles of the data folder, cached until a file in cast/ or styles/ changes. */
  async catalog(): Promise<{ cast: CastInfo[]; styles: StyleInfo[] }> {
    if (this.catalogCache) return this.catalogCache
    const cast = (await loadCastCatalog(this.dataDir, this.log)).map((c) => ({ id: c.spec.id, name: c.spec.name, body: c.spec.body }))
    const styles: StyleInfo[] = []
    const dir = path.join(this.dataDir, 'styles')
    for (const f of (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.md')).sort()) {
      try {
        const data = parseMd(await fs.readFile(path.join(dir, f), 'utf8'), `styles/${f}`).data as Record<string, unknown>
        const id = typeof data.id === 'string' ? data.id : f.replace(/\.md$/, '')
        styles.push({ id, name: typeof data.name === 'string' ? data.name : id })
      } catch (err) {
        this.log(`styles/${f}: ${(err as Error).message} (skipped)`)
      }
    }
    this.catalogCache = { cast, styles }
    return this.catalogCache
  }

  /** Opens the interactive Godot window for a shot. Does not wait for the window to close. */
  private async openGodot(episode: string, shot?: string): Promise<void> {
    if (!/^[\w.-]+$/.test(episode) || episode.includes('..') || (shot !== undefined && !/^[\w.-]+$/.test(shot))) {
      this.log(`openGodot: bad episode or shot id`)
      return
    }
    const dir = path.join(this.dataDir, 'episodes', episode)
    try {
      let shotId = shot
      if (!shotId) {
        const shots = JSON.parse(await fs.readFile(path.join(dir, 'shots.json'), 'utf8')) as { shots?: { id: string }[] }
        shotId = shots.shots?.[0]?.id
        if (!shotId) throw new Error('the episode has no shots yet')
      }
      await openGodotInteractive(dir, shotId, this.toolsConfig.godot.trim() ? { godotPath: this.toolsConfig.godot.trim() } : {})
    } catch (err) {
      this.emit({ type: 'engine.warning', message: `Open in Godot: ${(err as Error).message}` })
    }
  }

  private async resetSeed(only?: string[]): Promise<void> {
    try {
      const r = await resetToSeed(this.dataDir, this.opts.seedDir ?? findSeedDir(), { ...(only ? { only } : {}), backup: true })
      this.catalogCache = null
      this.emit({ type: 'engine.warning', message: `Defaults restored: ${r.replaced.length} file(s) replaced${r.backupDir ? ' (the old ones are in ' + r.backupDir + ')' : ''}` })
      this.emit(await this.snapshot())
    } catch (err) {
      this.emit({ type: 'engine.warning', message: `Reset to defaults failed: ${(err as Error).message}` })
    }
  }

  async stop(): Promise<void> {
    await this.scheduler.stop()
    await this.logs.flush()
    await this.budget.flush().catch(() => undefined)
  }

  // ---- config ----

  private configFile(name: string): string {
    return path.join(this.dataDir, 'config', `${name}.md`)
  }

  async loadPipeline(): Promise<void> {
    const file = this.configFile('pipeline')
    try {
      this.pipelineConfig = parseMdWith(await fs.readFile(file, 'utf8'), pipelineSchema, file).data
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log(`config/pipeline.md: ${(err as Error).message}`)
    }
  }

  async loadTools(): Promise<void> {
    const file = this.configFile('tools')
    try {
      this.toolsConfig = parseMdWith(await fs.readFile(file, 'utf8'), toolsSchema, file).data
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log(`config/tools.md: ${(err as Error).message}`)
    }
  }

  /** Persists pause all in config/pipeline.md. */
  async setPaused(paused: boolean): Promise<void> {
    const file = this.configFile('pipeline')
    let doc
    try {
      doc = await readMd(file)
    } catch {
      doc = { data: { kind: 'pipeline' } as Record<string, unknown>, body: '' }
    }
    await writeMd(file, { ...doc.data, paused }, doc.body)
    const changed = this.pipelineConfig.paused !== paused
    this.pipelineConfig = { ...this.pipelineConfig, paused }
    if (changed) this.emit({ type: 'factory.paused', paused })
  }

  /** Changes a role default: puts the model first in the role's list in config/roles.md. */
  async setRoleModel(role: string, model: string): Promise<void> {
    const file = this.configFile('roles')
    const doc = await readMd(file)
    const roles = { ...((doc.data.roles as Record<string, { models?: string[] }> | undefined) ?? {}) }
    const old = roles[role]?.models ?? []
    roles[role] = { ...roles[role], models: [model, ...old.filter((m) => m !== model)] }
    await writeMd(file, { ...doc.data, roles }, doc.body)
    await this.registry.load()
  }

  // ---- file changes ----

  async handleWatch(e: WatchEvent): Promise<void> {
    try {
      if (e.kind === 'agent') {
        await this.agents.reloadFile(path.basename(e.rel, '.md'))
      } else if (e.kind === 'catalog') {
        this.catalogCache = null
        this.emit(await this.snapshot())
      } else if (e.kind === 'config') {
        const name = path.basename(e.rel, '.md')
        if (name === 'providers' || name === 'roles') await this.registry.load()
        else if (name === 'budget') await this.budget.loadCaps()
        else if (name === 'pipeline') {
          const before = this.pipelineConfig.paused
          await this.loadPipeline()
          if (before !== this.pipelineConfig.paused) this.emit({ type: 'factory.paused', paused: this.pipelineConfig.paused })
        } else if (name === 'tools') {
          await this.loadTools()
          void this.refreshTools()
        }
        for (const l of this.configListeners) await l(name)
      }
    } catch (err) {
      this.log(`could not reload ${e.rel}: ${(err as Error).message} (keeping the previous version)`)
    }
    this.scheduler.kick()
  }

  /** The provider key variables named in providers.md that have a value (never the values themselves). */
  secretsSet(): string[] {
    const names = new Set<string>()
    for (const p of this.registry.providers.values()) if (p.apiKeyEnv && resolveKey(p.apiKeyEnv)) names.add(p.apiKeyEnv)
    return [...names]
  }

  // ---- commands ----

  async handleCommand(cmd: Command): Promise<void> {
    const extra = this.commandHandlers.get(cmd.type)
    if (extra) return extra(cmd)
    switch (cmd.type) {
      case 'ping':
        this.emit({ type: 'pong', id: cmd.id, at: new Date().toISOString() })
        return
      case 'snapshot':
        this.emit(await this.snapshot())
        return
      case 'refreshTools':
        await this.refreshTools()
        return
      case 'openGodot':
        void this.openGodot(cmd.episode, cmd.shot)
        return
      case 'resetSeed':
        await this.resetSeed(cmd.only)
        return
      case 'pause':
        await this.agents.patch(cmd.agent, { paused: true })
        this.scheduler.kick()
        return
      case 'resume':
        await this.agents.patch(cmd.agent, { paused: false })
        this.scheduler.kick()
        return
      case 'stop':
        this.scheduler.stopAgent(cmd.agent)
        return
      case 'pauseAll':
        await this.setPaused(true)
        return
      case 'resumeAll':
        await this.setPaused(false)
        this.scheduler.kick()
        return
      case 'stopNow':
        // Pause first, so aborted jobs don't start again at once.
        await this.setPaused(true)
        this.scheduler.stopAll('stopNow')
        return
      case 'setModel': {
        if (cmd.model !== null && !this.registry.getModel(cmd.model)) {
          this.log(`setModel: unknown model ${cmd.model}`)
          return
        }
        if (cmd.agent) await this.agents.patch(cmd.agent, { model: cmd.model })
        else if (cmd.role && cmd.model !== null) await this.setRoleModel(cmd.role, cmd.model)
        this.scheduler.kick()
        return
      }
      default:
        this.log(`command "${cmd.type}" is not handled (the episode pipeline is not loaded)`)
    }
  }

  async snapshot(): Promise<SnapshotEvent> {
    const { cast, styles } = await this.catalog()
    return {
      type: 'snapshot',
      dataDir: this.dataDir,
      uptimeMs: Date.now() - this.startedAt,
      paused: this.pipelineConfig.paused,
      agents: this.agents.list().map((a) => agentSummary(a, this.scheduler, this.router)),
      episodes: await this.episodeSource(),
      models: modelSummaries(this.registry),
      roleDefaults: roleDefaults(this.registry),
      spend: this.budget.snapshot(),
      running: this.scheduler.runningJobs(),
      secretsSet: this.secretsSet(),
      tools: this.toolsCache,
      cast,
      styles,
      at: new Date().toISOString()
    }
  }
}
