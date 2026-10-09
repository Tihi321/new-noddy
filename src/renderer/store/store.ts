import { createStore } from 'zustand/vanilla'
import type { AgentSummary, CastInfo, EngineEvent, EpisodeSummary, ModelSummary, StyleInfo, ToolInfo } from '../../shared/protocol'
import { MAX_JOBS_PER_KEY, appendOutput, emptyJob, type JobLog } from './logModel'
import { asAgentState, handoverAlpha, type AgentView, type HandoverView, type RenderView, type SpendView } from './model'

export type MainView = 'studio' | 'episode' | 'agents' | 'settings'

/** After the user started an episode, a new id in the engine's list becomes the selected episode (the view stays where it is). */
function pickNew(s: ToyState, ids: string[], keep: string | null): { selectedEpisode: string | null; awaitingNewEpisode: boolean } {
  if (s.awaitingNewEpisode) {
    const fresh = ids.find((id) => !s.episodes[id])
    if (fresh) return { selectedEpisode: fresh, awaitingNewEpisode: false }
  }
  return { selectedEpisode: keep, awaitingNewEpisode: s.awaitingNewEpisode }
}

export interface ToyState {
  connected: boolean
  dataDir: string
  allPaused: boolean
  warnings: string[]
  agents: Record<string, AgentView>
  agentOrder: string[]
  episodes: Record<string, EpisodeSummary>
  episodeOrder: string[]
  handovers: HandoverView[]
  spend: SpendView
  models: ModelSummary[]
  roleDefaults: Record<string, string>
  secretsSet: string[]
  tools: ToolInfo[]
  cast: CastInfo[]
  styles: StyleInfo[]
  /** Render progress per episode, from render.progress events. */
  render: Record<string, RenderView>
  /** Bumped per episode when an asset.ready event arrives, so tabs reload their files. */
  assetTick: Record<string, number>
  view: MainView
  selectedEpisode: string | null
  /** Set when the user submitted the New Episode dialog: the next new episode gets selected. */
  awaitingNewEpisode: boolean
  selectedAgent: string | null
  newEpisodeOpen: boolean
  terminalOpen: boolean
  terminalMode: 'agent' | 'episode'
  jobs: Record<string, JobLog>
  jobsByAgent: Record<string, string[]>
  jobsByEpisode: Record<string, string[]>
  /** Bumped on every applied event, so non-React code (Phaser) can cheaply notice changes. */
  version: number
}

export interface ToyActions {
  applyEvents(events: EngineEvent[], now?: number): void
  setView(view: MainView): void
  selectEpisode(id: string | null): void
  expectNewEpisode(): void
  selectAgent(id: string | null, openTerminal?: boolean): void
  setNewEpisodeOpen(open: boolean): void
  setTerminal(open: boolean, mode?: 'agent' | 'episode'): void
  reset(): void
}

export type ToyStore = ToyState & ToyActions

const EMPTY_SPEND: SpendView = { today: 0, month: 0, dailyCap: 0, monthlyCap: 0 }

function initial(): ToyState {
  return {
    connected: false,
    dataDir: '',
    allPaused: false,
    warnings: [],
    agents: {},
    agentOrder: [],
    episodes: {},
    episodeOrder: [],
    handovers: [],
    spend: { ...EMPTY_SPEND },
    models: [],
    roleDefaults: {},
    secretsSet: [],
    tools: [],
    cast: [],
    styles: [],
    render: {},
    assetTick: {},
    view: 'studio',
    selectedEpisode: null,
    awaitingNewEpisode: false,
    selectedAgent: null,
    newEpisodeOpen: false,
    terminalOpen: false,
    terminalMode: 'agent',
    jobs: {},
    jobsByAgent: {},
    jobsByEpisode: {},
    version: 0
  }
}

function pushId(map: Record<string, string[]>, key: string, id: string): Record<string, string[]> {
  const list = map[key] ?? []
  if (list.includes(id)) return map
  const next = [...list, id]
  return { ...map, [key]: next.length > MAX_JOBS_PER_KEY ? next.slice(next.length - MAX_JOBS_PER_KEY) : next }
}

function agentFromSummary(a: AgentSummary, prev: AgentView | undefined, now: number): AgentView {
  const state = a.paused ? 'paused' : asAgentState(a.state)
  const same = prev?.state === state && prev.task === a.task
  return { ...a, state, since: same && prev ? prev.since : now }
}

