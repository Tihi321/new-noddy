/**
 * Fake engine for `npm run dev:ui` (open with `?demo`). It answers the same commands as the real engine and
 * runs a whole episode through every stage: token streams, handovers, render progress and both approval checkpoints.
 * `?demo&speed=8` runs faster (the Playwright tests use it).
 */
import type { Brief, Script, Shots } from '../../shared/episode'
import type {
  AgentState,
  AgentSummary,
  Checkpoint,
  Command,
  EngineEvent,
  EpisodeSummary,
  NewEpisodeCommand,
  ToyboxApi
} from '../../shared/protocol'
import type { HostApi } from '../hostApi'
import { AGENT_DEFS, MODELS, ROLE_DEFAULTS, agentIdByRole, agentSummaries, makeBrief, makeScript, makeShots, slugify, thumbDataUrl } from './library'

type Handler = (e: EngineEvent) => void

interface Params {
  theme: string
  type: NewEpisodeCommand['episodeType']
  characters: string[]
  lengthMin: number
  approvals: { script: boolean; animatic: boolean }
}

interface Content {
  brief: Brief
  script: Script
  shots: Shots
}

interface WorkOptions {
  role: string
  task: string
  unit?: string
  episode: string
  from?: string
  /** Text streamed into the terminal. */
  text: string
  ms: number
  result?: string
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class FakeEngine implements ToyboxApi, HostApi {
  private handlers = new Set<Handler>()
  private files = new Map<string, string>()
  private media = new Set<string>()
  private agents = new Map<string, AgentSummary>()
  private current = new Map<string, { task: string; episode?: string; jobId: string } | null>()
  private episodes = new Map<string, EpisodeSummary>()
  private params = new Map<string, Params>()
  private content = new Map<string, Content>()
  private waiters = new Map<string, (r: { ok: true } | { ok: false; note: string }) => void>()
  private allPaused = false
  private jobSeq = 0
  private heartbeat = 0
  private started = Date.now()
  private spend = { today: 0.42, month: 6.18, dailyCap: 5, monthlyCap: 40 }

  constructor(private speed = 1) {
    for (const a of agentSummaries()) {
      this.agents.set(a.id, a)
      this.current.set(a.id, null)
    }
    this.files.set('config/tools.md', ['---', 'kind: tools', 'blender: ""', 'godot: ""', 'ffmpeg: "C:/Tools/ffmpeg/bin/ffmpeg.exe"', '---', ''].join('\n'))
    this.seed()
  }

  /** Puts this engine on `window.toybox`. */
  install(): void {
    const api = {
      on: (h: Handler) => this.on(h),
      send: (c: Command) => this.send(c),
      readFile: (rel: string) => this.readFile(rel),
      tailFile: (rel: string, from: number) => this.tailFile(rel, from),
      openFolder: (rel: string) => this.openFolder(rel),
      mediaUrl: (rel: string) => this.mediaUrl(rel)
    }
    window.toybox = api
    setInterval(() => this.emit({ type: 'engine.heartbeat', n: ++this.heartbeat, at: new Date().toISOString(), uptimeMs: Date.now() - this.started }), 5000)
  }

  // ---- host side ----

  on(handler: Handler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  async readFile(rel: string): Promise<string | null> {
    return this.files.get(rel) ?? null
  }

  async tailFile(rel: string, fromByte: number): Promise<{ text: string; size: number } | null> {
    const text = this.files.get(rel)
    if (text === undefined) return null
    return { text: fromByte < 0 ? text.slice(Math.max(0, text.length + fromByte)) : text.slice(fromByte), size: text.length }
  }

  async openFolder(rel: string): Promise<boolean> {
    this.emit({ type: 'engine.warning', message: `demo: would open folder ${rel}` })
    return true
  }

  mediaUrl(rel: string): string {
    if (!this.media.has(rel)) return ''
    const m = /episodes\/([^/]+)\/preview\/thumbs\/shot-(\d+)\.png$/.exec(rel)
    if (m) {
      const no = Number(m[2])
      const shots = this.content.get(m[1]!)?.shots.shots
      const shot = shots?.[no - 1]
      return thumbDataUrl(no, shot?.setId ?? 'town_square', `shot-${String(no).padStart(2, '0')}`)
    }
    return ''
  }

  private emit(e: EngineEvent): void {
    for (const h of this.handlers) h(e)
  }

  private snapshot(): EngineEvent {
    return {
      type: 'snapshot',
      dataDir: 'C:\\Users\\you\\ToyboxStudio (demo)',
      uptimeMs: Date.now() - this.started,
      paused: this.allPaused,
      agents: [...this.agents.values()],
      episodes: [...this.episodes.values()],
      models: MODELS,
      roleDefaults: ROLE_DEFAULTS,
      spend: this.spend,
      running: [...this.current.entries()].filter(([, c]) => c).map(([agent, c]) => ({ jobId: c!.jobId, agent })),
      secretsSet: ['ANTHROPIC_API_KEY'],
      tools: [
        { name: 'blender', ok: true, version: 'Blender 4.2.3 LTS', path: 'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe' },
        { name: 'godot', ok: true, version: '4.3.stable', path: 'C:/Tools/godot.exe' },
        { name: 'ffmpeg', ok: false, version: '', path: '' }
      ],
      cast: [
        { id: 'tock', name: 'Tock', body: 'peg' },
        { id: 'bobbin', name: 'Bobbin', body: 'teddy' },
        { id: 'constable_buttons', name: 'Constable Buttons', body: 'soldier' },
        { id: 'granny_thimble', name: 'Granny Thimble', body: 'gnome' },
        { id: 'moo_moo', name: 'Moo Moo', body: 'cow' },
        { id: 'squibble_a', name: 'Squibble', body: 'jack_box' },
        { id: 'squibble_b', name: 'Squabble', body: 'jack_box' }
      ],
      styles: [{ id: 'toyland-wood', name: 'Toyland Wood' }],
      at: new Date().toISOString()
    }
  }

  send(command: Command): void {
    switch (command.type) {
      case 'snapshot':
        this.emit(this.snapshot())
        break
      case 'ping':
        this.emit({ type: 'pong', id: command.id, at: new Date().toISOString() })
        break
      case 'pauseAll':
      case 'resumeAll':
        this.allPaused = command.type === 'pauseAll'
        this.emit({ type: 'factory.paused', paused: this.allPaused })
        for (const a of this.agents.values()) this.refreshState(a.id)
        break
      case 'pause':
      case 'resume': {
        const a = this.agents.get(command.agent)
        if (!a) break
        a.paused = command.type === 'pause'
        this.refreshState(a.id)
        break
      }
      case 'stop':
      case 'stopNow':
        break
      case 'retryEpisode':
        if (this.episodes.get(command.episode)?.status === 'failed') this.patch(command.episode, { status: 'running' })
        break
      case 'refreshTools':
        this.emit(this.snapshot())
        break
      case 'openGodot':
        this.emit({ type: 'engine.warning', message: `demo: would open Godot for ${command.episode}${command.shot ? ' / ' + command.shot : ''}` })
        break
      case 'resetSeed':
        this.emit({ type: 'engine.warning', message: 'demo: would reset prompts and sets to the defaults' })
        break
      case 'setModel': {
        const targets = command.agent ? [command.agent] : [...this.agents.values()].filter((a) => a.role === command.role).map((a) => a.id)
        for (const id of targets) {
          const a = this.agents.get(id)
          if (!a || a.kind === 'tool') continue
          a.model = command.model
          a.resolvedModel = command.model ?? ROLE_DEFAULTS[a.role] ?? null
        }
        this.emit(this.snapshot())
        break
      }
      case 'newEpisode':
        this.newEpisode(command)
        break
      case 'approve':
        this.waiters.get(`${command.episode}:${command.checkpoint}`)?.({ ok: true })
        break
      case 'requestChanges':
        this.waiters.get(`${command.episode}:${command.checkpoint}`)?.({ ok: false, note: command.note })
        break
    }
  }

  // ---- agents ----

  private setAgent(id: string, patch: Partial<AgentSummary>): void {
    const a = this.agents.get(id)
    if (!a) return
    Object.assign(a, patch)
    this.emit({ type: 'agent.state', agent: id, role: a.role, state: a.state, jobId: a.jobId, task: a.task, episode: a.episode })
  }

  /** Re-announces an agent's state after a pause or resume. */
  private refreshState(id: string): void {
    const a = this.agents.get(id)!
    const cur = this.current.get(id)
    const paused = a.paused || this.allPaused
    const state: AgentState = paused ? 'paused' : cur ? 'working' : 'idle'
    this.setAgent(id, { state, paused: a.paused, task: cur?.task, episode: cur?.episode, jobId: cur?.jobId })
  }

  private async gate(agent: string): Promise<void> {
    while (this.agents.get(agent)?.paused || this.allPaused) await sleepMs(150)
  }

  private async sleep(ms: number): Promise<void> {
    await sleepMs(Math.max(5, ms / this.speed))
  }

  private appendLog(rel: string, text: string): void {
    this.files.set(rel, (this.files.get(rel) ?? '') + text)
  }

  /** One LLM job: handover, state, streamed tokens, spend, log. */
  private async work(o: WorkOptions): Promise<void> {
    const agent = agentIdByRole(o.role)
    const a = this.agents.get(agent)!
    await this.gate(agent)
    const jobId = `j${String(++this.jobSeq).padStart(4, '0')}`
    const label = o.unit ? `${o.task} ${o.unit}` : o.task
    const model = a.resolvedModel ?? undefined
    const local = !!model && (model.startsWith('lmstudio/') || model.startsWith('strata/'))
    const started = Date.now()
    this.current.set(agent, { task: label, episode: o.episode, jobId })
    if (o.from) this.emit({ type: 'handover', from: o.from, to: agent, label, jobId })
    if (local) {
      this.setAgent(agent, { state: 'waiting-provider', task: 'loading model...', episode: o.episode, jobId })
      await this.sleep(500)
    }
    this.setAgent(agent, { state: 'working', task: label, episode: o.episode, jobId })
    this.emit({ type: 'job.started', jobId, agent, task: label, episode: o.episode, model })
    const iso = new Date().toISOString()
    this.appendLog(
      `logs/agents/${agent}.md`,
      `\n## ${iso} job \`${jobId}\`\n\n- requested by: ${o.from ?? 'engine'}\n- task: ${o.task} (role ${o.role}), episode ${o.episode}${o.unit ? `, unit ${o.unit}` : ''}, round 1\n- agent: ${agent}, first model: ${model}, prompt version a1b2c3d4, attempt 1\n### Context\n- persona (${180 + (this.jobSeq % 7) * 10} tokens)\n- brief.json (420 tokens)\n### Output\n`
    )
    const ticks = Math.max(1, Math.round(o.ms / this.speed / 50))
    const chunk = Math.ceil(o.text.length / ticks)
    for (let i = 0; i < o.text.length; i += chunk) {
      await this.gate(agent)
      const text = o.text.slice(i, i + chunk)
      this.emit({ type: 'job.token', jobId, agent, text })
      this.appendLog(`logs/agents/${agent}.md`, text)
      await sleepMs(50)
    }
    const tokensOut = Math.round(o.text.length / 3.6)
    const tokensIn = 900 + this.jobSeq * 11
    const costUsd = local ? 0 : Number(((tokensIn * 3 + tokensOut * 15) / 1_000_000).toFixed(4))
    const [provider, ...rest] = (model ?? 'lmstudio/x').split('/')
    this.spend = { ...this.spend, today: this.spend.today + costUsd, month: this.spend.month + costUsd }
    this.emit({ type: 'spend', provider: provider ?? '', model: rest.join('/'), tokensIn, tokensOut, costUsd, agent, episode: o.episode })
    const result = o.result ?? 'ok'
    this.appendLog(
      `logs/agents/${agent}.md`,
      `\n### Result\n${result.includes('/') ? `Written to ${result}. ` : ''}1 call(s), ${tokensIn} in (0 cached) / ${tokensOut} out tokens, ${costUsd.toFixed(6)} USD, ${((Date.now() - started) / 1000).toFixed(1)} s\n`
    )
    this.emit({ type: 'job.done', jobId, agent, ok: true, result })
    this.current.set(agent, null)
    this.setAgent(agent, { state: this.agents.get(agent)!.paused ? 'paused' : 'idle', task: undefined, episode: undefined, jobId: undefined })
  }

  /** A tool job: no model, progress events. `labels` are the units (shots) it works through. */
  private async tool(o: { role: string; task: string; episode: string; from?: string; labels: string[]; totalOf: (label: string) => number; ms: number; concurrent?: number; log?: string }): Promise<void> {
    const agent = agentIdByRole(o.role)
    await this.gate(agent)
    const jobId = `j${String(++this.jobSeq).padStart(4, '0')}`
    this.current.set(agent, { task: o.task, episode: o.episode, jobId })
    if (o.from) this.emit({ type: 'handover', from: o.from, to: agent, label: o.task, jobId })
    this.setAgent(agent, { state: 'working', task: o.task, episode: o.episode, jobId })
    this.emit({ type: 'job.started', jobId, agent, task: o.task, episode: o.episode })
    this.appendLog(`logs/agents/${agent}.md`, `\n## ${new Date().toISOString()} job \`${jobId}\`\n\n- requested by: ${o.from ?? 'engine'}\n- task: ${o.task} (role ${o.role}), episode ${o.episode}, round 1\n- agent: ${agent}, tool job, prompt version none, attempt 1\n### Output\n`)
    const steps = 8
    const perShot = o.ms / Math.max(1, o.labels.length)
    for (const label of o.labels) {
      const total = o.totalOf(label)
      this.setAgent(agent, { task: `${o.task} ${label}` })
      for (let s = 1; s <= steps; s++) {
        await this.gate(agent)
        await this.sleep(perShot / steps)
        const done = Math.round((total * s) / steps)
        this.emit({ type: 'render.progress', episode: o.episode, jobId, done, total, label })
        this.emit({ type: 'job.token', jobId, agent, text: `${label}: ${done}/${total}\n` })
      }
      this.appendLog(`logs/agents/${agent}.md`, `- progress ${total}/${total} ${label}\n`)
    }
    this.appendLog(`logs/agents/${agent}.md`, `\n### Result\n${o.log ?? 'done'}. 0 call(s), 0 in (0 cached) / 0 out tokens, 0.000000 USD, ${(o.ms / 1000 / this.speed).toFixed(1)} s\n`)
    this.emit({ type: 'job.done', jobId, agent, ok: true, result: o.log ?? 'done' })
    this.current.set(agent, null)
    this.setAgent(agent, { state: this.agents.get(agent)!.paused ? 'paused' : 'idle', task: undefined, episode: undefined, jobId: undefined })
  }

  // ---- episodes ----

  private patch(id: string, patch: Partial<EpisodeSummary>, assets?: Record<string, string>): void {
    const cur = this.episodes.get(id)!
    const next: EpisodeSummary = { ...cur, ...patch, assets: { ...cur.assets, ...assets }, updatedAt: new Date().toISOString() }
    this.episodes.set(id, next)
    this.emit({ type: 'episode.updated', episode: next })
  }

  private write(id: string, rel: string, value: unknown, kind?: string): void {
    const path = `episodes/${id}/${rel}`
    this.files.set(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    this.media.add(path)
    if (kind) this.emit({ type: 'asset.ready', episode: id, kind, path })
  }

  private pretty(v: unknown): string {
    return JSON.stringify(v, null, 2) + '\n'
  }

  private makeContent(p: Params): Content {
    const brief = makeBrief(p.theme, p.type, p.characters.length ? p.characters : ['tock', 'bobbin', 'granny_thimble', 'moo_moo'], p.lengthMin)
    const script = makeScript(brief)
    const shots = makeShots(script, p.lengthMin * 60, p.lengthMin >= 5 ? 18 : Math.max(6, p.lengthMin * 3))
    return { brief, script, shots }
  }

  private createEpisode(p: Params, title: string, id: string, stage: string, createdAt: string): void {
    const ep: EpisodeSummary = {
      id,
      title,
      theme: p.theme,
      type: p.type,
      stage,
      status: 'running',
      awaiting: null,
      lengthMin: p.lengthMin,
      shots: null,
      costUsd: 0,
      assets: {},
      createdAt,
      updatedAt: createdAt
    }
    this.episodes.set(id, ep)
    this.params.set(id, p)
    this.content.set(id, this.makeContent(p))
  }

  private seed(): void {
    // a finished episode and one waiting at the animatic checkpoint, so the UI has something to show at once
    const doneP: Params = { theme: 'a windy day', type: 'adventure', characters: ['tock', 'bobbin', 'granny_thimble', 'moo_moo'], lengthMin: 5, approvals: { script: true, animatic: true } }
    this.createEpisode(doneP, 'Tock and the Windy Day', 'tock-and-the-windy-day', 'done', new Date(Date.now() - 2 * 86_400_000).toISOString())
    this.writeThrough('tock-and-the-windy-day', 'done')
    this.patch('tock-and-the-windy-day', { status: 'done', stage: 'done', costUsd: 0.214, shots: this.content.get('tock-and-the-windy-day')!.shots.shots.length })
    const waitP: Params = { theme: 'a lost moon pie', type: 'mystery', characters: ['moo_moo', 'constable_buttons', 'squibble_a'], lengthMin: 5, approvals: { script: true, animatic: true } }
    this.createEpisode(waitP, "Moo Moo's Missing Moon Pie", 'moo-moos-missing-moon-pie', 'approve_animatic', new Date(Date.now() - 86_400_000).toISOString())
    this.writeThrough('moo-moos-missing-moon-pie', 'preview')
    this.patch('moo-moos-missing-moon-pie', { status: 'awaiting_approval', awaiting: 'animatic', costUsd: 0.131, shots: this.content.get('moo-moos-missing-moon-pie')!.shots.shots.length })
    setTimeout(() => void this.finishFrom('moo-moos-missing-moon-pie', 'approve_animatic'), 0)
  }

  /** Writes every file a finished stage leaves behind, up to `upTo`. */
  private writeThrough(id: string, upTo: 'preview' | 'done'): void {
    const c = this.content.get(id)!
    const quiet = (rel: string, v: unknown, key?: string) => {
      const path = `episodes/${id}/${rel}`
      this.files.set(path, typeof v === 'string' ? v : this.pretty(v))
      this.media.add(path)
      const ep = this.episodes.get(id)!
      if (key) this.episodes.set(id, { ...ep, assets: { ...ep.assets, [key]: path } })
    }
    quiet('brief.json', c.brief, 'brief')
    quiet('script.json', c.script, 'script')
    quiet('shots.json', c.shots, 'shots')
    for (const [i] of c.shots.shots.entries()) quiet(`preview/thumbs/shot-${String(i + 1).padStart(2, '0')}.png`, '')
    quiet('preview/animatic.mp4', '', 'animatic')
    if (upTo === 'done') quiet('out/episode.mp4', '', 'final')
  }

  private newEpisode(c: NewEpisodeCommand): void {
    const p: Params = { theme: c.theme, type: c.episodeType, characters: c.characters, lengthMin: c.lengthMin, approvals: c.approvals }
    const content = this.makeContent(p)
    let id = slugify(content.brief.title)
    while (this.episodes.has(id)) id += '-2'
    this.createEpisode(p, content.brief.title, id, 'brief', new Date().toISOString())
    this.content.set(id, content)
    this.episodes.get(id)!.title = c.theme.trim() ? content.brief.title : 'New episode'
    this.emit({ type: 'episode.updated', episode: this.episodes.get(id)! })
    void this.run(id)
  }

  private async run(id: string): Promise<void> {
    try {
      await this.finishFrom(id, 'brief')
    } catch (err) {
      this.patch(id, { status: 'failed' })
      this.emit({ type: 'engine.warning', message: `demo run failed: ${String(err)}` })
    }
  }

  private async checkpoint(id: string, cp: Checkpoint): Promise<{ ok: true } | { ok: false; note: string }> {
    this.patch(id, { status: 'awaiting_approval', awaiting: cp })
    const r = await new Promise<{ ok: true } | { ok: false; note: string }>((resolve) => this.waiters.set(`${id}:${cp}`, resolve))
    this.waiters.delete(`${id}:${cp}`)
    this.patch(id, { status: 'running', awaiting: null })
    return r
  }

  private async finishFrom(id: string, from: string): Promise<void> {
    const p = this.params.get(id)!
    const c = this.content.get(id)!
    const shots = c.shots.shots
    const frames = (shot: string) => Math.round((shots.find((s) => s.id === shot)?.duration ?? 12) * 12)
    const shotIds = shots.map((s) => s.id)
    const stages: { id: string; run: () => Promise<void> }[] = [
      {
        id: 'brief',
        run: async () => {
          await this.work({ role: 'producer', task: 'brief', episode: id, text: this.pretty(c.brief), ms: 3500, result: `episodes/${id}/brief.json` })
          this.write(id, 'brief.json', c.brief, 'brief')
          this.patch(id, { title: c.brief.title }, { brief: `episodes/${id}/brief.json` })
        }
      },
      {
        id: 'outline',
        run: () =>
          this.work({
            role: 'screenwriter',
            task: 'outline',
            episode: id,
            from: agentIdByRole('producer'),
            text: this.pretty({ title: c.brief.title, sections: c.script.scenes.map((s) => ({ id: s.id, setId: s.setId, summary: s.summary, beats: s.beats.map((b) => b.text) })) }),
            ms: 3000,
            result: `episodes/${id}/outline.json`
          })
      },
      {
        id: 'script',
        run: async () => {
          await this.work({ role: 'screenwriter', task: 'script', episode: id, text: this.pretty(c.script), ms: 6500, result: `episodes/${id}/script.json` })
          this.write(id, 'script.json', c.script, 'script')
          this.patch(id, {}, { script: `episodes/${id}/script.json` })
        }
      },
      {
        id: 'review',
        run: async () => {
          const review = { verdict: 'revise', source: 'editor', summary: 'Lovely and gentle. Make the hat chase clearer without words.', issues: [{ sceneId: 'sc3', problem: 'The chase is hard to follow.', fix: 'Add one action beat showing the hat direction.' }] }
          await this.work({ role: 'story_editor', task: 'review', episode: id, from: agentIdByRole('screenwriter'), text: this.pretty(review), ms: 3000, result: `episodes/${id}/reviews/review-1.json` })
          await this.work({ role: 'screenwriter', task: 'rewrite', episode: id, from: agentIdByRole('story_editor'), text: this.pretty(c.script.scenes[2]), ms: 3000, result: `episodes/${id}/script.json` })
          await this.work({ role: 'story_editor', task: 'review', episode: id, from: agentIdByRole('screenwriter'), text: this.pretty({ verdict: 'pass', source: 'editor', summary: 'Ready for the toybox.', issues: [] }), ms: 2000, result: `episodes/${id}/reviews/review-2.json` })
        }
      },
      {
        id: 'approve_script',
        run: async () => {
          if (!p.approvals.script) return
          for (;;) {
            const r = await this.checkpoint(id, 'script')
            if (r.ok) return
            this.patch(id, { stage: 'review' })
            await this.work({ role: 'screenwriter', task: 'rewrite', episode: id, from: 'you', text: `Change request from you: ${r.note}\n` + this.pretty(c.script.scenes[0]), ms: 3500, result: `episodes/${id}/script.json` })
            this.write(id, 'script.json', c.script, 'script')
            this.patch(id, { stage: 'approve_script' })
          }
        }
      },
      {
        id: 'design',
        run: async () => {
          const spec = (cid: string) => ({ id: cid, body: 'peg', material: 'wood', height: 1, hat: 'pompom' })
          await Promise.all([
            this.work({ role: 'character_designer', task: 'cast', episode: id, from: agentIdByRole('producer'), text: this.pretty(c.brief.cast.map(spec)), ms: 4000, result: `episodes/${id}/cast.json` }),
            this.work({ role: 'set_designer', task: 'sets', episode: id, from: agentIdByRole('producer'), text: this.pretty(c.brief.locations.map((l) => ({ id: l, ground: 'grass', props: [] }))), ms: 4000, result: `episodes/${id}/sets.json` })
          ])
        }
      },
      {
        id: 'shots',
        run: async () => {
          await this.work({ role: 'director', task: 'shots', episode: id, from: agentIdByRole('character_designer'), text: this.pretty(c.shots), ms: 6000, result: `episodes/${id}/shots.json` })
          this.write(id, 'shots.json', c.shots, 'shots')
          this.patch(id, { shots: shots.length }, { shots: `episodes/${id}/shots.json` })
        }
      },
      {
        id: 'animate',
        run: async () => {
          const animator = (async () => {
            for (const sh of shotIds) {
              const a = c.shots.shots.find((s) => s.id === sh)!
              await this.work({ role: 'animator', task: 'actions', unit: sh, episode: id, from: agentIdByRole('director'), text: this.pretty({ shotId: sh, actions: [{ t: 0, actor: a.cast[0] ?? 'tock', action: 'walk_to', target: 'center', dur: 3 }, { t: 3.2, actor: a.cast[0] ?? 'tock', action: 'wave', dur: 1 }] }), ms: 450, result: `episodes/${id}/actions/${sh}.json` })
            }
          })()
          await Promise.all([
            animator,
            this.work({ role: 'composer', task: 'music', episode: id, from: agentIdByRole('director'), text: this.pretty({ tempo: 104, key: 'C', theme: { instrument: 'music_box', melody: [{ p: 'C5', d: 0.5 }, { p: 'E5', d: 0.5 }, { p: 'G5', d: 1 }] } }), ms: 4500, result: `episodes/${id}/music.json` }),
            this.work({ role: 'sound_designer', task: 'sfx', episode: id, from: agentIdByRole('director'), text: this.pretty({ cues: [{ shotId: 'shot-01', t: 0.8, cue: 'birds', gain: 0.6 }, { shotId: 'shot-03', t: 0.2, cue: 'wind', gain: 0.8 }] }), ms: 4000, result: `episodes/${id}/sfx.json` })
          ])
        }
      },
      {
        id: 'qa',
        run: () => this.work({ role: 'qa', task: 'qa', episode: id, from: agentIdByRole('animator'), text: this.pretty({ ok: true, checked: ['cast on set', 'marks reachable', 'durations sum to target'], problems: [] }), ms: 2500, result: `episodes/${id}/qa.json` })
      },
      {
        id: 'assets',
        run: () => this.tool({ role: 'puppet_workshop', task: 'build_puppet', episode: id, from: agentIdByRole('qa'), labels: [...c.brief.cast, ...c.brief.locations], totalOf: () => 100, ms: 5000, log: `episodes/${id}/assets/` })
      },
      {
        id: 'voice',
        run: () => this.tool({ role: 'foley_booth', task: 'voice_lines', episode: id, from: agentIdByRole('puppet_workshop'), labels: ['lines'], totalOf: () => 12, ms: 2500, log: `episodes/${id}/audio/lines/` })
      },
      {
        id: 'compile',
        run: () => this.tool({ role: 'animation_compiler', task: 'compile_tracks', episode: id, from: agentIdByRole('foley_booth'), labels: ['tracks'], totalOf: () => shots.length, ms: 2500, log: `episodes/${id}/tracks/` })
      },
      {
        id: 'mix',
        run: () => this.tool({ role: 'foley_booth', task: 'mix_audio', episode: id, from: agentIdByRole('animation_compiler'), labels: ['mix'], totalOf: () => shots.length, ms: 2500, log: `episodes/${id}/audio/episode.wav` })
      },
      {
        id: 'preview',
        run: async () => {
          await this.tool({ role: 'preview_crew', task: 'preview_shot', episode: id, from: agentIdByRole('foley_booth'), labels: shotIds, totalOf: frames, ms: 6000, log: `episodes/${id}/preview/animatic.mp4` })
          for (const [i] of shots.entries()) this.write(id, `preview/thumbs/shot-${String(i + 1).padStart(2, '0')}.png`, '', 'thumb')
          this.write(id, 'preview/animatic.mp4', '', 'animatic')
          this.patch(id, {}, { animatic: `episodes/${id}/preview/animatic.mp4` })
        }
      },
      {
        id: 'approve_animatic',
        run: async () => {
          if (!p.approvals.animatic) return
          for (;;) {
            const r = await this.checkpoint(id, 'animatic')
            if (r.ok) return
            this.patch(id, { stage: 'shots' })
            await this.work({ role: 'director', task: 'shots', episode: id, from: 'you', text: `Change request from you: ${r.note}\n` + this.pretty(c.shots.shots.slice(0, 2)), ms: 3500, result: `episodes/${id}/shots.json` })
            this.patch(id, { stage: 'approve_animatic' })
          }
        }
      },
      {
        id: 'render',
        run: () => this.tool({ role: 'render_farm', task: 'render_shot', episode: id, from: agentIdByRole('preview_crew'), labels: shotIds, totalOf: frames, ms: 22000, log: `episodes/${id}/render/` })
      },
      {
        id: 'edit',
        run: async () => {
          await this.tool({ role: 'editor', task: 'edit_episode', episode: id, from: agentIdByRole('render_farm'), labels: ['title card', 'shots', 'end card'], totalOf: () => 100, ms: 4000, log: `episodes/${id}/out/episode.mp4` })
          this.write(id, 'out/episode.mp4', '', 'final')
        }
      }
    ]
    const start = Math.max(0, stages.findIndex((s) => s.id === from))
    for (const st of stages.slice(start)) {
      this.patch(id, { stage: st.id, status: 'running', awaiting: null })
      await st.run()
      const cost = this.episodes.get(id)!.costUsd
      this.patch(id, { costUsd: Number((cost + 0.012).toFixed(3)) })
    }
    this.patch(id, { stage: 'done', status: 'done' }, { final: `episodes/${id}/out/episode.mp4` })
  }
}

export function installFakeEngine(speed = 1): FakeEngine {
  const engine = new FakeEngine(speed)
  engine.install()
  return engine
}

export { AGENT_DEFS }
