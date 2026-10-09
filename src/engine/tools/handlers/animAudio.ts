import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'
import { parseMdWith } from '../../../shared/md'
import { castSchema, Music, Script, Sfx, setsSchema, ShotActions, Shots, Style } from '../../../shared/episode'
import type { MouthFile, PuppetSpec, SetLayout, Shot } from '../../../shared/episode'
import { compileShotDetailed } from '../../anim/compile'
import type { LineMeta } from '../../anim/compile'
import { SR } from '../../audio/dsp'
import { EPISODE_AUDIO_VERSION, mixEpisode, mixShot } from '../../audio/mix'
import type { MixEvent } from '../../audio/mix'
import { synthLine } from '../../audio/mumble'
import { renderMusic, renderTheme } from '../../audio/music'
import { hashSeed } from '../../audio/rng'
import { loadSfx } from '../../audio/sfx'
import { readWavFile, toMono44k, writeWavFile } from '../../audio/wav'
import type { HandlerResult, JobContext, Scheduler } from '../../queue/scheduler'
import { atomicWrite } from '../../store/atomic'
import type { ToolDeps } from './registry'

/** Bump when the voice synth changes so cached lines are voiced again. */
export const VOICE_VERSION = 1

const DEFAULT_VOICE = { pitch: 1, speed: 1, timbre: 'warm' as const }

const tick = () => new Promise<void>((r) => setImmediate(r))
const sha = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16)

function episodeOf(ctx: JobContext): string {
  const id = ctx.job.episode
  if (!id) throw new Error(`job ${ctx.job.id} has no episode`)
  return id
}

