import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Shots } from '../../../shared/episode'
import type { Shot } from '../../../shared/episode'
import type { Scheduler } from '../../queue/scheduler'
import { commitFile, exists, requireTool, runChecked } from './media'
import type { ToolDeps } from './registry'

/**
 * The editor crew: render frames + audio -> out/episode.mp4 with ffmpeg.
 *
 * Timeline (must match `audio/episode.wav` from the mixer): title card (TITLE_SECONDS), every shot back to back
 * (frames / 12 s each; transitions happen INSIDE a shot's own duration, so they never move the audio), end card (END_SECONDS).
 */

/** Fallback length of the title card. The real one is `titleSec` in audio/episode.json (written by mix_audio). */
export const TITLE_SECONDS = 5
/** Fallback length of the end card (`endSec` in audio/episode.json). */
export const END_SECONDS = 5
export const OUT_WIDTH = 1280
export const OUT_HEIGHT = 720
/** Unique animation frames per second in the render folder. */
export const ANIM_FPS = 12
/** Output frame rate: every drawn frame is held for two frames ("on twos"). */
export const OUT_FPS = 24
export const IRIS_SECONDS = 0.8
export const FADE_SECONDS = 0.6

/** xfade expressions of a crisp circular wipe. P = progress, which xfade counts DOWN from 1 to 0, A = first input, B = second input. R = distance centre to corner. */
const IRIS_RADIUS = 'hypot(W/2,H/2)'
/** The second clip shows through a circle that grows from the centre. */
export const IRIS_OPEN = `if(lt(hypot(X-W/2,Y-H/2),(1-P)*${IRIS_RADIUS}),B,A)`
/** The first clip stays inside a circle that shrinks to the centre; black closes in from the edges. */
export const IRIS_CLOSE = `if(gt(hypot(X-W/2,Y-H/2),P*${IRIS_RADIUS}),B,A)`

/** Sane size for a 5 minute 720p film: about 60 to 120 MB (CRF 25 keeps a little grain; 23 gave 184 MB, 24 gave 117 MB, 26 smooths it away) (CRF 19 on top of film grain gave 658 MB). */
export const X264 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
const COMMON = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y']

// ---------------------------------------------------------------- pure argument builders

export type TransitionIn = Shot['transitionIn']
export type TransitionOut = Shot['transitionOut']

/** Escapes a file path for use inside a single-quoted ffmpeg filter option (Windows drive colons included). */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

/** First existing font from the usual places, or null. A playful one is preferred. */
export function pickFont(candidates: string[] = DEFAULT_FONTS, has: (p: string) => boolean = existsSync): string | null {
  return candidates.find((f) => has(f)) ?? null
}
const DEFAULT_FONTS = [
  'C:/Windows/Fonts/comic.ttf',
  'C:/Windows/Fonts/segoepr.ttf',
  'C:/Windows/Fonts/georgia.ttf',
  'C:/Windows/Fonts/arial.ttf',
  '/System/Library/Fonts/Supplemental/Comic Sans MS.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
]

/** Wraps a title into lines of at most `max` characters (words are not split). */
export function wrapTitle(title: string, max = 22): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > max) {
      lines.push(cur)
      cur = w
    } else cur = cur ? cur + ' ' + w : w
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

export interface CardOptions {
  /** `title` (cardboard, painted frame) or `end` (felt green). */
  kind: 'title' | 'end'
  /** Path of a UTF-8 text file with the card text (newlines allowed). Null draws no text. */
  textFile: string | null
  fontFile: string | null
  seconds: number
  width: number
  height: number
  out: string
}

/**
 * ffmpeg arguments for a title or end card: a cardboard / felt coloured background with grain that "boils" at 12 fps
 * (so it matches the stop-motion look), a painted double frame, the text with a drop shadow, a fade in and out. Video only.
 */
