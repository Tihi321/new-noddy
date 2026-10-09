import type { Engine } from '../engine'
import type { Scheduler } from '../queue/scheduler'
import { toolRegistrars } from '../tools/handlers/registry'
import type { ToolDeps, ToolRegistrar } from '../tools/handlers/registry'
import { EpisodeStore } from './episodeStore'
import { registerStoryHandlers } from './handlers'
import { Pipeline } from './pipeline'

export interface InstalledPipeline {
  pipeline: Pipeline
  store: EpisodeStore
  /** The tasks that have a handler (story crew plus every tool module that registered). */
  tasks: ReadonlySet<string>
  stop(): Promise<void>
}

/**
 * Plugs the episode pipeline into the engine: registers the story handlers and every tool module's handlers, hooks up
 * `newEpisode`, `approve` and `requestChanges`, the episode list for snapshots, and starts the planner.
 * `registrars` defaults to the list in tools/handlers/registry.ts; tests pass fakes.
 */
export function installPipeline(engine: Engine, registrars: ToolRegistrar[] = toolRegistrars, opts: { tickMs?: number } = {}): InstalledPipeline {
  const log = (m: string) => engine.emit({ type: 'engine.warning', message: m })
  const quiet = (_m: string) => undefined
  const store = new EpisodeStore(engine.dataDir, engine.jobs, { cost: (id) => engine.budget.spentEpisode(id) })
  const tasks = new Set<string>()
  // every `register` call goes through here, so the pipeline knows which tasks it can plan
  const tracked: Scheduler = Object.create(engine.scheduler) as Scheduler
  tracked.register = (task, fn, o) => {
    tasks.add(task)
    engine.scheduler.register(task, fn, o)
  }
  registerStoryHandlers(tracked, { dataDir: engine.dataDir, store, getConfig: () => engine.pipelineConfig, log: quiet })
  const deps: ToolDeps = {
    engine,
    dataDir: engine.dataDir,
    store,
    log: quiet,
    pipelineConfig: () => engine.pipelineConfig,
    toolsConfig: () => engine.toolsConfig
  }
  for (const register of registrars) {
    try {
      register(tracked, deps)
    } catch (err) {
      log(`a tool module failed to register: ${(err as Error).message}`)
    }
  }
  const pipeline = new Pipeline({ engine, store, hasHandler: (t) => tasks.has(t), tickMs: opts.tickMs, log: quiet })
  pipeline.start()
  return { pipeline, store, tasks, stop: () => pipeline.stop() }
}
