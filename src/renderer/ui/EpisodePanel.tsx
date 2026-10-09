import { useEffect, useRef, useState } from 'react'
import type { Checkpoint, EpisodeSummary } from '../../shared/protocol'
import { sendCommand } from '../api'
import { useToy } from '../store/hooks'
import { EPISODE_TYPE_INFO, formatUsd, stageLabel } from '../store/model'
import { toyStore } from '../store/store'
import { BriefTab } from './episode/BriefTab'
import { ScriptTab } from './episode/ScriptTab'
import { ShotsTab } from './episode/ShotsTab'
import { AnimaticTab, FinalTab, RenderTab } from './episode/VideoTabs'
import { Stepper } from './Stepper'

type TabId = 'brief' | 'script' | 'shots' | 'animatic' | 'render' | 'final'
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'brief', label: 'Brief', icon: '📝' },
  { id: 'script', label: 'Script', icon: '✍️' },
  { id: 'shots', label: 'Shots', icon: '🎥' },
  { id: 'animatic', label: 'Animatic', icon: '🎞️' },
  { id: 'render', label: 'Render', icon: '🖼️' },
  { id: 'final', label: 'Final', icon: '🍿' }
]

const CHECKPOINT_TEXT: Record<Checkpoint, { title: string; ask: string; tab: TabId }> = {
  script: { title: 'The script is ready for you', ask: 'Read it in the Script tab. If it is good, approve and the crew carries on with the designs and shots.', tab: 'script' },
  animatic: { title: 'The animatic is ready for you', ask: 'Watch it in the Animatic tab. If it looks right, approve and the slow final render starts.', tab: 'animatic' }
}

export function ApprovalBanner({ ep }: { ep: EpisodeSummary }) {
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const cp = ep.awaiting
  useEffect(() => {
    setAsking(false)
    setNote('')
  }, [ep.id, cp])
  if (ep.status !== 'awaiting_approval' || !cp) return null
  const text = CHECKPOINT_TEXT[cp]
  return (
    <div className="approval" role="region" aria-label="Approval needed" data-testid="approval-banner" data-checkpoint={cp}>
      <div className="approval-text">
        <b>✋ {text.title}</b>
        <span>{text.ask}</span>
      </div>
      {asking ? (
        <div className="approval-form">
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change? For example: make the chase clearer, and add a scene at the bakery." data-testid="changes-note" autoFocus />
          <div className="approval-actions">
            <button className="btn" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button
              className="btn warn"
              disabled={!note.trim()}
              onClick={() => {
                sendCommand({ type: 'requestChanges', episode: ep.id, checkpoint: cp, note: note.trim() })
                setAsking(false)
                setNote('')
              }}
              data-testid="send-changes"
            >
              Send changes to the crew
            </button>
          </div>
        </div>
      ) : (
        <div className="approval-actions">
          <button className="btn" onClick={() => setAsking(true)} data-testid="request-changes">
            ✏️ Request changes
          </button>
          <button className="btn primary big" onClick={() => sendCommand({ type: 'approve', episode: ep.id, checkpoint: cp })} data-testid="approve">
            👍 Approve
          </button>
        </div>
      )}
    </div>
  )
}

export function EpisodePanel() {
  const id = useToy((s) => s.selectedEpisode)
  const ep = useToy((s) => (s.selectedEpisode ? s.episodes[s.selectedEpisode] : undefined))
  const [tab, setTab] = useState<TabId>('brief')
  const lastAwaiting = useRef<string>('')

  // jump to the thing that needs approving, once per checkpoint
  useEffect(() => {
    const key = ep && ep.awaiting ? `${ep.id}:${ep.awaiting}` : ''
    if (key && key !== lastAwaiting.current && ep?.awaiting) setTab(CHECKPOINT_TEXT[ep.awaiting].tab)
    lastAwaiting.current = key
  }, [ep])

  if (!id || !ep)
    return (
      <section className="panel">
        <div className="empty-state">
          <div className="empty-emoji">📖</div>
          Pick an episode in the list, or start a new one.
        </div>
      </section>
    )
  const type = EPISODE_TYPE_INFO[ep.type]
  return (
    <section className="panel episode-panel" data-testid="episode-panel" data-episode={ep.id}>
      <div className="panel-head">
        <span className="type-badge" aria-hidden>
          {type?.icon}
        </span>
        <div className="panel-title">
          <h2 data-testid="episode-title">{ep.title || ep.theme}</h2>
          <div className="dim">
            {type?.label} · "{ep.theme}" · {ep.lengthMin} min
          </div>
        </div>
        <span className={`status-pill ${ep.status}`} data-testid="episode-status">
          {ep.status === 'running' ? `working: ${stageLabel(ep.stage)}` : ep.status === 'awaiting_approval' ? 'needs your OK' : ep.status}
        </span>
        {ep.status === 'failed' && (
          <button className="btn small warn" onClick={() => sendCommand({ type: 'retryEpisode', episode: ep.id })} data-testid="retry-episode">
            ↻ Try again
          </button>
        )}
        <span className="chip">{formatUsd(ep.costUsd)}</span>
        <button className="btn small" onClick={() => toyStore.getState().setTerminal(true, 'episode')} data-testid="episode-terminal">
          ▤ Log
        </button>
      </div>
      <Stepper episode={ep} />
      <ApprovalBanner ep={ep} />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>
            <span aria-hidden>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
      <div className="tab-body" data-testid={`tabbody-${tab}`}>
        {tab === 'brief' && <BriefTab ep={ep} />}
        {tab === 'script' && <ScriptTab ep={ep} />}
        {tab === 'shots' && <ShotsTab ep={ep} />}
        {tab === 'animatic' && <AnimaticTab ep={ep} />}
        {tab === 'render' && <RenderTab ep={ep} />}
        {tab === 'final' && <FinalTab ep={ep} />}
      </div>
    </section>
  )
}
