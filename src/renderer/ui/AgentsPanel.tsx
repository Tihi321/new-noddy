import { sendCommand } from '../api'
import { useToy } from '../store/hooks'
import { STATE_ICON, STATE_LABEL, isLocalModel, roleColor, roomLabel, shortModel, type AgentView } from '../store/model'
import { toyStore } from '../store/store'

/** Model dropdown grouped Local and API. The empty value clears the agent's own override. */
export function ModelPicker({ agent }: { agent: AgentView }) {
  const models = useToy((s) => s.models)
  const roleDefaults = useToy((s) => s.roleDefaults)
  const local = models.filter((m) => m.local)
  const api = models.filter((m) => !m.local)
  const roleDefault = roleDefaults[agent.role]
  if (agent.kind === 'tool') return <span className="dim">Tool crew: runs a program, no model.</span>
  return (
    <label className="picker">
      <select
        value={agent.model ?? ''}
        onChange={(e) => sendCommand({ type: 'setModel', model: e.target.value || null, agent: agent.id })}
        data-testid="model-picker"
        data-agent={agent.id}
        aria-label={`Model for ${agent.name}`}
      >
        <option value="">Role default{roleDefault ? `: ${shortModel(roleDefault)}` : ''}</option>
        <optgroup label="Local">
          {local.map((m) => (
            <option key={m.ref} value={m.ref} disabled={!m.enabled}>
              {m.model}
              {m.enabled ? '' : ' (off)'}
            </option>
          ))}
        </optgroup>
        <optgroup label="API">
          {api.map((m) => (
            <option key={m.ref} value={m.ref} disabled={!m.enabled}>
              {m.provider}/{m.model}
              {m.enabled ? '' : ' (no key)'}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  )
}

function ModelBadge({ agent }: { agent: AgentView }) {
  const models = useToy((s) => s.models)
  if (agent.kind === 'tool') return <span className="badge tool">TOOL CREW</span>
  if (!agent.resolvedModel) return <span className="badge none">NO MODEL</span>
  const local = isLocalModel(agent.resolvedModel, models)
  return (
    <span className={`badge ${local ? 'local' : 'api'}`} title={agent.resolvedModel}>
      {local ? 'LOCAL' : 'API'} {shortModel(agent.resolvedModel)}
    </span>
  )
}

function PauseButton({ agent }: { agent: AgentView }) {
  return (
    <button className="btn small" onClick={() => sendCommand({ type: agent.paused || agent.state === 'paused' ? 'resume' : 'pause', agent: agent.id })} data-testid="pause-agent" data-agent={agent.id}>
      {agent.paused || agent.state === 'paused' ? '▶ Resume' : '⏸ Pause'}
    </button>
  )
}

/** Panel over the studio when a crew member is clicked. */
export function AgentDrawer({ id }: { id: string }) {
  const agent = useToy((s) => s.agents[id])
  const episodes = useToy((s) => s.episodes)
  if (!agent) return null
  const ep = agent.episode ? episodes[agent.episode] : undefined
  return (
    <aside className="drawer" data-testid="agent-drawer">
      <button className="drawer-close" onClick={() => toyStore.getState().selectAgent(null)} aria-label="Close">
        ×
      </button>
      <div className="drawer-head">
        <span className="role-dot" style={{ background: roleColor(agent.role) }} />
        <div>
          <h3>{agent.name}</h3>
          <div className="dim">
            {agent.role.replace(/_/g, ' ')} · {roomLabel(agent.room)}
          </div>
        </div>
      </div>
      <div className={`state-line ${agent.state}`}>
        <span aria-hidden>{STATE_ICON[agent.state]}</span> {STATE_LABEL[agent.state]}
        {agent.task ? <span className="dim"> · {agent.task}</span> : null}
      </div>
      {ep && <div className="dim">on: {ep.title || ep.id}</div>}
      <div className="drawer-row">
        <ModelBadge agent={agent} />
      </div>
      <div className="drawer-row">
        <ModelPicker agent={agent} />
      </div>
      {agent.resolvedModel && (
        <div className="dim small-text">
          Will use <code>{agent.resolvedModel}</code> for its next job.
        </div>
      )}
      <div className="drawer-actions">
        <PauseButton agent={agent} />
        <button className="btn small" onClick={() => toyStore.getState().selectAgent(agent.id, true)} data-testid="open-terminal">
          ▤ Live output
        </button>
      </div>
    </aside>
  )
}

/** The whole crew as a table: state, task, model picker, pause. */
export function AgentsPanel() {
  const order = useToy((s) => s.agentOrder)
  const agents = useToy((s) => s.agents)
  const models = useToy((s) => s.models)
  const list = order.map((id) => agents[id]).filter((a): a is AgentView => !!a)
  const localCount = list.filter((a) => a.kind === 'llm' && isLocalModel(a.resolvedModel, models)).length
  const apiCount = list.filter((a) => a.kind === 'llm' && a.resolvedModel && !isLocalModel(a.resolvedModel, models)).length
  return (
    <section className="panel" data-testid="agents-panel">
      <div className="panel-head">
        <h2>The Crew</h2>
        <span className="chip">{list.length} members</span>
        <span className="chip local">{localCount} local</span>
        <span className="chip api">{apiCount} API</span>
      </div>
      <p className="hint">Pick a model for each crew member. Local models run on LM Studio or Strata and are free; API models cost money and count against the budget. Tool crews run programs and need no model.</p>
      <table className="crew-table">
        <thead>
          <tr>
            <th>Crew member</th>
            <th>Room</th>
            <th>State</th>
            <th>Model</th>
            <th>Using</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id} data-testid="agent-row" data-agent={a.id}>
              <td>
                <button className="link" onClick={() => toyStore.getState().selectAgent(a.id, true)}>
                  <span className="role-dot" style={{ background: roleColor(a.role) }} /> <b>{a.name}</b>
                </button>
                <div className="dim small-text">{a.role.replace(/_/g, ' ')}</div>
              </td>
              <td>{roomLabel(a.room)}</td>
              <td>
                <span className={`state-chip ${a.state}`}>
                  {STATE_ICON[a.state]} {STATE_LABEL[a.state]}
                </span>
                {a.task && <div className="dim small-text">{a.task}</div>}
              </td>
              <td>
                <ModelPicker agent={a} />
              </td>
              <td>
                <ModelBadge agent={a} />
              </td>
              <td>
                <PauseButton agent={a} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
