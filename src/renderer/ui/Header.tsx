import { sendCommand } from '../api'
import { useToy } from '../store/hooks'
import { formatUsd } from '../store/model'
import { toyStore, type MainView } from '../store/store'

const TABS: { id: MainView; label: string; icon: string }[] = [
  { id: 'studio', label: 'Studio', icon: '🎬' },
  { id: 'episode', label: 'Episode', icon: '📖' },
  { id: 'agents', label: 'Crew', icon: '🧸' },
  { id: 'settings', label: 'Settings', icon: '⚙️' }
]

export function Header({ demo }: { demo: boolean }) {
  const view = useToy((s) => s.view)
  const connected = useToy((s) => s.connected)
  const paused = useToy((s) => s.allPaused)
  const spend = useToy((s) => s.spend)
  const warnings = useToy((s) => s.warnings)
  const terminalOpen = useToy((s) => s.terminalOpen)
  const working = useToy((s) => Object.values(s.agents).filter((a) => a.state === 'working' || a.state === 'reviewing').length)
  const selectedEpisode = useToy((s) => s.selectedEpisode)
  const onAir = working > 0 && !paused
  return (
    <header className="header" data-testid="header">
      <div className="brand">
        <span className="brand-logo" aria-hidden>
          🧸
        </span>
        <span className="brand-name">Toybox Studio</span>
        <span className={`on-air ${onAir ? 'on' : ''}`} data-testid="on-air" title={onAir ? `${working} crew working` : 'quiet on the set'}>
          ON AIR
        </span>
      </div>
      <nav className="tabs-main" aria-label="Views">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-btn ${view === t.id ? 'on' : ''}`}
            onClick={() => (t.id === 'episode' && !selectedEpisode ? toyStore.getState().setView('studio') : toyStore.getState().setView(t.id))}
            data-testid={`nav-${t.id}`}
            disabled={t.id === 'episode' && !selectedEpisode}
          >
            <span aria-hidden>{t.icon}</span> {t.label}
          </button>
        ))}
      </nav>
      <div className="header-right">
        {warnings.length > 0 && (
          <span className="chip warn" title={warnings.join('\n')}>
            ! {warnings.length}
          </span>
        )}
        <span className="chip" title={`Spend today / month. Caps ${formatUsd(spend.dailyCap)} / ${formatUsd(spend.monthlyCap)}`} data-testid="spend">
          💰 {formatUsd(spend.today)} today
        </span>
        <button className={`btn small ${terminalOpen ? 'on' : ''}`} onClick={() => toyStore.getState().setTerminal(!terminalOpen)} data-testid="toggle-terminal">
          ▤ Terminal
        </button>
        <button className="btn small" onClick={() => sendCommand({ type: paused ? 'resumeAll' : 'pauseAll' })} data-testid="pause-all">
          {paused ? '▶ Resume all' : '⏸ Pause all'}
        </button>
        <span className={`conn ${connected ? 'ok' : 'wait'}`} data-testid="connection" title={demo ? 'Demo: fake engine' : 'Engine'}>
          <i /> {connected ? (demo ? 'demo engine' : 'connected') : 'waiting'}
        </span>
      </div>
    </header>
  )
}
