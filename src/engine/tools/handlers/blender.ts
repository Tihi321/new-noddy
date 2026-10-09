import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseMdWith } from '../../../shared/md'
import { castSchema, setsSchema, Style } from '../../../shared/episode'
import type { PuppetSpec, SetLayout } from '../../../shared/episode'
import type { JobContext, Scheduler } from '../../queue/scheduler'
import { detectTool } from '../detect'
import { runProcess } from '../exec'
import type { ToolDeps } from './registry'

/**
 * The puppet workshop and render farm: every job runs `blender -b --factory-startup --python blender/run.py -- job.json`
 * (docs/contracts.md, "Blender jobs") and reads the `@@PROGRESS / @@DONE / @@ERROR` lines from stdout.
 */

/** Bump when the toykit changes the look of puppets or sets, so cached assets are built again. */
export const TOYKIT_VERSION = 1

const sha8 = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 8)

/** JSON with sorted keys, so the same data always hashes the same. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/** Eight hex characters over the spec (or layout) and the style. */
export function assetHash(specOrLayout: PuppetSpec | SetLayout, style: Style): string {
  return sha8(stableJson({ v: TOYKIT_VERSION, item: specOrLayout, style }))
}

export interface AssetPaths {
  blend: string
  glb: string
}

export function assetPaths(episodeDir: string, kind: 'puppets' | 'sets', id: string, hash: string): AssetPaths {
  const base = path.join(episodeDir, 'assets', kind, `${id}-${hash}`)
  return { blend: `${base}.blend`, glb: `${base}.glb` }
}

export function puppetJob(spec: PuppetSpec, style: Style, p: AssetPaths): object {
  return { kind: 'build_puppet', spec, style, out_blend: p.blend, out_glb: p.glb }
}

export function setJob(layout: SetLayout, style: Style, p: AssetPaths): object {
  return { kind: 'build_set', layout, style, out_blend: p.blend, out_glb: p.glb }
}

export interface RenderJobInputs {
  tracks: string
  puppets: Record<string, string>
  set: string
  style: Style
  preset: 'preview' | 'final'
  outDir: string
  frames?: number[] | null
  resume?: boolean
}

export function renderJob(i: RenderJobInputs): object {
  return {
    kind: 'render_shot',
    tracks: i.tracks,
    puppets: i.puppets,
    set: i.set,
    style: i.style,
    preset: i.preset,
    out_dir: i.outDir,
    frames: i.frames ?? null,
    resume: i.resume ?? true
  }
}

export type BlenderLine =
  | { kind: 'progress'; done: number; total: number; label: string }
  | { kind: 'done'; outputs: string[] }
  | { kind: 'error'; message: string }

/** Parses one stdout line of the toykit protocol; null for any other (Blender's own) output. */
export function parseBlenderLine(line: string): BlenderLine | null {
  const m = /^@@(PROGRESS|DONE|ERROR) (.*)$/.exec(line.trim())
  if (!m) return null
  let j: Record<string, unknown>
  try {
    j = JSON.parse(m[2] ?? '') as Record<string, unknown>
  } catch {
    return null
  }
  if (m[1] === 'PROGRESS') return { kind: 'progress', done: Number(j.done) || 0, total: Number(j.total) || 0, label: String(j.label ?? '') }
  if (m[1] === 'DONE') return { kind: 'done', outputs: Array.isArray(j.outputs) ? j.outputs.map(String) : [] }
  return { kind: 'error', message: String(j.message ?? 'unknown error') }
}

export function blenderArgs(runPy: string, jobFile: string): string[] {
  return ['-b', '--factory-startup', '--python', runPy, '--', jobFile]
}

/** `blender/run.py`: TOYBOX_BLENDER_DIR, else walk up from this file. */
export function findRunPy(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TOYBOX_BLENDER_DIR) return path.join(path.resolve(env.TOYBOX_BLENDER_DIR), 'run.py')
  let dir = __dirname
  for (let i = 0; i < 7; i++) {
    const c = path.join(dir, 'blender', 'run.py')
    if (existsSync(c)) return c
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.resolve('blender', 'run.py')
}

