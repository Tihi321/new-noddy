import type { EpisodeSummary } from '../../shared/protocol'
import { STAGES, stageIndex } from '../store/model'

/** The pipeline as a row of chunky steps. Done steps are filled, the current one pulses, a waiting one shows a hand. */
export function Stepper({ episode, compact = false }: { episode: EpisodeSummary; compact?: boolean }) {
  const cur = episode.stage === 'done' || episode.status === 'done' ? STAGES.length - 1 : stageIndex(episode.stage)
  const failed = episode.status === 'failed'
  const waiting = episode.status === 'awaiting_approval'
  return (
    <ol className={`stepper ${compact ? 'compact' : ''}`} data-testid="stepper" data-stage={episode.stage}>
      {STAGES.map((s, i) => {
        const state = i < cur ? 'done' : i === cur ? (failed ? 'failed' : waiting ? 'waiting' : episode.status === 'done' ? 'done' : 'current') : 'todo'
        return (
          <li key={s.id} className={`step ${state}`} data-step={s.id} data-state={state} title={s.label}>
            <span className="step-dot">{state === 'done' ? '✓' : state === 'waiting' ? '✋' : state === 'failed' ? '!' : i + 1}</span>
            <span className="step-label">{s.short}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function StageBar({ episode }: { episode: EpisodeSummary }) {
  const pct = episode.status === 'done' ? 100 : Math.round((stageIndex(episode.stage) / (STAGES.length - 1)) * 100)
  return (
    <div className="stagebar" title={`${pct}%`}>
      <div style={{ width: `${pct}%` }} className={episode.status} />
    </div>
  )
}
