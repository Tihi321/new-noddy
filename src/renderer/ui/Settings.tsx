import { useEffect, useState } from 'react'
import { files, openFolder, sendCommand } from '../api'
import { useToy } from '../store/hooks'
import { formatUsd } from '../store/model'

const KEY_VARS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY'
}

function Meter({ label, value, cap }: { label: string; value: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (value / cap) * 100) : 0
  return (
    <div className="meter" data-testid={`meter-${label.toLowerCase()}`}>
      <div className="meter-head">
        <b>{label}</b>
        <span>
          {formatUsd(value)} of {cap > 0 ? formatUsd(cap) : 'no cap'}
        </span>
      </div>
      <div className="bar">
        <div className={pct > 80 ? 'hot' : ''} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function frontmatterValue(md: string, key: string): string {
  const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(md)
  return (m?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
}

export function Settings() {
  const models = useToy((s) => s.models)
  const secrets = useToy((s) => s.secretsSet)
  const spend = useToy((s) => s.spend)
  const dataDir = useToy((s) => s.dataDir)
  const toolInfo = useToy((s) => s.tools)
  const [tools, setTools] = useState<Record<string, string> | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    let off = false
    void files.readFile('config/tools.md').then((md) => {
      if (off || md === null) return
      setTools({ blender: frontmatterValue(md, 'blender'), godot: frontmatterValue(md, 'godot'), ffmpeg: frontmatterValue(md, 'ffmpeg') })
    })
    return () => {
      off = true
    }
  }, [])

  const providers = [...new Set(models.map((m) => m.provider))].map((id) => {
    const list = models.filter((m) => m.provider === id)
    const local = list.some((m) => m.local)
    const keyVar = KEY_VARS[id]
    return { id, local, count: list.length, enabled: list.some((m) => m.enabled), keyVar, keySet: keyVar ? secrets.includes(keyVar) : null }
  })

  return (
    <section className="panel" data-testid="settings">
      <div className="panel-head">
        <h2>Settings</h2>
      </div>
      <div className="settings-grid">
        <div className="card">
          <h3>Providers</h3>
          <ul className="plain" data-testid="providers">
            {providers.map((p) => (
              <li key={p.id} className="prov-row" data-provider={p.id}>
                <b>{p.id}</b>
                <span className={`badge ${p.local ? 'local' : 'api'}`}>{p.local ? 'LOCAL' : 'API'}</span>
                <span className="dim">{p.count} models</span>
                <span style={{ flex: 1 }} />
                {p.keySet === null ? (
                  <span className={`chip ${p.enabled ? 'ok' : ''}`}>{p.enabled ? 'reachable' : 'not running'}</span>
                ) : (
                  <span className={`chip ${p.keySet ? 'ok' : 'warn'}`} title={p.keyVar}>
                    {p.keySet ? 'key set' : 'no key'}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="hint">
            Keys are never stored in files. Set one with <code>npm run key:set ANTHROPIC_API_KEY</code>, or as an environment variable.
          </p>
        </div>
        <div className="card">
          <h3>Budget</h3>
          <Meter label="Today" value={spend.today} cap={spend.dailyCap} />
          <Meter label="Month" value={spend.month} cap={spend.monthlyCap} />
          <p className="hint">Local models are free. Caps live in config/budget.md and change without a restart.</p>
        </div>
        <div className="card">
          <h3>Tools</h3>
          <ul className="plain" data-testid="tools">
            {(['blender', 'godot', 'ffmpeg'] as const).map((t) => {
              const info = toolInfo.find((x) => x.name === t)
              return (
                <li key={t} className="prov-row" data-tool={t} data-ok={info ? String(info.ok) : 'unknown'}>
                  <b>{t}</b>
                  {info ? (
                    <>
                      <span className={`chip ${info.ok ? 'ok' : 'warn'}`}>{info.ok ? 'found' : 'not found'}</span>
                      <span className="dim mono" title={info.path}>
                        {info.ok ? info.version.slice(0, 40) : tools?.[t] || 'not found on PATH or in the usual folders'}
                      </span>
                    </>
                  ) : (
                    <span className="dim mono">{tools?.[t] || (tools ? 'checking...' : 'unknown')}</span>
                  )}
                </li>
              )
            })}
          </ul>
          <button className="btn small" onClick={() => sendCommand({ type: 'refreshTools' })} data-testid="refresh-tools">
            Check again
          </button>
          <p className="hint">
            Run <code>npm run doctor</code> to check Blender, Godot, ffmpeg and LM Studio. Paths are set in config/tools.md.
          </p>
        </div>
        <div className="card">
          <h3>Defaults</h3>
          {confirmReset ? (
            <div data-testid="reset-confirm">
              <p className="hint">Put the prompts and sets back to the built-in versions? Your current files are kept in a backup folder.</p>
              <div className="approval-actions">
                <button className="btn small" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
                <button
                  className="btn small warn"
                  onClick={() => {
                    sendCommand({ type: 'resetSeed', only: ['prompts', 'sets'] })
                    setConfirmReset(false)
                  }}
                  data-testid="reset-confirm-yes"
                >
                  Yes, reset
                </button>
              </div>
            </div>
          ) : (
            <button className="btn small" onClick={() => setConfirmReset(true)} data-testid="reset-seed">
              Reset prompts/sets to defaults
            </button>
          )}
        </div>
        <div className="card">
          <h3>Data folder</h3>
          <p className="mono">{dataDir || 'not connected'}</p>
          <button className="btn small" onClick={() => void openFolder('episodes')}>
            Open folder
          </button>
        </div>
      </div>
    </section>
  )
}
