import type { Brief } from '../../../shared/episode'
import type { EpisodeSummary } from '../../../shared/protocol'
import { EPISODE_TYPE_INFO } from '../../store/model'
import { useEpisodeJson } from './useEpisodeFile'

const NAMES: Record<string, string> = { squibble_a: 'Squibble', squibble_b: 'Squabble' }
export const prettyId = (id: string): string => NAMES[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export function BriefTab({ ep }: { ep: EpisodeSummary }) {
  const { data: brief, loaded } = useEpisodeJson<Brief>(ep, 'brief.json')
  const type = EPISODE_TYPE_INFO[ep.type]
  if (!brief)
    return (
      <div className="empty-state" data-testid="brief-empty">
        <div className="empty-emoji">📝</div>
        {loaded ? 'The producer has not written the brief yet.' : 'Loading...'}
        <div className="dim">You asked for: "{ep.theme}"</div>
      </div>
    )
  const rows: [string, string, string][] = [
    ['🧩', 'The problem', brief.problem],
    ['💛', 'How friends solve it', brief.solution],
    ['🌟', 'The little lesson', brief.moral],
    ['🎨', 'Tone', brief.tone]
  ]
  return (
    <div className="brief" data-testid="brief-tab">
      <div className="card hero-card">
        <div className="dim">
          {type?.icon} {type?.label} · {Math.round(brief.lengthSec / 60)} min
        </div>
        <h3>{brief.title}</h3>
        <p className="logline">{brief.logline}</p>
      </div>
      <div className="brief-grid">
        {rows.map(([icon, label, value]) => (
          <div className="card" key={label}>
            <div className="card-label">
              <span aria-hidden>{icon}</span> {label}
            </div>
            <p>{value}</p>
          </div>
        ))}
        <div className="card">
          <div className="card-label">🧸 Cast</div>
          <div className="chips">
            {brief.cast.map((c) => (
              <span key={c} className="chip cast on">
                {prettyId(c)}
              </span>
            ))}
            {brief.guests.map((g) => (
              <span key={g.id} className="chip guest" title={g.description}>
                {g.name} (guest)
              </span>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-label">🏘️ Places</div>
          <div className="chips">
            {brief.locations.map((l) => (
              <span key={l} className="chip">
                {prettyId(l)}
              </span>
            ))}
            {brief.newLocations.map((l) => (
              <span key={l.id} className="chip guest" title={l.description}>
                {l.name} (new)
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
