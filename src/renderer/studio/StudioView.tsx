import { useEffect, useRef } from 'react'
import { useToy } from '../store/hooks'
import { stageLabel } from '../store/model'
import { toyStore } from '../store/store'
import { AgentDrawer } from '../ui/AgentsPanel'
import { Stepper } from '../ui/Stepper'
import { createStudioGame } from './scene'

export function StudioView() {
  const host = useRef<HTMLDivElement>(null)
  const selectedEpisode = useToy((s) => s.selectedEpisode)
  const episodes = useToy((s) => s.episodes)
  const order = useToy((s) => s.episodeOrder)
  const selectedAgent = useToy((s) => s.selectedAgent)

  useEffect(() => {
    if (!host.current) return
    const el = host.current
    const game = createStudioGame(el)
    // Phaser listens to window resizes only; the pane also changes size when the terminal opens or the view switches
    const ro = new ResizeObserver(() => {
      game.scale.getParentBounds()
      game.scale.refresh()
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      game.destroy(true)
    }
  }, [])

  const busy = (e: { status: string } | undefined) => !!e && (e.status === 'running' || e.status === 'awaiting_approval')
  const picked = selectedEpisode ? episodes[selectedEpisode] : undefined
  // a finished or failed selection gives way to an episode that is being made
  const active = (busy(picked) ? picked : undefined) || order.map((id) => episodes[id]).find(busy) || picked || undefined
  return (
    <div className="studio" data-testid="studio">
      <div className="studio-top">
        {active ? (
          <div className="now-playing" data-testid="now-playing">
            <div className="now-title">
              <b>{active.title || active.theme}</b>
              <span className="chip">{active.status === 'awaiting_approval' ? `waiting for you: ${active.awaiting}` : stageLabel(active.stage)}</span>
              <button className="btn small" onClick={() => toyStore.getState().selectEpisode(active.id)}>
                Open episode
              </button>
            </div>
            <Stepper episode={active} compact />
          </div>
        ) : (
          <div className="now-playing quiet">The studio is quiet. Press New Episode and the crew will get to work.</div>
        )}
      </div>
      <div className="canvas-wrap">
        <div ref={host} className="canvas-host" data-testid="studio-canvas" />
        {selectedAgent && <AgentDrawer id={selectedAgent} />}
      </div>
    </div>
  )
}
