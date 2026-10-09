import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { files } from '../api'
import { useToy } from '../store/hooks'
import { formatUsd } from '../store/model'
import { jobToText, jobType, mergeJobs, parseLog, type JobLog } from '../store/logModel'
import { toyStore } from '../store/store'

const PAGE = 40
const OUTPUT_PREVIEW = 6000
const LIVE_TAIL = 24_000
const HISTORY_BYTES = 262_144

function fmtTime(ms: number): string {
  if (!ms) return '--:--:--'
  return new Date(ms).toLocaleTimeString([], { hour12: false })
}

async function loadFullRequest(jobId: string): Promise<string> {
  for (const state of ['running', 'done', 'failed', 'queued']) {
    const text = await files.readFile(`jobs/${state}/${jobId}.md`)
    if (text !== null) return text
  }
  return '(the job file could not be read)'
}

function JobBlock({ job, live }: { job: JobLog; live: boolean }) {
  const [full, setFull] = useState(false)
  const [request, setRequest] = useState<string | null>(null)
  const output = job.output
  const long = output.length > OUTPUT_PREVIEW
  const shown = live ? (output.length > LIVE_TAIL ? '[...]\n' + output.slice(output.length - LIVE_TAIL) : output) : long && !full ? output.slice(0, OUTPUT_PREVIEW) + '\n[...]' : output
  const running = job.finishedAt === undefined && !job.fromHistory
  const cls = running ? 'running' : job.ok === false ? 'failed' : 'ok'
  return (
    <div className={`job ${cls}`} data-testid="job-block" data-job={job.jobId}>
      <div className="job-head">
        <span className="mono">{fmtTime(job.startedAt)}</span> <b>{job.task || '(task)'}</b> {running && <span className="chip small">running...</span>}
      </div>
      <div className="job-meta">
        job {job.jobId} | from {job.requestedBy ?? (job.fromHistory ? '?' : 'engine')} | {job.agent}
        {job.episode ? ` | episode ${job.episode}` : ''}
        {job.model ? ` | ${job.model}` : ''}
      </div>
      {job.context.length > 0 && (
        <details>
          <summary className="section">
            given: {job.context.length} items, {job.context.reduce((n, c) => n + c.tokens, 0)} tokens
          </summary>
          {job.context.map((c, i) => (
            <div key={i} className="job-meta">
              - {c.name} ({c.tokens} tokens)
            </div>
          ))}
        </details>
      )}
      <div>
        <button className="btn tiny" onClick={() => (request === null ? void loadFullRequest(job.jobId).then(setRequest) : setRequest(null))} data-testid="expand-request">
          {request === null ? 'Expand full request' : 'Hide full request'}
        </button>
        {request !== null && <pre className="job-meta">{request.length > 30_000 ? request.slice(0, 30_000) + '\n[...]' : request}</pre>}
      </div>
      {shown && <pre className="out">{shown}</pre>}
      {long && !live && !full && (
        <button className="btn tiny" onClick={() => setFull(true)}>
          Show all {output.length} characters
        </button>
      )}
      {job.error ? (
        <pre className="err">error: {job.error}</pre>
      ) : job.result ? (
        <pre className="section">
          result: {job.result}
          {job.destination ? `  -> ${job.destination}` : ''}
        </pre>
      ) : null}
      {(job.tokensIn !== undefined || job.costUsd !== undefined) && (
        <div className="nums">
          {job.model ? `${job.model} | ` : ''}
          {job.tokensIn ?? 0} in / {job.tokensOut ?? 0} out tokens | {formatUsd(job.costUsd ?? 0)}
          {job.seconds !== undefined ? ` | ${job.seconds}s` : job.finishedAt ? ` | ${((job.finishedAt - job.startedAt) / 1000).toFixed(1)}s` : ''}
        </div>
      )}
    </div>
  )
}

