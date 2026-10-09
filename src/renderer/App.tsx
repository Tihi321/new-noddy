import { StudioView } from './studio/StudioView'
import { useToy } from './store/hooks'
import { toyStore } from './store/store'
import { AgentsPanel } from './ui/AgentsPanel'
import { EpisodePanel } from './ui/EpisodePanel'
import { Header } from './ui/Header'
import { NewEpisodeDialog } from './ui/NewEpisodeDialog'
import { Settings } from './ui/Settings'
import { Sidebar } from './ui/Sidebar'
import { Terminal } from './ui/Terminal'

export function App({ demo }: { demo: boolean }) {
  const view = useToy((s) => s.view)
  const newOpen = useToy((s) => s.newEpisodeOpen)
  const terminalOpen = useToy((s) => s.terminalOpen)
  return (
    <div className="app" data-testid="app">
      <Header demo={demo} />
      <div className="body">
        <Sidebar />
        <main className={`main ${terminalOpen ? 'with-terminal' : ''}`}>
          <div className="view">
            {/* the studio stays mounted so Phaser keeps running */}
            <div className={`view-pane ${view === 'studio' ? '' : 'inactive'}`} aria-hidden={view !== 'studio'}>
              <StudioView />
            </div>
            {view === 'episode' && <EpisodePanel />}
            {view === 'agents' && <AgentsPanel />}
            {view === 'settings' && <Settings />}
          </div>
          {terminalOpen && <Terminal />}
        </main>
      </div>
      {newOpen && <NewEpisodeDialog onClose={() => toyStore.getState().setNewEpisodeOpen(false)} />}
    </div>
  )
}
