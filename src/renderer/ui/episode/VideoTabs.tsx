import type { Shots } from '../../../shared/episode'
import type { EpisodeSummary } from '../../../shared/protocol'
import { media, openFolder, sendCommand } from '../../api'
import { useToy } from '../../store/hooks'
import { formatDuration, formatUsd, renderTotals, shotEta, stageIndex } from '../../store/model'
import { useEpisodeJson } from './useEpisodeFile'

function Player({ src, label, testid }: { src: string; label: string; testid: string }) {
  if (!src)
    return (
      <div className="video-demo" data-testid={`${testid}-placeholder`}>
        <div className="empty-emoji">📺</div>
        <b>{label}</b>
        <span className="dim">Demo mode has no real video. In the app the player shows the file from the data folder.</span>
      </div>
    )
  return <video key={src} className="video" controls preload="metadata" src={src} data-testid={testid} />
}

export function AnimaticTab({ ep }: { ep: EpisodeSummary }) {
  const tick = useToy((s) => s.assetTick[ep.id] ?? 0)
  const ready = !!ep.assets.animatic || stageIndex(ep.stage) > stageIndex('preview')
  if (!ready)
    return (
      <div className="empty-state" data-testid="animatic-empty">
        <div className="empty-emoji">🎞️</div>
        The animatic is made after the shots, sounds and tracks are ready.
      </div>
    )
  return (
    <div data-testid="animatic-tab" data-tick={tick}>
      <p className="hint">The animatic is a quick, rough preview. Check the story and timing here before the slow final render.</p>
      <Player src={media(`episodes/${ep.id}/preview/animatic.mp4`)} label="animatic.mp4" testid="animatic-video" />
      <div className="final-bar">
        <button className="btn" onClick={() => sendCommand({ type: 'openGodot', episode: ep.id })} data-testid="open-godot" title="Open the first shot in a Godot window you can scrub through">
          Open in Godot
        </button>
      </div>
    </div>
  )
}

export function FinalTab({ ep }: { ep: EpisodeSummary }) {
  const ready = !!ep.assets.final || ep.status === 'done'
  if (!ready)
    return (
      <div className="empty-state" data-testid="final-empty">
        <div className="empty-emoji">🍿</div>
        The finished episode appears here when the render and the edit are done.
      </div>
    )
  return (
    <div data-testid="final-tab">
      <Player src={media(`episodes/${ep.id}/out/episode.mp4`)} label="episode.mp4" testid="final-video" />
      <div className="final-bar">
        <button className="btn primary" onClick={() => void openFolder(`episodes/${ep.id}/out`)} data-testid="open-folder">
          📂 Open folder
        </button>
        <span className="chip">{formatUsd(ep.costUsd)} spent</span>
        <span className="chip">{ep.shots ?? '?'} shots</span>
        <span className="dim mono">episodes/{ep.id}/out/episode.mp4</span>
      </div>
    </div>
  )
}

export function RenderTab({ ep }: { ep: EpisodeSummary }) {
  const { data } = useEpisodeJson<Shots>(ep, 'shots.json')
  const render = useToy((s) => s.render[ep.id])
  const finished = stageIndex(ep.stage) > stageIndex('render') || ep.status === 'done'
  const shots = data?.shots ?? []
  const frames = (id: string) => Math.round((shots.find((s) => s.id === id)?.duration ?? 12) * 12)
  const totals = renderTotals(render, shots.length || ep.shots)
  const rows = (shots.length ? shots.map((s) => s.id) : (render?.order ?? [])).map((id) => {
    const p = render?.shots[id]
    const total = p?.total ?? frames(id)
    const done = finished ? total : (p?.done ?? 0)
    return { id, done, total, eta: finished || !p ? null : shotEta(p) }
  })
  const stageIdx = stageIndex(ep.stage)
  if (stageIdx < stageIndex('render') && !render && !finished)
    return (
      <div className="empty-state" data-testid="render-empty">
        <div className="empty-emoji">🖼️</div>
        The render farm starts after the animatic is approved.
      </div>
    )
  const allTotal = rows.reduce((n, r) => n + r.total, 0) || totals.total
  const doneFrames = finished ? allTotal : Math.max(totals.done, 0)
  const pct = allTotal ? Math.min(100, (doneFrames / allTotal) * 100) : 0
  return (
    <div data-testid="render-tab">
      <div className="card render-summary">
        <div className="meter-head">
          <b>Render</b>
          <span data-testid="render-frames">
            {doneFrames} / {allTotal} frames
          </span>
        </div>
        <div className="bar big">
          <div style={{ width: `${pct}%` }} />
        </div>
        <div className="summary-line">
          <span className="chip">{finished ? shots.length : totals.shotsDone} / {shots.length || ep.shots || '?'} shots done</span>
          <span className="chip" data-testid="render-eta">
            {finished ? 'finished' : totals.etaSec !== null ? `about ${formatDuration(totals.etaSec)} left` : 'estimating time...'}
          </span>
        </div>
      </div>
      <ul className="render-list">
        {rows.map((r) => {
          const f = r.total ? (r.done / r.total) * 100 : 0
          return (
            <li key={r.id} className={r.done >= r.total ? 'done' : r.done > 0 ? 'active' : ''} data-testid="render-row" data-shot={r.id}>
              <b>{r.id}</b>
              <div className="bar">
                <div style={{ width: `${f}%` }} />
              </div>
              <span className="frames">
                {r.done}/{r.total}
              </span>
              <span className="dim eta">{r.done >= r.total ? '✓' : r.eta !== null ? formatDuration(r.eta) : ''}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