async function requireBlender(deps: Pick<ToolDeps, 'toolsConfig'>): Promise<string> {
  const st = await detectTool('blender', deps.toolsConfig().blender ?? '')
  if (!st.found || !st.path) throw new Error(`blender was not found${st.note ? ` (${st.note})` : ''}. Install it or set its path in config/tools.md (run \`npm run doctor\`).`)
  return st.path
}

async function loadStyle(deps: ToolDeps, ep: string): Promise<Style> {
  const meta = await deps.store.readMeta(ep)
  const id = meta?.meta.style ?? 'toyland-wood'
  try {
    const text = await fs.readFile(path.join(deps.dataDir, 'styles', `${id}.md`), 'utf8')
    return parseMdWith(text, Style, `styles/${id}.md`).data
  } catch {
    return Style.parse({ id })
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

interface RunOpts {
  deps: ToolDeps
  ctx: JobContext
  job: object
  timeoutMs: number
}

/** Writes the job file, runs Blender, forwards progress, and fails on `@@ERROR` or a non-zero exit. */
async function runBlender(o: RunOpts): Promise<string[]> {
  const exe = await requireBlender(o.deps)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'toybox-blender-'))
  const jobFile = path.join(dir, 'job.json')
  await fs.writeFile(jobFile, JSON.stringify(o.job))
  let outputs: string[] = []
  let error: string | null = null
  const timeout = AbortSignal.timeout(o.timeoutMs)
  try {
    const res = await runProcess(exe, blenderArgs(findRunPy(), jobFile), {
      signal: AbortSignal.any([o.ctx.signal, timeout]),
      onLine: (line) => {
        const p = parseBlenderLine(line)
        if (!p) return
        if (p.kind === 'progress') o.ctx.progress({ done: p.done, total: p.total, label: p.label })
        else if (p.kind === 'done') outputs = p.outputs
        else error = p.message
      }
    }).catch((err: unknown) => {
      if (!o.ctx.signal.aborted && timeout.aborted) throw new Error(`blender timed out after ${Math.round(o.timeoutMs / 1000)} s`, { cause: err })
      throw err
    })
    if (error) throw new Error(`blender: ${error}`)
    if (res.code !== 0) throw new Error(`blender failed (exit ${res.code}): ${res.stderrTail.split('\n').slice(-6).join(' | ').slice(0, 800)}`)
    return outputs
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function need(ctx: JobContext): { ep: string; unit: string } {
  const ep = ctx.job.episode
  const unit = ctx.job.unit
  if (!ep || !unit) throw new Error(`${ctx.job.task} needs an episode and a unit`)
  return { ep, unit }
}

/** Builds one asset unless a file with the same hash exists (then it is kept). */
async function buildAsset(deps: ToolDeps, ctx: JobContext, kind: 'puppets' | 'sets'): Promise<{ result: string; resultPath: string }> {
  const { ep, unit } = need(ctx)
  const style = await loadStyle(deps, ep)
  const episodeDir = deps.store.file(ep)
  let item: PuppetSpec | SetLayout | undefined
  if (kind === 'puppets') item = (await deps.store.readValid(ep, 'cast.json', castSchema)).find((c) => c.id === unit)
  else item = (await deps.store.readValid(ep, 'sets.json', setsSchema)).find((s) => s.id === unit)
  if (!item) throw new Error(`${unit} is not in ${kind === 'puppets' ? 'cast' : 'sets'}.json`)
  const paths = assetPaths(episodeDir, kind, unit, assetHash(item, style))
  const rel = deps.store.rel(ep, 'assets', kind)
  if ((await exists(paths.blend)) && (await exists(paths.glb))) {
    ctx.progress({ done: 1, total: 1, label: `${unit} (unchanged)` })
    return { result: `${unit}: already built`, resultPath: rel }
  }
  await fs.mkdir(path.dirname(paths.blend), { recursive: true })
  const tmp: AssetPaths = { blend: paths.blend.replace(/\.blend$/, '.part.blend'), glb: paths.glb.replace(/\.glb$/, '.part.glb') }
  const job = kind === 'puppets' ? puppetJob(item as PuppetSpec, style, tmp) : setJob(item as SetLayout, style, tmp)
  try {
    await runBlender({ deps, ctx, job, timeoutMs: 10 * 60_000 })
    await fs.rename(tmp.blend, paths.blend)
    await fs.rename(tmp.glb, paths.glb)
  } finally {
    await fs.rm(tmp.blend, { force: true }).catch(() => undefined)
    await fs.rm(tmp.glb, { force: true }).catch(() => undefined)
  }
  return { result: `${unit}: built ${path.basename(paths.blend)}`, resultPath: rel }
}

async function renderShot(deps: ToolDeps, ctx: JobContext): Promise<{ result: string; resultPath: string }> {
  const { ep, unit: shotId } = need(ctx)
  const style = await loadStyle(deps, ep)
  const episodeDir = deps.store.file(ep)
  const tracksPath = deps.store.file(ep, 'tracks', `${shotId}.json`)
  const tracks = (await deps.store.readJson(ep, 'tracks', `${shotId}.json`)) as { setId?: string; cast?: string[]; frames?: number } | null
  if (!tracks?.setId || !Array.isArray(tracks.cast)) throw new Error(`tracks/${shotId}.json is missing or invalid: compile the tracks first`)
  const cast = await deps.store.readValid(ep, 'cast.json', castSchema)
  const sets = await deps.store.readValid(ep, 'sets.json', setsSchema)
  const puppets: Record<string, string> = {}
  for (const id of tracks.cast) {
    const spec = cast.find((c) => c.id === id)
    if (!spec) throw new Error(`${shotId}: ${id} is not in cast.json`)
    const p = assetPaths(episodeDir, 'puppets', id, assetHash(spec, style))
    if (!(await exists(p.blend))) throw new Error(`no built puppet for ${id} (${path.basename(p.blend)}): build the assets first`)
    puppets[id] = p.blend
  }
  const layout = sets.find((s) => s.id === tracks.setId)
  if (!layout) throw new Error(`${shotId}: set ${tracks.setId} is not in sets.json`)
  const sp = assetPaths(episodeDir, 'sets', layout.id, assetHash(layout, style))
  if (!(await exists(sp.blend))) throw new Error(`no built set for ${layout.id} (${path.basename(sp.blend)}): build the assets first`)
  const outDir = deps.store.file(ep, 'render', shotId)
  await fs.mkdir(outDir, { recursive: true })
  const frames = tracks.frames ?? 0
  const job = renderJob({ tracks: tracksPath, puppets, set: sp.blend, style, preset: 'final', outDir, resume: true })
  // generous: about 2 s a frame on the iGPU plus start-up; resume makes a retry cheap
  await runBlender({ deps, ctx, job, timeoutMs: 120_000 + Math.max(frames, 1) * 20_000 })
  return { result: `${shotId}: ${frames} frame(s) rendered (final)`, resultPath: deps.store.rel(ep, 'render', shotId) }
}

/** Registers `build_puppet`, `build_set` and `render_shot`. */
export function registerBlenderTools(scheduler: Scheduler, deps: ToolDeps): void {
  scheduler.register('build_puppet', (ctx) => buildAsset(deps, ctx, 'puppets'), { tool: true })
  scheduler.register('build_set', (ctx) => buildAsset(deps, ctx, 'sets'), { tool: true })
  scheduler.register('render_shot', (ctx) => renderShot(deps, ctx), { tool: true })
}