/** Live token stream per agent or per episode, with the log history above it. */
export function Terminal() {
  const mode = useToy((s) => s.terminalMode)
  const selectedAgent = useToy((s) => s.selectedAgent)
  const selectedEpisode = useToy((s) => s.selectedEpisode)
  const agents = useToy((s) => s.agents)
  const agentOrder = useToy((s) => s.agentOrder)
  const episodes = useToy((s) => s.episodes)
  const jobs = useToy((s) => s.jobs)
  const jobsByAgent = useToy((s) => s.jobsByAgent)
  const jobsByEpisode = useToy((s) => s.jobsByEpisode)

  const agentId = selectedAgent ?? agentOrder[0] ?? null
  const episodeId = selectedEpisode
  const key = mode === 'agent' ? (agentId ? `logs/agents/${agentId}.md` : '') : episodeId ? `episodes/${episodeId}/log.md` : ''

  const [history, setHistory] = useState<JobLog[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [pages, setPages] = useState(1)
  const [stick, setStick] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setHistory([])
    setLoaded(false)
    setPages(1)
    setStick(true)
    if (!key) return
    void files.tailFile(key, -HISTORY_BYTES).then((r) => {
      if (cancelled) return
      setHistory(r ? parseLog(r.text, agentId ?? '').map((j) => (j.agent ? j : { ...j, agent: agentId ?? '' })) : [])
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [key, agentId])

  const liveIds = mode === 'agent' ? (agentId ? jobsByAgent[agentId] : undefined) : episodeId ? jobsByEpisode[episodeId] : undefined
  const all = useMemo(() => {
    const live = (liveIds ?? []).map((id) => jobs[id]).filter((j): j is JobLog => !!j)
    return mergeJobs(history, live)
  }, [history, liveIds, jobs])

  const types = useMemo(() => [...new Set(all.map((j) => jobType(j.task)).filter(Boolean))], [all])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((j) => (!typeFilter || jobType(j.task) === typeFilter) && (!q || jobToText(j).toLowerCase().includes(q)))
  }, [all, query, typeFilter])
  const visible = filtered.slice(Math.max(0, filtered.length - pages * PAGE))

  const lastLen = visible.length ? visible[visible.length - 1]!.output.length : 0
  useLayoutEffect(() => {
    const el = logRef.current
    if (el && stick) el.scrollTop = el.scrollHeight
  }, [visible.length, lastLen, stick])

  const onScroll = useCallback(() => {
    const el = logRef.current
    if (!el) return
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }, [])

  const copy = () => {
    void navigator.clipboard?.writeText(filtered.map(jobToText).join('\n\n')).catch(() => undefined)
  }

  const title = mode === 'agent' ? (agentId ? (agents[agentId]?.name ?? agentId) : 'no agent selected') : episodeId ? (episodes[episodeId]?.title ?? episodeId) : 'no episode selected'
  return (
    <div className="terminal" data-testid="terminal">
      <div className="terminal-bar">
        <span className="seg">
          <button className={mode === 'agent' ? 'on' : ''} onClick={() => toyStore.getState().setTerminal(true, 'agent')} data-testid="tab-agent">
            Agent
          </button>
          <button className={mode === 'episode' ? 'on' : ''} onClick={() => toyStore.getState().setTerminal(true, 'episode')} data-testid="tab-episode">
            Episode
          </button>
        </span>
        {mode === 'agent' && (
          <select value={agentId ?? ''} onChange={(e) => toyStore.getState().selectAgent(e.target.value || null)} aria-label="Agent" data-testid="terminal-agent">
            {agentOrder.map((id) => (
              <option key={id} value={id}>
                {agents[id]?.name ?? id}
              </option>
            ))}
          </select>
        )}
        <b data-testid="terminal-title">{title}</b>
        <input type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="terminal-search" />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} title="Filter by job type" aria-label="Job type">
          <option value="">all job types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button className="btn tiny" onClick={copy} data-testid="terminal-copy">
          Copy
        </button>
        <span className="dim">
          {filtered.length} jobs{!loaded && key ? ', loading history...' : ''}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn tiny" onClick={() => toyStore.getState().setTerminal(false)} data-testid="terminal-close">
          Close
        </button>
      </div>
      <div className="log" ref={logRef} onScroll={onScroll} data-testid="terminal-log">
        {filtered.length > visible.length && (
          <button className="btn tiny" onClick={() => setPages((p) => p + 1)}>
            Show {Math.min(PAGE, filtered.length - visible.length)} earlier jobs
          </button>
        )}
        {visible.length === 0 && <div className="empty">{key ? 'Nothing logged yet. Live output appears here.' : 'Click a crew member in the studio, or pick an episode.'}</div>}
        {visible.map((j, i) => (
          <JobBlock key={j.jobId} job={j} live={i === visible.length - 1 && j.finishedAt === undefined} />
        ))}
        {!stick && (
          <button className="jump btn tiny primary" onClick={() => setStick(true)}>
            Jump to latest
          </button>
        )}
      </div>
    </div>
  )
}