export function cardClipArgs(o: CardOptions): string[] {
  const { width: w, height: h } = o
  const k = w / 1280
  const bg = o.kind === 'title' ? '#d6a96b' : '#6f9a5a'
  const frameOuter = o.kind === 'title' ? '#7a4a2a' : '#3f5f35'
  const frameInner = o.kind === 'title' ? '#f4e2b8' : '#d7e8c0'
  const ink = o.kind === 'title' ? '#8b2a1c' : '#fff3c9'
  const e = (n: number) => Math.max(1, Math.round(n * k))
  const m1 = e(34)
  const m2 = e(52)
  const chain: string[] = [
    'noise=alls=14:allf=t',
    `drawbox=x=${m1}:y=${m1}:w=${w - 2 * m1}:h=${h - 2 * m1}:color=${frameOuter}:t=${e(10)}`,
    `drawbox=x=${m2}:y=${m2}:w=${w - 2 * m2}:h=${h - 2 * m2}:color=${frameInner}:t=${e(4)}`
  ]
  if (o.textFile && o.fontFile) {
    const size = o.kind === 'title' ? e(84) : e(110)
    chain.push(
      `drawtext=fontfile='${escapeFilterPath(o.fontFile)}':textfile='${escapeFilterPath(o.textFile)}':fontsize=${size}:fontcolor=${ink}` +
        `:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=${e(14)}:shadowcolor=0x00000066:shadowx=${e(4)}:shadowy=${e(4)}`
    )
  }
  const fade = Math.min(0.6, o.seconds / 4)
  chain.push(`fps=${OUT_FPS}`, `fade=t=in:st=0:d=${fade}`, `fade=t=out:st=${fmt(o.seconds - fade)}:d=${fade}`, 'format=yuv420p', 'setsar=1')
  return [
    ...COMMON,
    '-f',
    'lavfi',
    '-i',
    `color=c=${bg}:s=${w}x${h}:r=${ANIM_FPS}:d=${fmt(o.seconds)}`,
    '-vf',
    chain.join(','),
    '-an',
    ...X264,
    '-r',
    String(OUT_FPS),
    o.out
  ]
}

export interface ShotClipOptions {
  /** Printf style pattern of the frames, for example `.../render/shot-01/f_%04d.png`. */
  pattern: string
  frameCount: number
  transitionIn: TransitionIn
  transitionOut: TransitionOut
  width: number
  height: number
  out: string
  animFps?: number
  outFps?: number
}

