import type { AgentSummary, ModelSummary } from '../shared/protocol'
import type { AgentDef } from './agents/agents'
import type { ModelRegistry } from './models/registry'
import type { ModelRouter } from './models/router'
import type { Scheduler } from './queue/scheduler'

export function agentSummary(def: AgentDef, sched: Scheduler, router: ModelRouter): AgentSummary {
  const info = sched.agentInfo(def.id)
  const tool = def.data.kind === 'tool'
  const resolved = tool ? null : (router.candidates(def.data.role, { agentModel: def.data.model })[0]?.ref ?? def.data.model ?? router.registry.roleModelRefs(def.data.role)[0] ?? null)
  return {
    id: def.id,
    name: def.data.name,
    role: def.data.role,
    kind: def.data.kind,
    room: def.data.room,
    model: def.data.model,
    resolvedModel: resolved,
    paused: def.data.paused,
    state: def.data.paused && info.state === 'idle' ? 'paused' : info.state,
    task: info.task,
    episode: info.episode,
    jobId: info.jobId
  }
}

export function modelSummaries(registry: ModelRegistry): ModelSummary[] {
  return [...registry.models.values()]
    .filter((m) => !m.embedding)
    .map((m) => ({ ref: m.ref, provider: m.provider.id, model: m.id, family: m.family, local: m.provider.local, enabled: m.provider.available }))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.ref.localeCompare(b.ref))
}

export function roleDefaults(registry: ModelRegistry): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [role, v] of Object.entries(registry.roles.roles)) if (v.models[0]) out[role] = v.models[0]
  return out
}
