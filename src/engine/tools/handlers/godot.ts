import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Shots } from '../../../shared/episode'
import type { Scheduler } from '../../queue/scheduler'
import { detectTool } from '../detect'
import { ANIM_FPS, OUT_FPS, cardClipArgs, concatListText, pickFont, readCardSeconds, wrapTitle } from './edit'
import { commitFile, exists, findGodotProject, preferConsoleGodot, requireTool, runChecked } from './media'
import type { ToolDeps } from './registry'

/**
 * The preview crew: Godot Movie Maker plays the compiled tracks (docs/contracts.md, "Godot preview"), ffmpeg turns the
 * AVI into `preview/shot-NN.mp4` (24 fps, frames doubled, shot audio muxed), and `animatic` joins everything with the
 * episode audio (title card + shots + end card, the same timeline as `out/episode.mp4`).
 */

export const PREVIEW_WIDTH = 640
export const PREVIEW_HEIGHT = 360

const FF = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y']

// ---------------------------------------------------------------- pure argument builders

export interface GodotShotInputs {
  /** Folder of the Godot project (`godot/preview`). */
  projectDir: string
  tracks: string
  /** Optional: a shot without a set still plays (empty stage). */
  setGlb?: string
  /** Puppet id -> glb path. */
  puppets: Record<string, string>
}

function userArgs(i: GodotShotInputs): string[] {
  const a = ['--tracks', i.tracks]
  if (i.setGlb) a.push('--set', i.setGlb)
  for (const [id, p] of Object.entries(i.puppets)) a.push('--puppet', `${id}=${p}`)
  return a
}

/** Movie Maker run: exactly one track frame per rendered frame, quits after the last one. */
export function godotMovieArgs(i: GodotShotInputs & { out: string; fps?: number; width?: number; height?: number }): string[] {
  return [
    '--path',
    i.projectDir,
    '--write-movie',
    i.out,
    '--fixed-fps',
    String(i.fps ?? ANIM_FPS),
    '--resolution',
    `${i.width ?? PREVIEW_WIDTH}x${i.height ?? PREVIEW_HEIGHT}`,
    '--',
    ...userArgs(i)
  ]
}

/** Renders one frame to a PNG (default the middle frame) and quits. */
export function godotThumbArgs(i: GodotShotInputs & { out: string; frame?: number; width?: number; height?: number }): string[] {
  return [
    '--path',
    i.projectDir,
    '--resolution',
    `${i.width ?? PREVIEW_WIDTH}x${i.height ?? PREVIEW_HEIGHT}`,
    '--',
    ...userArgs(i),
    '--thumb',
    i.out,
    ...(i.frame !== undefined ? ['--frame', String(i.frame)] : [])
  ]
}

/** The interactive window: play/pause, scrub slider, frame counter. */
export function godotInteractiveArgs(i: GodotShotInputs): string[] {
  return ['--path', i.projectDir, '--resolution', '1280x720', '--', ...userArgs(i)]
}

export interface PreviewEncodeOptions {
  avi: string
  /** Track frames: the AVI may hold one more (Godot writes a trailing frame). */
  frames: number
  /** `audio/shot-NN.wav`. Null adds a silent track, so every preview clip has audio. */
  audio: string | null
  out: string
}

/** AVI (12 fps) -> mp4 at 24 fps (each frame twice) with the shot audio, cut to the exact shot length. */
export function previewEncodeArgs(o: PreviewEncodeOptions): string[] {
  const seconds = o.frames / ANIM_FPS
  const args = [...FF, '-i', o.avi]
  if (o.audio) args.push('-i', o.audio)
  else args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
  args.push(
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-frames:v',
    String(o.frames * (OUT_FPS / ANIM_FPS)),
    '-vf',
    `fps=${OUT_FPS},format=yuv420p`,
    '-af',
    `apad,atrim=0:${seconds}`,
    '-t',
    String(seconds),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '24',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    o.out
  )
  return args
}

/** One frame of a video as PNG (the thumbnail). */
export function thumbExtractArgs(o: { video: string; frame: number; out: string }): string[] {
  return [...FF, '-i', o.video, '-vf', `select=eq(n\\,${o.frame})`, '-frames:v', '1', '-update', '1', o.out]
}

/** Joins title card + preview clips + end card (listed in `listFile`) and puts the episode audio under it. */
export function animaticArgs(o: { listFile: string; audio: string | null; out: string }): string[] {
  const args = [...FF, '-f', 'concat', '-safe', '0', '-i', o.listFile]
  if (o.audio) args.push('-i', o.audio, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '160k', '-af', 'apad', '-shortest')
  else args.push('-map', '0:v:0')
  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', String(OUT_FPS), '-movflags', '+faststart', o.out)
  return args
}

// ---------------------------------------------------------------- inputs on disk

