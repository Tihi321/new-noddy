/**
 * Engine <-> UI protocol. The engine sends events and accepts commands.
 * A Transport carries them. Today that is the Electron utilityProcess port. Later it could be a WebSocket.
 */

export type AgentState = 'working' | 'reviewing' | 'waiting-provider' | 'idle' | 'error' | 'paused'

export type EpisodeType = 'adventure' | 'lesson' | 'mystery' | 'holiday' | 'comedy'
export const EPISODE_TYPES: readonly EpisodeType[] = ['adventure', 'lesson', 'mystery', 'holiday', 'comedy']

/** The two places where the pipeline may wait for the user. */
export type Checkpoint = 'script' | 'animatic'

export interface ModelSummary {
  /** `provider/model`, the id used in `setModel` and in config files. */
  ref: string
  provider: string
  model: string
  family: string
  local: boolean
  /** True when the provider is switched on and usable (has a key, or is local). */
  enabled: boolean
}

export interface AgentSummary {
  id: string
  name: string
  role: string
  /** `llm` agents call a model, `tool` crews run programs. */
  kind: 'llm' | 'tool'
  /** Room in the studio view: writers_room, art_dept, stage, sound_booth, workshop, render_farm, edit_suite. */
  room: string
  /** The agent's own override (`provider/model`), or null. */
  model: string | null
  /** What the agent will use for its next job: the override, else the role default (first usable model). Null for tool crews. */
  resolvedModel: string | null
  paused: boolean
  state: AgentState
  /** What it is doing now, when it has a job. */
  task?: string
  episode?: string
  jobId?: string
}

/** What the UI needs to list an episode. The episode files hold the details. */
export interface EpisodeSummary {
  id: string
  title: string
  theme: string
  type: EpisodeType
  /** Pipeline stage, for example `script`, `shots`, `render`, `done`. */
  stage: string
  status: 'running' | 'awaiting_approval' | 'done' | 'failed'
  /** The checkpoint the pipeline waits at, when `status` is `awaiting_approval`. */
  awaiting: Checkpoint | null
  lengthMin: number
  shots: number | null
  costUsd: number
  /** Paths of finished assets, relative to the data folder, with forward slashes. Keys: brief, script, animatic, final ... */
  assets: Record<string, string>
  createdAt: string
  updatedAt: string
}

export interface ToolInfo {
  name: string
  ok: boolean
  version: string
  path: string
}

export interface CastInfo {
  id: string
  name: string
  body: string
}

export interface StyleInfo {
  id: string
  name: string
}

export interface SnapshotEvent {
  type: 'snapshot'
  dataDir: string
  uptimeMs: number
  /** Pause all. */
  paused: boolean
  agents: AgentSummary[]
  episodes: EpisodeSummary[]
  /** Every chat model the pickers can offer, including the LM Studio models found on this machine. */
  models: ModelSummary[]
  /** Role -> `provider/model` of the role default (first in the role's list). */
  roleDefaults: Record<string, string>
  spend: { today: number; month: number; dailyCap: number; monthlyCap: number }
  running: { jobId: string; agent: string }[]
  /** Names of provider key variables that are set (never their values). */
  secretsSet: string[]
  /** Blender, Godot and ffmpeg as found on this machine (cached; `refreshTools` looks again). */
  tools: ToolInfo[]
  /** The characters of cast/*.md, for the New Episode dialog. */
  cast: CastInfo[]
  /** The styles of styles/*.md. */
  styles: StyleInfo[]
  at: string
}

export type EngineEvent =
  | { type: 'engine.ready'; pid: number; dataDir: string; at: string }
  | { type: 'engine.heartbeat'; n: number; at: string; uptimeMs: number }
  | { type: 'pong'; id?: string; at: string }
  | SnapshotEvent
  | { type: 'engine.warning'; message: string }
  | { type: 'agent.state'; agent: string; role: string; state: AgentState; jobId?: string; task?: string; episode?: string }
  | { type: 'factory.paused'; paused: boolean }
  | { type: 'job.started'; jobId: string; agent: string; task: string; episode?: string; model?: string }
  | { type: 'job.token'; jobId: string; agent: string; text: string }
  | { type: 'job.done'; jobId: string; agent: string; ok: boolean; result?: string; error?: string }
  | { type: 'handover'; from: string; to: string; label: string; jobId?: string; done?: boolean }
  | {
      type: 'spend'
      provider: string
      model: string
      tokensIn: number
      tokensOut: number
      costUsd: number
      agent?: string
      episode?: string
    }
  /** An episode changed (stage, status, assets). Carries the whole summary. */
  | { type: 'episode.updated'; episode: EpisodeSummary }
  /** A tool job reports progress, for example frames rendered. */
  | { type: 'render.progress'; episode: string; jobId: string; done: number; total: number; label: string }
  /** A file the UI can show is ready. `path` is relative to the data folder. */
  | { type: 'asset.ready'; episode: string; kind: string; path: string }

export type EngineEventType = EngineEvent['type']

export interface NewEpisodeCommand {
  type: 'newEpisode'
  theme: string
  episodeType: EpisodeType
  /** Cast ids from cast/*.md. Empty means "the producer picks". */
  characters: string[]
  lengthMin: number
  /** Style id from styles/*.md. */
  style: string
  approvals: { script: boolean; animatic: boolean }
}

export type Command =
  | { type: 'pause'; agent: string }
  | { type: 'resume'; agent: string }
  | { type: 'stop'; agent: string }
  | { type: 'pauseAll' }
  | { type: 'resumeAll' }
  | { type: 'stopNow' }
  /** `model: null` with an `agent` clears that agent's override. */
  | { type: 'setModel'; model: string | null; agent?: string; role?: string }
  | NewEpisodeCommand
  | { type: 'approve'; episode: string; checkpoint: Checkpoint }
  | { type: 'requestChanges'; episode: string; checkpoint: Checkpoint; note: string }
  /** Tries a failed episode again from the stage that failed. */
  | { type: 'retryEpisode'; episode: string }
  /** Opens the interactive Godot window for a shot (the first shot when `shot` is omitted). */
  | { type: 'openGodot'; episode: string; shot?: string }
  /** Puts the seed's prompts, sets, ... back in the data folder (a backup is kept). `only` limits it to some folders or files. */
  | { type: 'resetSeed'; only?: string[] }
  /** Looks for Blender, Godot and ffmpeg again. */
  | { type: 'refreshTools' }
  | { type: 'snapshot' }
  | { type: 'ping'; id?: string }

export type CommandType = Command['type']

export const COMMAND_TYPES: readonly CommandType[] = [
  'pause',
  'resume',
  'stop',
  'pauseAll',
  'resumeAll',
  'stopNow',
  'setModel',
  'newEpisode',
  'approve',
  'requestChanges',
  'retryEpisode',
  'openGodot',
  'resetSeed',
  'refreshTools',
  'snapshot',
  'ping'
]

export function isCommand(value: unknown): value is Command {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && (COMMAND_TYPES as readonly string[]).includes(type)
}

/** One end of a link: sends `Out` messages and receives `In` messages. */
export interface Transport<Out, In> {
  send(message: Out): void
  /** Returns an unsubscribe function. */
  onMessage(handler: (message: In) => void): () => void
  close(): void
}

/** The engine's end of the link. The UI's end is the mirror: Transport<Command, EngineEvent>. */
export type EngineTransport = Transport<EngineEvent, Command>

/** What the preload script exposes to the renderer as `window.toybox`. */
export interface ToyboxApi {
  on(handler: (event: EngineEvent) => void): () => void
  send(command: Command): void
}