function checkAbort(ctx: JobContext): void {
  if (ctx.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
}

interface LineInfo {
  lineId: string
  character: string
  text: string
  emotion: string
}

function linesOf(script: Script): LineInfo[] {
  const out: LineInfo[] = []
  const seen = new Set<string>()
  for (const scene of script.scenes) {
    for (const b of scene.beats) {
      if (b.kind !== 'line' || !b.lineId || !b.character || seen.has(b.lineId)) continue
      seen.add(b.lineId)
      out.push({ lineId: b.lineId, character: b.character, text: b.text, emotion: b.emotion ?? 'neutral' })
    }
  }
  return out
}

async function loadOptional<S extends z.ZodType>(deps: ToolDeps, ep: string, rel: string, schema: S, ctx: JobContext): Promise<z.output<S> | null> {
  const raw = await deps.store.readJson(ep, ...rel.split('/'))
  if (raw === null) return null
  const r = schema.safeParse(raw)
  if (!r.success) {
    ctx.log(`${rel} is invalid and is ignored: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
    return null
  }
  return r.data
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

/** Voice booth: one wav and one mouth file per line of the script. Lines whose inputs did not change are kept. */
async function voiceLines(deps: ToolDeps, ctx: JobContext): Promise<HandlerResult> {
  const ep = episodeOf(ctx)
  const { store } = deps
  const script = await store.readValid(ep, 'script.json', Script)
  const cast = await store.readValid(ep, 'cast.json', castSchema)
  const sfx = await loadOptional(deps, ep, 'sfx.json', Sfx, ctx)
  const specs = new Map<string, PuppetSpec>(cast.map((c) => [c.id, c]))
  const lines = linesOf(script)
  let made = 0
  let kept = 0
  ctx.progress({ done: 0, total: lines.length, label: 'voices' })
  for (const [i, line] of lines.entries()) {
    checkAbort(ctx)
    const override = sfx?.voices[line.character]
    const voice = override ?? specs.get(line.character)?.voice ?? DEFAULT_VOICE
    if (!override && !specs.has(line.character)) ctx.log(`line ${line.lineId}: ${line.character} is not in the cast, using a default voice`)
    const hash = sha(JSON.stringify({ v: VOICE_VERSION, text: line.text, emotion: line.emotion, voice, id: line.lineId, who: line.character }))
    const wavRel = `audio/lines/${line.lineId}.wav`
    const jsonRel = `audio/lines/${line.lineId}.json`
    const hashRel = `audio/lines/${line.lineId}.hash`
    const cached =
      (await store.readText(ep, ...hashRel.split('/')))?.trim() === hash && (await store.exists(ep, ...wavRel.split('/'))) && (await store.exists(ep, ...jsonRel.split('/')))
    if (cached) {
      kept++
    } else {
      const r = synthLine(line.text, voice, line.emotion, hashSeed(line.lineId, line.character))
      await writeWavFile(store.file(ep, ...wavRel.split('/')), r.samples)
      const mouth: MouthFile = { lineId: line.lineId, duration: Math.round(r.duration * 1000) / 1000, fps: 12, levels: r.levels }
      await atomicWrite(store.file(ep, ...jsonRel.split('/')), JSON.stringify(mouth) + '\n')
      await atomicWrite(store.file(ep, ...hashRel.split('/')), hash + '\n')
      made++
      await tick()
    }
    ctx.progress({ done: i + 1, total: lines.length, label: line.lineId })
  }
  return { result: `${lines.length} line(s): ${made} voiced, ${kept} unchanged`, resultPath: store.rel(ep, 'audio', 'lines') }
}

/** Animation compiler: every shot's actions become `tracks/<shot>.json`. */
async function compileTracks(deps: ToolDeps, ctx: JobContext): Promise<HandlerResult> {
  const ep = episodeOf(ctx)
  const { store } = deps
  const shots = (await store.readValid(ep, 'shots.json', Shots)).shots
  const cast = await store.readValid(ep, 'cast.json', castSchema)
  const sets = await store.readValid(ep, 'sets.json', setsSchema)
  const style = await loadStyle(deps, ep)
  const script = await loadOptional(deps, ep, 'script.json', Script, ctx)
  const sfx = await loadOptional(deps, ep, 'sfx.json', Sfx, ctx)
  const emotions = new Map<string, string>(script ? linesOf(script).map((l) => [l.lineId, l.emotion]) : [])
  const setById = new Map<string, SetLayout>(sets.map((s) => [s.id, s]))
  let warnings = 0
  ctx.progress({ done: 0, total: shots.length, label: 'tracks' })
  for (const [i, shot] of shots.entries()) {
    checkAbort(ctx)
    const set = setById.get(shot.setId)
    if (!set) throw new Error(`${shot.id}: set ${shot.setId} is not in sets.json`)
    const actionsFile = `actions/${shot.id}.json`
    const raw = await store.readJson(ep, 'actions', `${shot.id}.json`)
    if (raw === null) throw new Error(`${actionsFile} is missing in episode ${ep}`)
    const parsed = ShotActions.safeParse(raw)
    if (!parsed.success) throw new Error(`${actionsFile} is invalid: ${parsed.error.issues.slice(0, 3).map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`)
    const lineMeta: Record<string, LineMeta> = {}
    const wanted = new Set<string>([...shot.lines, ...parsed.data.actions.flatMap((a) => (a.lineId ? [a.lineId] : []))])
    for (const id of wanted) {
      const m = (await store.readJson(ep, 'audio', 'lines', `${id}.json`)) as Partial<MouthFile> | null
      if (m && typeof m.duration === 'number' && Array.isArray(m.levels)) {
        lineMeta[id] = { duration: m.duration, levels: m.levels as number[], emotion: emotions.get(id) }
      }
    }
    const { tracks, warnings: w } = compileShotDetailed({
      shot,
      actions: parsed.data,
      cast,
      set,
      lineMeta,
      style,
      seed: hashSeed(ep, shot.id) & 0x7fffffff,
      sfxCues: sfx?.cues
    })
    for (const m of w) ctx.log(m)
    warnings += w.length
    // compact: tracks hold tens of thousands of numbers
    await atomicWrite(store.file(ep, 'tracks', `${shot.id}.json`), JSON.stringify(tracks) + '\n')
    ctx.progress({ done: i + 1, total: shots.length, label: shot.id })
    await tick()
  }
  return { result: `${shots.length} shot(s) compiled${warnings ? `, ${warnings} warning(s) in the log` : ''}`, resultPath: store.rel(ep, 'tracks') }
}

interface TrackLike {
  frames: number
  fps: number
  events: MixEvent[]
}

/** Foley booth: per shot mix (`audio/shot-NN.wav`) and the episode mix (`audio/episode.wav`). */
async function mixAudio(deps: ToolDeps, ctx: JobContext): Promise<HandlerResult> {
  const ep = episodeOf(ctx)
  const { store } = deps
  const shots: Shot[] = (await store.readValid(ep, 'shots.json', Shots)).shots
  const music = await loadOptional(deps, ep, 'music.json', Music, ctx)
  const tracks = new Map<string, TrackLike>()
  for (const s of shots) {
    const t = (await store.readJson(ep, 'tracks', `${s.id}.json`)) as TrackLike | null
    if (!t || !Array.isArray(t.events) || !t.frames || !t.fps) throw new Error(`tracks/${s.id}.json is missing or invalid: compile the tracks first`)
    tracks.set(s.id, t)
  }
  const total = shots.length + 1
  ctx.progress({ done: 0, total, label: 'music' })
  const spans = shots.map((s) => ({ id: s.id, duration: tracks.get(s.id)!.frames / tracks.get(s.id)!.fps }))
  const musicBy = music ? renderMusic(music, spans) : {}
  const sfxCache: Record<string, Float32Array> = {}
  const lineCache: Record<string, Float32Array> = {}
  const wavs: { id: string; wav: Float32Array; transitionIn?: string; transitionOut?: string }[] = []
  for (const [i, s] of shots.entries()) {
    checkAbort(ctx)
    const t = tracks.get(s.id)!
    for (const ev of t.events) {
      if (ev.kind === 'sfx' && ev.cue && !sfxCache[ev.cue]) sfxCache[ev.cue] = await loadSfx(ev.cue, deps.dataDir)
      if (ev.kind === 'line' && ev.lineId && !lineCache[ev.lineId]) {
        try {
          lineCache[ev.lineId] = toMono44k(await readWavFile(store.file(ep, 'audio', 'lines', `${ev.lineId}.wav`)))
        } catch {
          ctx.log(`${s.id}: voice file for line ${ev.lineId} is missing, the shot is mixed without it`)
        }
      }
    }
    const wav = mixShot({ frames: t.frames, fps: t.fps, events: t.events, lines: lineCache, sfx: sfxCache, music: musicBy[s.id] })
    await writeWavFile(store.file(ep, 'audio', `${s.id}.wav`), wav)
    wavs.push({ id: s.id, wav, transitionIn: s.transitionIn, transitionOut: s.transitionOut })
    ctx.progress({ done: i + 1, total, label: s.id })
    await tick()
  }
  checkAbort(ctx)
  const jingle = renderTheme(music ?? undefined)
  const mix = mixEpisode({ shots: wavs, title: jingle, end: jingle })
  await writeWavFile(store.file(ep, 'audio', 'episode.wav'), mix.samples)
  const info = {
    version: EPISODE_AUDIO_VERSION,
    sampleRate: SR,
    duration: mix.duration,
    titleSec: mix.titleSec,
    endStart: mix.endStart,
    endSec: mix.endSec,
    shots: Object.fromEntries(wavs.map((w) => [w.id, { start: mix.shotStarts[w.id], duration: w.wav.length / SR }]))
  }
  await atomicWrite(store.file(ep, 'audio', 'episode.json'), JSON.stringify(info, null, 2) + '\n')
  ctx.progress({ done: total, total, label: 'episode' })
  return { result: `${shots.length} shot mix(es) and episode.wav (${mix.duration.toFixed(1)} s)`, resultPath: store.rel(ep, 'audio', 'episode.wav') }
}

/** Registers `voice_lines`, `compile_tracks` and `mix_audio`. */
export function registerAnimAudioTools(scheduler: Scheduler, deps: ToolDeps): void {
  scheduler.register('voice_lines', (ctx) => voiceLines(deps, ctx), { tool: true })
  scheduler.register('compile_tracks', (ctx) => compileTracks(deps, ctx), { tool: true })
  scheduler.register('mix_audio', (ctx) => mixAudio(deps, ctx), { tool: true })
}