/** Seconds of a shot clip. */
export function shotSeconds(frameCount: number, animFps = ANIM_FPS): number {
  return frameCount / animFps
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

/**
 * ffmpeg arguments that turn one shot's PNG frames into a clip: 12 fps frames each held for two output frames, scaled to the
 * output size, with the shot's transitions inside its own length (iris = circular wipe from or to black, fade = fade
 * from or to black, cut = nothing). The clip is exactly `frameCount / 12` seconds long, so the audio stays in sync.
 */
export function shotClipArgs(o: ShotClipOptions): string[] {
  const animFps = o.animFps ?? ANIM_FPS
  const outFps = o.outFps ?? OUT_FPS
  const len = shotSeconds(o.frameCount, animFps)
  const irisD = Math.min(IRIS_SECONDS, len / 2)
  const fadeD = Math.min(FADE_SECONDS, len / 2)
  const args = [...COMMON, '-framerate', String(animFps), '-start_number', '0', '-i', o.pattern]
  const base = `[0:v]scale=${o.width}:${o.height}:flags=lanczos,setsar=1,fps=${outFps},format=yuv420p`
  const stages: string[] = []
  let cur = 'v0'
  let n = 0
  const next = () => `v${++n}`
  let blacks = 0
  /** Adds a black clip input and returns its input index (0 is the frames). */
  const addBlack = (d: number): number => {
    args.push('-f', 'lavfi', '-i', `color=c=black:s=${o.width}x${o.height}:r=${outFps}:d=${fmt(d)}`)
    return ++blacks
  }
  // iris first: it needs the black clips as extra inputs
  const fades: string[] = []
  if (o.transitionIn === 'fade') fades.push(`fade=t=in:st=0:d=${fmt(fadeD)}`)
  if (o.transitionOut === 'fade') fades.push(`fade=t=out:st=${fmt(len - fadeD)}:d=${fmt(fadeD)}`)
  stages.push(`${base}${fades.length ? ',' + fades.join(',') : ''}[${cur}]`)
  if (o.transitionIn === 'iris_in') {
    const b = addBlack(irisD)
    const nx = next()
    stages.push(`[${b}:v]format=yuv420p,setsar=1[bk${b}]`, `[bk${b}][${cur}]xfade=transition=custom:expr='${IRIS_OPEN}':duration=${fmt(irisD)}:offset=0[${nx}]`)
    cur = nx
  }
  if (o.transitionOut === 'iris_out') {
    const b = addBlack(irisD)
    const nx = next()
    stages.push(`[${b}:v]format=yuv420p,setsar=1[bk${b}]`, `[${cur}][bk${b}]xfade=transition=custom:expr='${IRIS_CLOSE}':duration=${fmt(irisD)}:offset=${fmt(len - irisD)}[${nx}]`)
    cur = nx
  }
  args.push('-filter_complex', stages.join(';'), '-map', `[${cur}]`, '-frames:v', String(Math.round(len * outFps)), '-an', ...X264, '-r', String(outFps), o.out)
  return args
}

/** Text of an ffmpeg concat-demuxer list file. */
export function concatListText(files: string[]): string {
  return files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n'
}

export interface FinalMuxOptions {
  listFile: string
  /** `audio/episode.wav`. Null makes a silent film. */
  audio: string | null
  out: string
}

/** Joins the clips (stream copy, they share encoder settings) and muxes the episode audio as AAC. */
export function finalMuxArgs(o: FinalMuxOptions): string[] {
  const args = [...COMMON, '-f', 'concat', '-safe', '0', '-i', o.listFile]
  if (o.audio) args.push('-i', o.audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-af', 'apad', '-shortest')
  else args.push('-map', '0:v:0', '-c:v', 'copy')
  args.push('-movflags', '+faststart', '-f', 'mp4', o.out)
  return args
}

/** Frame file pattern of a shot render folder. */
export function framePattern(renderDir: string): string {
  return path.join(renderDir, 'f_%04d.png')
}

/** Number of contiguous frames `f_0000.png ...` in a list of file names (stops at the first gap). */
export function contiguousFrames(names: string[]): number {
  const have = new Set(names)
  let n = 0
  while (have.has(`f_${String(n).padStart(4, '0')}.png`)) n++
  return n
}

// ---------------------------------------------------------------- the tool job

/** Card lengths from `audio/episode.json`, so the picture lines up with the mixed audio. Falls back to the constants. */
export async function readCardSeconds(deps: Pick<ToolDeps, 'store'>, episode: string): Promise<{ title: number; end: number }> {
  const j = (await deps.store.readJson(episode, 'audio', 'episode.json')) as { titleSec?: unknown; endSec?: unknown } | null
  const ok = (v: unknown, d: number) => (typeof v === 'number' && v > 0 && v < 60 ? v : d)
  return { title: ok(j?.titleSec, TITLE_SECONDS), end: ok(j?.endSec, END_SECONDS) }
}

async function titleOf(deps: ToolDeps, episode: string): Promise<string> {
  for (const f of ['script.json', 'brief.json']) {
    const j = (await deps.store.readJson(episode, f)) as { title?: unknown } | null
    if (j && typeof j.title === 'string' && j.title.trim()) return j.title.trim()
  }
  return episode.replace(/-+/g, ' ')
}

export function registerEditTools(scheduler: Scheduler, deps: ToolDeps): void {
  scheduler.register(
    'edit_episode',
    async (ctx) => {
      const episode = ctx.job.episode
      if (!episode) throw new Error('edit_episode needs an episode')
      const ffmpeg = await requireTool(deps, 'ffmpeg')
      const { shots } = await deps.store.readValid(episode, 'shots.json', Shots)
      const file = (...p: string[]) => deps.store.file(episode, ...p)
      const outDir = file('out')
      const tmp = path.join(outDir, '.edit-tmp')
      await fs.rm(tmp, { recursive: true, force: true })
      await fs.mkdir(tmp, { recursive: true })
      try {
        const counts: number[] = []
        for (const s of shots) {
          const names = await deps.store.list(episode, 'render', s.id)
          const n = contiguousFrames(names)
          if (n === 0) throw new Error(`no rendered frames for ${s.id} (render/${s.id}/f_0000.png is missing)`)
          counts.push(n)
        }
        const total = shots.length + 2
        let done = 0
        const step = (label: string) => ctx.progress({ done: ++done, total, label })
        const fontFile = pickFont()
        if (!fontFile) ctx.log('no font found: the cards are made without text')
        const title = await titleOf(deps, episode)
        const cards = await readCardSeconds(deps, episode)
        const clips: string[] = []

        const titleTxt = path.join(tmp, 'title.txt')
        const endTxt = path.join(tmp, 'end.txt')
        await fs.writeFile(titleTxt, wrapTitle(title).join('\n'), 'utf8')
        await fs.writeFile(endTxt, 'The End', 'utf8')

        const titleClip = path.join(tmp, '000-title.mp4')
        await runChecked('ffmpeg title card', ffmpeg, cardClipArgs({ kind: 'title', textFile: titleTxt, fontFile, seconds: cards.title, width: OUT_WIDTH, height: OUT_HEIGHT, out: titleClip }), { signal: ctx.signal, timeoutMs: 120_000 })
        clips.push(titleClip)
        step('title card')

        for (const [i, s] of shots.entries()) {
          const out = path.join(tmp, `${String(i + 1).padStart(3, '0')}-${s.id}.mp4`)
          const args = shotClipArgs({
            pattern: framePattern(file('render', s.id)),
            frameCount: counts[i] ?? 0,
            transitionIn: s.transitionIn,
            transitionOut: s.transitionOut,
            width: OUT_WIDTH,
            height: OUT_HEIGHT,
            out
          })
          await runChecked(`ffmpeg ${s.id}`, ffmpeg, args, { signal: ctx.signal, timeoutMs: 15 * 60_000 })
          clips.push(out)
          step(s.id)
        }

        const endClip = path.join(tmp, '999-end.mp4')
        await runChecked('ffmpeg end card', ffmpeg, cardClipArgs({ kind: 'end', textFile: endTxt, fontFile, seconds: cards.end, width: OUT_WIDTH, height: OUT_HEIGHT, out: endClip }), { signal: ctx.signal, timeoutMs: 120_000 })
        clips.push(endClip)
        step('end card')

        const list = path.join(tmp, 'list.txt')
        await fs.writeFile(list, concatListText(clips), 'utf8')
        const wav = file('audio', 'episode.wav')
        const hasAudio = await exists(wav)
        if (!hasAudio) ctx.log('audio/episode.wav is missing: the film is silent')
        const part = path.join(outDir, 'episode.part.mp4')
        await runChecked('ffmpeg final mux', ffmpeg, finalMuxArgs({ listFile: list, audio: hasAudio ? wav : null, out: part }), { signal: ctx.signal, timeoutMs: 15 * 60_000 })
        await commitFile(part, path.join(outDir, 'episode.mp4'))
        ctx.progress({ done: total, total, label: 'episode.mp4' })
        return { result: `Edited ${shots.length} shots into out/episode.mp4`, resultPath: deps.store.rel(episode, 'out', 'episode.mp4') }
      } finally {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
      }
    },
    { tool: true }
  )
}
