import { useToy } from '../store/hooks'
import { EPISODE_TYPE_INFO, formatUsd, stageLabel } from '../store/model'
import { toyStore } from '../store/store'
import { StageBar } from './Stepper'

const STATUS_TEXT: Record<string, string> = { running: 'in production', awaiting_approval: 'needs you', done: 'finished', failed: 'failed' }

export function Sidebar() {
  const order = useToy((s) => s.episodeOrder)
  const episodes = useToy((s) => s.episodes)
  const selected = useToy((s) => s.selectedEpisode)
  const view = useToy((s) => s.view)
  return (
    <aside className="sidebar" data-testid="sidebar">
      <button className="btn big primary" onClick={() => toyStore.getState().setNewEpisodeOpen(true)} data-testid="new-episode">
        <span aria-hidden>✨</span> New Episode
      </button>
      <h2 className="side-title">Episodes</h2>
      <ul className="episode-list" data-testid="episode-list">
        {order.length === 0 && <li className="empty">No episodes yet. Press New Episode to start the crew.</li>}
        {order.map((id) => {
          const e = episodes[id]
          if (!e) return null
          const type = EPISODE_TYPE_INFO[e.type]
          return (
            <li key={id}>
              <button
                className={`episode-card ${selected === id && view === 'episode' ? 'on' : ''} ${e.status}`}
                onClick={() => toyStore.getState().selectEpisode(id)}
                data-testid="episode-card"
                data-episode={id}
                data-status={e.status}
              >
                <span className="ep-icon" aria-hidden>
                  {type?.icon ?? '🎬'}
                </span>
                <span className="ep-main">
                  <b className="ep-title">{e.title || e.theme || id}</b>
                  <span className="ep-sub">
                    {e.status === 'awaiting_approval' ? `waiting for your OK: ${e.awaiting}` : e.status === 'running' ? stageLabel(e.stage) : STATUS_TEXT[e.status]} · {formatUsd(e.costUsd)}
                  </span>
                  <StageBar episode={e} />
                </span>
                {e.status === 'awaiting_approval' && <span className="ep-flag">✋</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