function sortEpisodes(eps: Record<string, EpisodeSummary>): string[] {
  return Object.values(eps)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map((e) => e.id)
}

export function reduceEvent(s: ToyState, e: EngineEvent, now: number): Partial<ToyState> {
  switch (e.type) {
    case 'engine.ready':
      return { connected: true, dataDir: e.dataDir }
    case 'engine.heartbeat':
      return { connected: true }
    case 'engine.warning':
      return { warnings: [...s.warnings.slice(-19), e.message] }
    case 'snapshot': {
      const agents: Record<string, AgentView> = {}
      for (const a of e.agents) agents[a.id] = agentFromSummary(a, s.agents[a.id], now)
      for (const r of e.running) {
        const a = agents[r.agent]
        if (a && !a.jobId) a.jobId = r.jobId
      }
      const episodes: Record<string, EpisodeSummary> = {}
      for (const ep of e.episodes) episodes[ep.id] = ep
      return {
        connected: true,
        dataDir: e.dataDir,
        allPaused: e.paused,
        agents,
        agentOrder: e.agents.map((a) => a.id),
        episodes,
        episodeOrder: sortEpisodes(episodes),
        spend: e.spend,
        models: e.models,
        roleDefaults: e.roleDefaults,
        secretsSet: e.secretsSet,
        tools: e.tools ?? [],
        cast: e.cast ?? [],
        styles: e.styles ?? [],
        selectedAgent: s.selectedAgent && agents[s.selectedAgent] ? s.selectedAgent : null,
        ...pickNew(s, Object.keys(episodes), s.selectedEpisode && episodes[s.selectedEpisode] ? s.selectedEpisode : null)
      }
    }
    case 'factory.paused':
      return { allPaused: e.paused }
    case 'episode.updated': {
      const episodes = { ...s.episodes, [e.episode.id]: e.episode }
      return { episodes, episodeOrder: s.episodes[e.episode.id] ? s.episodeOrder : sortEpisodes(episodes), ...pickNew(s, [e.episode.id], s.selectedEpisode) }
    }
    case 'agent.state': {
      const prev = s.agents[e.agent]
      const state = e.state
      const task = state === 'idle' || state === 'paused' ? undefined : (e.task ?? (prev?.state === state ? prev.task : undefined))
      const base: AgentView =
        prev ?? { id: e.agent, name: e.agent, role: e.role, kind: 'llm', room: '', model: null, resolvedModel: null, paused: false, state, since: now }
      const changed = prev?.state !== state || prev?.task !== task
      const idle = state === 'idle' || state === 'paused'
      const agent: AgentView = {
        ...base,
        role: e.role || base.role,
        state,
        paused: state === 'paused',
        task,
        episode: idle ? undefined : (e.episode ?? base.episode),
        jobId: e.jobId ?? (state === 'idle' ? undefined : base.jobId),
        since: changed ? now : base.since
      }
      return { agents: { ...s.agents, [e.agent]: agent }, agentOrder: prev ? s.agentOrder : [...s.agentOrder, e.agent] }
    }
    case 'job.started': {
      const job: JobLog = { ...emptyJob(e.jobId, e.agent, now), ...s.jobs[e.jobId], task: e.task, episode: e.episode, model: e.model }
      const prev = s.agents[e.agent]
      const agents = prev ? { ...s.agents, [e.agent]: { ...prev, resolvedModel: prev.kind === 'tool' ? prev.resolvedModel : (e.model ?? prev.resolvedModel), jobId: e.jobId, episode: e.episode ?? prev.episode } } : s.agents
      return {
        agents,
        jobs: { ...s.jobs, [e.jobId]: job },
        jobsByAgent: pushId(s.jobsByAgent, e.agent, e.jobId),
        jobsByEpisode: e.episode ? pushId(s.jobsByEpisode, e.episode, e.jobId) : s.jobsByEpisode
      }
    }
    case 'job.token': {
      const cur = s.jobs[e.jobId] ?? emptyJob(e.jobId, e.agent, now)
      const jobs = { ...s.jobs, [e.jobId]: { ...cur, output: appendOutput(cur.output, e.text) } }
      return s.jobs[e.jobId] ? { jobs } : { jobs, jobsByAgent: pushId(s.jobsByAgent, e.agent, e.jobId) }
    }
    case 'job.done': {
      const cur = s.jobs[e.jobId] ?? emptyJob(e.jobId, e.agent, now)
      const job: JobLog = { ...cur, finishedAt: now, ok: e.ok, result: e.result ?? cur.result, error: e.error }
      if (job.result && /^\S+\/\S+$/.test(job.result)) job.destination = job.result
      return { jobs: { ...s.jobs, [e.jobId]: job } }
    }
    case 'handover': {
      const key = e.jobId ?? `${e.from}>${e.to}>${e.label}`
      const prev = s.handovers.find((h) => h.key === key)
      const rest = s.handovers.filter((h) => h.key !== key)
      const h: HandoverView = { key, from: e.from, to: e.to, label: e.label, jobId: e.jobId, startedAt: prev?.startedAt ?? now, doneAt: e.done ? now : undefined }
      const job = e.jobId ? s.jobs[e.jobId] : undefined
      const jobs = e.jobId && job && !job.requestedBy ? { jobs: { ...s.jobs, [e.jobId]: { ...job, requestedBy: e.from } } } : {}
      return { handovers: [...rest, h].filter((x) => handoverAlpha(x, now) > 0).slice(-40), ...jobs }
    }
    case 'spend': {
      const spend: SpendView = { ...s.spend, today: s.spend.today + e.costUsd, month: s.spend.month + e.costUsd }
      const patch: Partial<ToyState> = { spend }
      const a = e.agent ? s.agents[e.agent] : undefined
      const jobId = a?.jobId
      const job = jobId ? s.jobs[jobId] : undefined
      if (jobId && job) {
        patch.jobs = {
          ...s.jobs,
          [jobId]: {
            ...job,
            calls: (job.calls ?? 0) + 1,
            tokensIn: (job.tokensIn ?? 0) + e.tokensIn,
            tokensOut: (job.tokensOut ?? 0) + e.tokensOut,
            costUsd: (job.costUsd ?? 0) + e.costUsd,
            model: `${e.provider}/${e.model}`
          }
        }
      }
      return patch
    }
    case 'render.progress': {
      const cur = s.render[e.episode]
      const sameJob = cur && cur.jobId === e.jobId
      const shots = sameJob ? { ...cur.shots } : {}
      const order = sameJob ? [...cur.order] : []
      const prev = shots[e.label]
      if (!prev) order.push(e.label)
      shots[e.label] = {
        label: e.label,
        done: e.done,
        total: e.total,
        firstAt: prev?.firstAt ?? now,
        firstDone: prev?.firstDone ?? e.done,
        updatedAt: now
      }
      return { render: { ...s.render, [e.episode]: { jobId: e.jobId, shots, order } } }
    }
    case 'asset.ready':
      return { assetTick: { ...s.assetTick, [e.episode]: (s.assetTick[e.episode] ?? 0) + 1 } }
    default:
      return {}
  }
}

export function createToyStore() {
  return createStore<ToyStore>()((set, get) => ({
    ...initial(),
    applyEvents(events, now = Date.now()) {
      if (events.length === 0) return
      let state: ToyState = get()
      for (const e of events) state = { ...state, ...reduceEvent(state, e, now) }
      set({ ...state, version: get().version + 1 })
    },
    setView(view) {
      set({ view })
    },
    expectNewEpisode() {
      set({ awaitingNewEpisode: true })
    },
    selectEpisode(id) {
      set(id ? { selectedEpisode: id, view: 'episode' } : { selectedEpisode: null, view: get().view === 'episode' ? 'studio' : get().view })
    },
    selectAgent(id, openTerminal = false) {
      set({ selectedAgent: id, terminalMode: 'agent', terminalOpen: id && openTerminal ? true : get().terminalOpen })
    },
    setNewEpisodeOpen(open) {
      set({ newEpisodeOpen: open })
    },
    setTerminal(open, mode) {
      set({ terminalOpen: open, terminalMode: mode ?? get().terminalMode })
    },
    reset() {
      set(initial())
    }
  }))
}

/** The app-wide store. Tests make their own with createToyStore(). */
export const toyStore = createToyStore()
