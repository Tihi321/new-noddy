import { useEffect, useRef, useState } from 'react'
import { EPISODE_TYPES, type EpisodeType } from '../../shared/protocol'
import { files, sendCommand } from '../api'
import { useToy } from '../store/hooks'
import { EPISODE_TYPE_INFO } from '../store/model'
import { toyStore } from '../store/store'

const FALLBACK_CAST = ['tock', 'bobbin', 'constable_buttons', 'granny_thimble', 'moo_moo', 'squibble_a', 'squibble_b']
const PRETTY: Record<string, string> = { squibble_a: 'Squibble', squibble_b: 'Squabble' }
const CAST_ICON: Record<string, string> = { tock: '🪵', bobbin: '🧶', constable_buttons: '👮', granny_thimble: '🧵', moo_moo: '🐮', squibble_a: '🐥', squibble_b: '🐤' }
const EXAMPLES = ['A windy day', 'The lost balloon', 'Granny\'s birthday cake', 'A snowy surprise', 'Sharing the swing', 'The missing moon pie']
const FALLBACK_STYLES = [{ id: 'toyland-wood', name: 'Toyland wood (painted peg dolls)' }]

function titleCase(id: string): string {
  return PRETTY[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function NewEpisodeDialog({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState('')
  const [type, setType] = useState<EpisodeType>('adventure')
  const [cast, setCast] = useState<string[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [lengthMin, setLengthMin] = useState(5)
  const [style, setStyle] = useState('toyland-wood')
  const [approveScript, setApproveScript] = useState(true)
  const [approveAnimatic, setApproveAnimatic] = useState(true)
  const input = useRef<HTMLTextAreaElement>(null)
  const snapCast = useToy((s) => s.cast)
  const snapStyles = useToy((s) => s.styles)
  const castList = snapCast.length ? snapCast.map((c) => c.id) : FALLBACK_CAST
  const styles = snapStyles.length ? snapStyles : FALLBACK_STYLES
  const styleId = styles.some((x) => x.id === style) ? style : (styles[0]?.id ?? style)
  const nameOf = (id: string) => snapCast.find((c) => c.id === id)?.name ?? names[id] ?? titleCase(id)

  useEffect(() => {
    input.current?.focus()
    // names come from cast/<id>.md when the data folder has them; otherwise the fixed list stays
    let off = false
    void Promise.all(
      FALLBACK_CAST.map(async (id) => {
        const md = await files.readFile(`cast/${id}.md`)
        const name = md ? /^name:\s*["']?(.+?)["']?\s*$/m.exec(md)?.[1] : undefined
        return [id, name] as const
      })
    ).then((pairs) => {
      if (off) return
      setNames(Object.fromEntries(pairs.filter((p): p is [string, string] => !!p[1])))
    })
    return () => {
      off = true
    }
  }, [])

  const toggle = (id: string) => setCast((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const valid = theme.trim().length > 0 && lengthMin >= 1

  const submit = () => {
    if (!valid) return
    sendCommand({
      type: 'newEpisode',
      theme: theme.trim(),
      episodeType: type,
      characters: cast,
      lengthMin,
      style: styleId,
      approvals: { script: approveScript, animatic: approveAnimatic }
    })
    toyStore.getState().expectNewEpisode()
    toyStore.getState().setView('studio')
    onClose()
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="new-episode-dialog">
      <form
        className="modal"
        role="dialog"
        aria-label="New Episode"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <header className="modal-head">
          <h2>✨ New Episode</h2>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <label className="field-label" htmlFor="theme">
          What is the episode about?
        </label>
        <textarea
          id="theme"
          ref={input}
          rows={2}
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          placeholder="For example: Tock helps Bobbin find a lost balloon"
          data-testid="theme-input"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="chips">
          {EXAMPLES.map((ex) => (
            <button type="button" key={ex} className="chip clickable" onClick={() => setTheme(ex)} data-testid="theme-chip">
              {ex}
            </button>
          ))}
        </div>

        <div className="field-label">Kind of episode</div>
        <div className="type-grid" role="radiogroup" aria-label="Episode type">
          {EPISODE_TYPES.map((t) => {
            const info = EPISODE_TYPE_INFO[t]!
            return (
              <button type="button" key={t} role="radio" aria-checked={type === t} className={`type-tile ${type === t ? 'on' : ''}`} onClick={() => setType(t)} data-testid={`type-${t}`}>
                <span className="type-icon" aria-hidden>
                  {info.icon}
                </span>
                <b>{info.label}</b>
                <span className="dim small-text">{info.blurb}</span>
              </button>
            )
          })}
        </div>

        <div className="field-label">
          Featured characters <span className="dim">(leave empty and the producer picks)</span>
        </div>
        <div className="chips" data-testid="cast-picker">
          {castList.map((id) => (
            <button type="button" key={id} className={`chip cast ${cast.includes(id) ? 'on' : ''}`} aria-pressed={cast.includes(id)} onClick={() => toggle(id)} data-testid={`cast-${id}`}>
              <span aria-hidden>{CAST_ICON[id] ?? '🧸'}</span> {nameOf(id)}
            </button>
          ))}
        </div>

        <div className="row-fields">
          <div>
            <label className="field-label" htmlFor="len">
              Length (minutes)
            </label>
            <input id="len" type="number" min={1} max={15} value={lengthMin} onChange={(e) => setLengthMin(Number(e.target.value))} data-testid="length-input" />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label" htmlFor="style">
              Style
            </label>
            <select id="style" value={styleId} onChange={(e) => setStyle(e.target.value)} data-testid="style-select">
              {styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-label">Stop and ask me before moving on</div>
        <div className="toggles">
          <label className="toggle">
            <input type="checkbox" checked={approveScript} onChange={(e) => setApproveScript(e.target.checked)} data-testid="approve-script" />
            <span className="switch" /> After the script
          </label>
          <label className="toggle">
            <input type="checkbox" checked={approveAnimatic} onChange={(e) => setApproveAnimatic(e.target.checked)} data-testid="approve-animatic" />
            <span className="switch" /> After the animatic
          </label>
        </div>

        <footer className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary big" disabled={!valid} data-testid="start-episode">
            🎬 Start the crew
          </button>
        </footer>
      </form>
    </div>
  )
}
