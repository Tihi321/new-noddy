/**
 * Manual integration check of the Godot preview and ffmpeg editor tool modules (not part of `npm test`).
 *
 *   npx tsx scripts/preview-edit-smoke.ts <dataDir> <episodeSlug>
 *
 * The episode folder must hold shots.json, tracks/shot-NN.json and assets/{puppets,sets}/*.glb. The script then
 *   1. runs `preview_shot` for every shot and `animatic` (Godot + ffmpeg),
 *   2. fakes a Blender render folder from the preview clips (scaled to 1280x720, 12 fps PNGs) and fake audio (sine tones),
 *   3. runs `edit_episode` and prints timings.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Shots } from '../src/shared/episode'
import type { JobContext, JobHandler } from '../src/engine/queue/scheduler'
import type { Scheduler } from '../src/engine/queue/scheduler'
import { EpisodeStore } from '../src/engine/pipeline/episodeStore'
import { requireTool, runChecked } from '../src/engine/tools/handlers/media'
import { registerGodotTools } from '../src/engine/tools/handlers/godot'
import { END_SECONDS, TITLE_SECONDS, registerEditTools } from '../src/engine/tools/handlers/edit'
import type { ToolDeps } from '../src/engine/tools/handlers/registry'

async function main() {
  const [dataDir, episode] = process.argv.slice(2)
  if (!dataDir || !episode) throw new Error('usage: tsx scripts/preview-edit-smoke.ts <dataDir> <episodeSlug>')
  const store = new EpisodeStore(path.resolve(dataDir), null as never)
  const handlers = new Map<string, JobHandler>()
  const scheduler = { register: (task: string, fn: JobHandler) => void handlers.set(task, fn) } as unknown as Scheduler
  const deps = {
    dataDir: path.resolve(dataDir),
    store,
    log: console.log,
    toolsConfig: () => ({ blender: '', godot: '', ffmpeg: '' })
  } as unknown as ToolDeps
  registerGodotTools(scheduler, deps)
  registerEditTools(scheduler, deps)

  const run = async (task: string, unit: string | null) => {
    const t0 = Date.now()
    const ctx = {
      job: { episode, unit, task },
      signal: new AbortController().signal,
      log: (t: string) => console.log('   log:', t.trim()),
      progress: (p: { done: number; total: number; label: string }) => console.log(`   progress ${p.done}/${p.total} ${p.label}`)
    } as unknown as JobContext
    const out = await handlers.get(task)!(ctx)
    console.log(`${task} ${unit ?? ''} -> ${JSON.stringify(out)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  }

  const { shots } = await store.readValid(episode, 'shots.json', Shots)
  const ffmpeg = await requireTool(deps, 'ffmpeg')
  const dir = store.dir(episode)
  const ac = new AbortController()

  // audio first, so preview clips get a track
  await fs.mkdir(path.join(dir, 'audio'), { recursive: true })
  let total = TITLE_SECONDS + END_SECONDS
  for (const [i, s] of shots.entries()) {
    const tracks = JSON.parse(await fs.readFile(path.join(dir, 'tracks', `${s.id}.json`), 'utf8')) as { frames: number }
    const secs = tracks.frames / 12
    total += secs
    await runChecked('tone', ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${300 + i * 120}:duration=${secs}`, '-ar', '48000', '-ac', '2', path.join(dir, 'audio', `${s.id}.wav`)], { signal: ac.signal })
  }
  await fs.writeFile(path.join(dir, 'audio', 'episode.json'), JSON.stringify({ titleSec: TITLE_SECONDS, endStart: total - END_SECONDS, endSec: END_SECONDS, duration: total, shots: {} }))
  await runChecked('tone', ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${total}`, '-ar', '48000', '-ac', '2', path.join(dir, 'audio', 'episode.wav')], { signal: ac.signal })

  for (const s of shots) await run('preview_shot', s.id)
  await run('animatic', null)

  for (const s of shots) {
    const out = path.join(dir, 'render', s.id)
    await fs.rm(out, { recursive: true, force: true })
    await fs.mkdir(out, { recursive: true })
    await runChecked('frames', ffmpeg, ['-y', '-loglevel', 'error', '-i', path.join(dir, 'preview', `${s.id}.mp4`), '-vf', 'fps=12,scale=1280:720:flags=lanczos', '-start_number', '0', path.join(out, 'f_%04d.png')], { signal: ac.signal })
  }
  await run('edit_episode', null)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
