import type { Script } from '../../../shared/episode'
import type { EpisodeSummary } from '../../../shared/protocol'
import { mumbleOf } from '../../store/model'
import { prettyId } from './BriefTab'
import { useEpisodeJson } from './useEpisodeFile'

const EMOTION: Record<string, string> = {
  neutral: '😐',
  happy: '😊',
  sad: '😢',
  excited: '🤩',
  worried: '😟',
  angry: '😠',
  surprised: '😮',
  sleepy: '😴',
  question: '🤔',
  laugh: '😂'
}

export function ScriptTab({ ep }: { ep: EpisodeSummary }) {
  const { data: script, loaded } = useEpisodeJson<Script>(ep, 'script.json')
  if (!script)
    return (
      <div className="empty-state" data-testid="script-empty">
        <div className="empty-emoji">✍️</div>
        {loaded ? 'The script is still being written.' : 'Loading...'}
      </div>
    )
  return (
    <div className="script" data-testid="script-tab">
      <div className="card hero-card">
        <h3>{script.title}</h3>
        <p className="logline">{script.logline}</p>
        <p className="moral">
          <span aria-hidden>🌟</span> {script.moral}
        </p>
        <div className="dim small-text">Characters only mumble. The words in brackets are what the mumble means, shown as subtitles.</div>
      </div>
      {script.scenes.map((scene, i) => (
        <section className="scene" key={scene.id} data-testid="scene">
          <h4>
            <span className="scene-no">Scene {i + 1}</span> {prettyId(scene.setId)}
          </h4>
          <p className="scene-summary">{scene.summary}</p>
          {scene.beats.map((b) =>
            b.kind === 'action' ? (
              <div className="beat action" key={b.id} data-testid="beat-action">
                <span className="beat-icon" aria-hidden>
                  🎬
                </span>
                {b.text}
              </div>
            ) : (
              <div className="beat line" key={b.id} data-testid="beat-line">
                <span className="speaker">{prettyId(b.character ?? '?')}</span>
                <div className="bubble-line">
                  <div className="mumble" data-testid="mumble">
                    🗨 {mumbleOf(b.text)}
                  </div>
                  <div className="subtitle" data-testid="subtitle">
                    {b.text}
                  </div>
                </div>
                {b.emotion && (
                  <span className={`emotion e-${b.emotion}`} data-testid="emotion" title={b.emotion}>
                    {EMOTION[b.emotion] ?? ''} {b.emotion}
                  </span>
                )}
              </div>
            )
          )}
        </section>
      ))}
    </div>
  )
}
