import { useState } from 'react'
import type { Shots } from '../../../shared/episode'
import type { EpisodeSummary } from '../../../shared/protocol'
import { media, sendCommand } from '../../api'
import { useToy } from '../../store/hooks'
import { formatDuration } from '../../store/model'
import { prettyId } from './BriefTab'
import { useEpisodeJson } from './useEpisodeFile'

const FRAMING: Record<string, string> = {
  establishing: 'Establishing',
  wide: 'Wide',
  medium: 'Medium',
  close: 'Close-up',
  two_shot: 'Two-shot',
  over_shoulder: 'Over the shoulder'
}

function Thumb({ ep, shotId }: { ep: EpisodeSummary; shotId: string }) {
  const tick = useToy((s) => s.assetTick[ep.id] ?? 0)
  const [failed, setFailed] = useState(false)
  const src = media(`episodes/${ep.id}/preview/thumbs/${shotId}.png`)
  if (!src || failed)
    return (
      <div className="thumb empty" data-testid="thumb-empty">
        <span aria-hidden>🎞️</span>
        <span className="dim small-text">no preview yet</span>
      </div>
    )
  return <img key={tick} className="thumb" src={src} alt={`Preview of ${shotId}`} loading="lazy" onError={() => setFailed(true)} data-testid="thumb" />
}

export function ShotsTab({ ep }: { ep: EpisodeSummary }) {
  const { data, loaded } = useEpisodeJson<Shots>(ep, 'shots.json')
  if (!data)
    return (
      <div className="empty-state" data-testid="shots-empty">
        <div className="empty-emoji">🎥</div>
        {loaded ? 'The director has not planned the shots yet.' : 'Loading...'}
      </div>
    )
  const total = data.shots.reduce((n, s) => n + s.duration, 0)
  return (
    <div data-testid="shots-tab">
      <div className="summary-line">
        <span className="chip">{data.shots.length} shots</span>
        <span className="chip">{formatDuration(total)} total</span>
      </div>
      <div className="shot-grid">
        {data.shots.map((s) => (
          <article className="shot-card" key={s.id} data-testid="shot-card" data-shot={s.id}>
            <Thumb ep={ep} shotId={s.id} />
            <div className="shot-body">
              <div className="shot-head">
                <b>{s.id}</b>
                <span className="chip small">{s.duration}s</span>
              </div>
              <div className="shot-tags">
                <span className="tag framing">{FRAMING[s.framing] ?? s.framing}</span>
                <span className="tag">{s.angle} angle</span>
                <span className="tag">{s.cameraMove.replace(/_/g, ' ')}</span>
              </div>
              <div className="dim small-text">
                {prettyId(s.setId)}
                {s.cast.length ? ` · ${s.cast.map(prettyId).join(', ')}` : ''}
              </div>
              {s.lines.length > 0 && <div className="small-text">🗨 {s.lines.join(', ')}</div>}
              {s.notes && <div className="shot-notes">{s.notes}</div>}
              <button className="btn small" onClick={() => sendCommand({ type: 'openGodot', episode: ep.id, shot: s.id })} data-testid="open-godot-shot" title="Open this shot in a Godot window you can scrub through">
                Open in Godot
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
