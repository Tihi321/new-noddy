import type { Engine } from '../../engine'
import type { EpisodeStore } from '../../pipeline/episodeStore'
import type { Scheduler } from '../../queue/scheduler'
import type { PipelineConfig, ToolsConfig } from '../../../shared/schemas'
import { registerAnimAudioTools } from './animAudio'
import { registerBlenderTools } from './blender'
import { registerEditTools } from './edit'
import { registerGodotTools } from './godot'

/** What the pipeline gives to every tool module. */
export interface ToolDeps {
  engine: Engine
  dataDir: string
  /** The episodes/ folder: paths, atomic reads and writes of the episode files. */
  store: EpisodeStore
  log: (message: string) => void
  /** Current config/pipeline.md values (fps, render presets ...). Hot-reloaded: call it each time. */
  pipelineConfig: () => PipelineConfig
  /** Current config/tools.md values (paths to blender, godot, ffmpeg). */
  toolsConfig: () => ToolsConfig
}

/** A tool module's entry point: registers its job handlers with `scheduler.register(task, fn, { tool: true })`. */
export type ToolRegistrar = (scheduler: Scheduler, deps: ToolDeps) => void

/**
 * The tool modules that are installed. Each tool agent adds its registrar here, for example:
 *
 *   import { registerBlenderTools } from './blender'
 *   export const toolRegistrars: ToolRegistrar[] = [registerBlenderTools]
 *
 * (`registerAnimAudioTools` in ./animAudio, `registerGodotTools` in ./godot, `registerEditTools` in ./edit.)
 * `installPipeline(engine)` calls every registrar in this list. A stage whose tasks have no handler stays parked with
 * one `engine.warning`; it does not fail.
 */
export const toolRegistrars: ToolRegistrar[] = [registerAnimAudioTools, registerGodotTools, registerEditTools, registerBlenderTools]