/** The newest `<id>-<hash8>.glb` in a folder (falls back to `<id>.glb`), or null. */
export async function findGlb(dir: string, id: string): Promise<string | null> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return null
  }
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${esc}-[0-9a-f]{8}\\.glb$`)
  const hits = names.filter((n) => re.test(n) || n === `${id}.glb`)
  if (hits.length === 0) return null
  const stats = await Promise.all(hits.map(async (n) => ({ n, t: (await fs.stat(path.join(dir, n))).mtimeMs })))
  stats.sort((a, b) => b.t - a.t || b.n.localeCompare(a.n))
  return path.join(dir, stats[0]!.n)
}

export interface ResolvedShot {
  tracks: string
  frames: number
  setGlb?: string
  puppets: Record<string, string>
}

/** Reads `tracks/<shotId>.json` of an episode folder and finds the glbs of its set and cast. Throws when a glb is missing. */
export async function resolveShot(episodeDir: string, shotId: string): Promise<ResolvedShot> {
  const tracks = path.join(episodeDir, 'tracks', `${shotId}.json`)
  let json: { frames?: number; setId?: string; cast?: string[] }
  try {
    json = JSON.parse(await fs.readFile(tracks, 'utf8'))
  } catch (err) {
    throw new Error(`tracks/${shotId}.json is missing or invalid: ${(err as Error).message}`, { cause: err })
  }
  const puppets: Record<string, string> = {}
  for (const id of json.cast ?? []) {
    const glb = await findGlb(path.join(episodeDir, 'assets', 'puppets'), id)
    if (!glb) throw new Error(`no glb for puppet "${id}" in assets/puppets (build the assets first)`)
    puppets[id] = glb
  }
  let setGlb: string | undefined
  if (json.setId) {
    setGlb = (await findGlb(path.join(episodeDir, 'assets', 'sets'), json.setId)) ?? undefined
    if (!setGlb) throw new Error(`no glb for set "${json.setId}" in assets/sets (build the assets first)`)
  }
  return { tracks, frames: Number(json.frames ?? 0), setGlb, puppets }
}

// ---------------------------------------------------------------- interactive window

/**
 * Opens the interactive scrub window for a shot (for the UI's "Open in Godot"). Resolves once Godot has started; the
 * window lives on its own.
 */
export async function openGodotInteractive(episodeDir: string, shotId: string, opts: { godotPath?: string; projectDir?: string } = {}): Promise<void> {
  const exe = opts.godotPath ?? (await requireGodotPath())
  const r = await resolveShot(episodeDir, shotId)
  const args = godotInteractiveArgs({ projectDir: opts.projectDir ?? findGodotProject(), tracks: r.tracks, setGlb: r.setGlb, puppets: r.puppets })
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

async function requireGodotPath(): Promise<string> {
  const st = await detectTool('godot', '')
  if (!st.found || !st.path) throw new Error('godot was not found (see config/tools.md)')
  return preferConsoleGodot(st.path)
}

// ---------------------------------------------------------------- the tool jobs

// Godot runs one at a time: the GPU is shared and a first run writes the project's .godot cache.
let godotQueue: Promise<unknown> = Promise.resolve()
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = godotQueue.then(fn, fn)
  godotQueue = run.catch(() => undefined)
  return run
}

const shotFile = (id: string, ext: string) => `${id}.${ext}`

export function registerGodotTools(scheduler: Scheduler, deps: ToolDeps): void {
  scheduler.register(
    'preview_shot',
    async (ctx) => {
      const episode = ctx.job.episode
      const shotId = ctx.job.unit
      if (!episode || !shotId) throw new Error('preview_shot needs an episode and a shot id as its unit')
      const godot = await requireTool(deps, 'godot')
      const ffmpeg = await requireTool(deps, 'ffmpeg')
      const dir = deps.store.dir(episode)
      const r = await resolveShot(dir, shotId)
      const previewDir = path.join(dir, 'preview')
      await fs.mkdir(path.join(previewDir, 'thumbs'), { recursive: true })
      const avi = path.join(previewDir, `.${shotFile(shotId, 'avi')}`)
      const part = path.join(previewDir, `.${shotId}.part.mp4`)
      const thumbPart = path.join(previewDir, 'thumbs', `.${shotId}.part.png`)
      try {
        ctx.progress({ done: 0, total: 3, label: `${shotId}: Godot` })
        await exclusive(() =>
          runChecked(
            'godot movie',
            godot,
            godotMovieArgs({ projectDir: findGodotProject(), tracks: r.tracks, setGlb: r.setGlb, puppets: r.puppets, out: avi }),
            { signal: ctx.signal, timeoutMs: 120_000 + r.frames * 2000, onLine: (l) => /ERROR|SCRIPT/.test(l) && ctx.log(l) }
          )
        )
        const size = (await fs.stat(avi).catch(() => null))?.size ?? 0
        if (size < 1000) throw new Error('godot wrote no movie (see the job log)')
        ctx.progress({ done: 1, total: 3, label: `${shotId}: encode` })
        const wav = path.join(dir, 'audio', `${shotId}.wav`)
        const hasAudio = await exists(wav)
        if (!hasAudio) ctx.log(`audio/${shotId}.wav is missing: the preview clip is silent`)
        await runChecked('ffmpeg preview', ffmpeg, previewEncodeArgs({ avi, frames: r.frames, audio: hasAudio ? wav : null, out: part }), { signal: ctx.signal, timeoutMs: 300_000 })
        ctx.progress({ done: 2, total: 3, label: `${shotId}: thumbnail` })
        await runChecked('ffmpeg thumbnail', ffmpeg, thumbExtractArgs({ video: avi, frame: Math.floor(r.frames / 2), out: thumbPart }), { signal: ctx.signal, timeoutMs: 60_000 })
        await commitFile(thumbPart, path.join(previewDir, 'thumbs', `${shotId}.png`))
        await commitFile(part, path.join(previewDir, `${shotId}.mp4`))
        ctx.progress({ done: 3, total: 3, label: shotId })
        return { result: `Preview of ${shotId}: ${r.frames} frames`, resultPath: deps.store.rel(episode, 'preview', `${shotId}.mp4`) }
      } finally {
        await Promise.all([avi, part, thumbPart].map((f) => fs.rm(f, { force: true }).catch(() => undefined)))
      }
    },
    { tool: true }
  )

  scheduler.register(
    'animatic',
    async (ctx) => {
      const episode = ctx.job.episode
      if (!episode) throw new Error('animatic needs an episode')
      const ffmpeg = await requireTool(deps, 'ffmpeg')
      const dir = deps.store.dir(episode)
      const { shots } = await deps.store.readValid(episode, 'shots.json', Shots)
      const clips: string[] = []
      for (const s of shots) {
        const p = path.join(dir, 'preview', `${s.id}.mp4`)
        if (!(await exists(p))) throw new Error(`preview/${s.id}.mp4 is missing (run preview_shot first)`)
        clips.push(p)
      }
      const tmp = path.join(dir, 'preview', '.animatic-tmp')
      await fs.rm(tmp, { recursive: true, force: true })
      await fs.mkdir(tmp, { recursive: true })
      try {
        const total = 3
        ctx.progress({ done: 0, total, label: 'cards' })
        const cards = await readCardSeconds(deps, episode)
        const titleJson = (await deps.store.readJson(episode, 'script.json')) as { title?: string } | null
        const title = titleJson?.title?.trim() || episode.replace(/-+/g, ' ')
        const fontFile = pickFont()
        const titleTxt = path.join(tmp, 'title.txt')
        const endTxt = path.join(tmp, 'end.txt')
        await fs.writeFile(titleTxt, wrapTitle(title, 18).join('\n'), 'utf8')
        await fs.writeFile(endTxt, 'The End', 'utf8')
        const titleClip = path.join(tmp, 'title.mp4')
        const endClip = path.join(tmp, 'end.mp4')
        const card = (kind: 'title' | 'end', textFile: string, seconds: number, out: string) =>
          cardClipArgs({ kind, textFile, fontFile, seconds, width: 640, height: 360, out })
        await runChecked('ffmpeg title card', ffmpeg, card('title', titleTxt, cards.title, titleClip), { signal: ctx.signal, timeoutMs: 60_000 })
        await runChecked('ffmpeg end card', ffmpeg, card('end', endTxt, cards.end, endClip), { signal: ctx.signal, timeoutMs: 60_000 })
        ctx.progress({ done: 1, total, label: 'joining' })
        const list = path.join(tmp, 'list.txt')
        await fs.writeFile(list, concatListText([titleClip, ...clips, endClip]), 'utf8')
        const wav = path.join(dir, 'audio', 'episode.wav')
        const hasAudio = await exists(wav)
        if (!hasAudio) ctx.log('audio/episode.wav is missing: the animatic is silent')
        const part = path.join(dir, 'preview', '.animatic.part.mp4')
        await runChecked('ffmpeg animatic', ffmpeg, animaticArgs({ listFile: list, audio: hasAudio ? wav : null, out: part }), { signal: ctx.signal, timeoutMs: 600_000 })
        await commitFile(part, path.join(dir, 'preview', 'animatic.mp4'))
        ctx.progress({ done: total, total, label: 'animatic.mp4' })
        return { result: `Animatic of ${shots.length} shots`, resultPath: deps.store.rel(episode, 'preview', 'animatic.mp4') }
      } finally {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
      }
    },
    { tool: true }
  )
}
