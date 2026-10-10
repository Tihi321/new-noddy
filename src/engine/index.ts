import path from 'node:path'
import { doctor, keySet, probe, resetSeed } from './cli'
import { Engine } from './engine'
import { promises as fs } from 'node:fs'
import { installPipeline } from './pipeline/install'
import type { InstalledPipeline } from './pipeline/install'
import { argValue, findSeedDir, findSeedDrift, initDataFolder, resolveDataDir } from './store/dataFolder'
import { watchDataFolder } from './store/watcher'
import { getParentPort, ParentPortTransport, StdoutTransport } from './transport'
import type { EngineTransport } from '../shared/protocol'

const USAGE = `Toybox Studio engine

Usage:
  npm run engine -- [--data <dir>] [--seed <dir>] [--once] [--heartbeat <ms>]
  npm run engine -- probe [--model <provider/model>] [--data <dir>]
  npm run engine -- doctor [--data <dir>]
  npm run engine -- run-episode [--data <dir>] --theme "<text>" [--type lesson] [--length 5] [--approve-all] [--episode <id>]
  npm run engine -- reset-seed [--data <dir>] [--only prompts,sets,...] [--no-backup]
  npm run key:set <ENV_NAME>

  --data <dir>      Data folder. Default: TOYBOX_DATA, else ~/ToyboxStudio
  --seed <dir>      Seed folder to copy from. Default: the repo's seed/ (or TOYBOX_SEED)
  --once            Create the data folder from the seed and exit
  --heartbeat <ms>  Heartbeat interval. Default 3000
  probe             List the providers and models that are reachable; with --model, stream one short reply
  doctor            Check Node, Blender, Godot, ffmpeg, LM Studio and Strata (prints a table, exit code 0)
  run-episode       Create an episode (or, with --episode <id>, carry on an existing one) and run the engine until it is done or failed
                    (exit code 0 when done, 1 when failed). Stage timings go to stderr and to episodes/<id>/timings.json.
  reset-seed        Overwrite the data folder's copies of the seed files (all of seed/, or only the listed folders: config, agents,
                    prompts, cast, sets, styles, sfx) with the repo's versions. Replaced files are backed up to <data>/.backup/<time>/
  key-set <NAME>    Store an API key in the Windows credential store (hidden prompt)

Without a subcommand the engine runs. Under Electron it talks to the app. Headless, it prints every event as one JSON line
on stdout and its own log lines on stderr.
`

const log = (message: string): void => void process.stderr.write(`[engine] ${message}\n`)

/** `run-episode`: starts (or resumes) one episode and resolves with the exit code when it is done or failed. */
async function driveEpisode(engine: Engine, pipeline: InstalledPipeline, argv: string[], dataDir: string): Promise<number> {
  const approveAll = argv.includes('--approve-all')
  let id = argValue(argv, 'episode')
  const t0 = Date.now()
  const stamps: { stage: string; at: string; elapsedSec: number }[] = []
  let lastStage = ''
  const done = new Promise<number>((resolve) => {
    engine.onEvent((e) => {
      if (e.type !== 'episode.updated' || (id && e.episode.id !== id)) return
      const ep = e.episode
      if (ep.stage !== lastStage) {
        lastStage = ep.stage
        const elapsedSec = Math.round((Date.now() - t0) / 100) / 10
        stamps.push({ stage: ep.stage, at: new Date().toISOString(), elapsedSec })
        log(`stage ${ep.stage} (${ep.status}) at +${elapsedSec}s`)
        void fs.writeFile(path.join(dataDir, 'episodes', ep.id, 'timings.json'), JSON.stringify(stamps, null, 2)).catch(() => undefined)
      }
      if (ep.stage === 'done') resolve(0)
      if (ep.stage === 'failed') resolve(1)
    })
  })
  if (!id) {
    // npm on Windows passes a quoted argument through cmd.exe, which can leave `^` characters behind
    const theme = argValue(argv, 'theme')?.replace(/\^/g, '').trim()
    if (!theme) {
      log('run-episode needs --theme "<text>" (or --episode <id>)')
      return 2
    }
    const before = new Set(await pipeline.store.ids())
    await engine.handleCommand({
      type: 'newEpisode',
      theme,
      episodeType: (argValue(argv, 'type') ?? 'lesson') as never,
      characters: [],
      lengthMin: Number(argValue(argv, 'length') ?? 5),
      style: argValue(argv, 'style') ?? 'toyland-wood',
      approvals: { script: !approveAll, animatic: !approveAll }
    })
    id = (await pipeline.store.ids()).find((x) => !before.has(x))
    if (!id) {
      log('the episode was not created')
      return 2
    }
    log(`episode ${id} created`)
  } else {
    await engine.handleCommand({ type: 'retryEpisode', episode: id })
    pipeline.pipeline.kick()
  }
  return done
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    return
  }
  if (argv[0] === 'probe') {
    process.exitCode = await probe(argv.slice(1))
    return
  }
  if (argv[0] === 'doctor') {
    process.exitCode = await doctor(argv.slice(1))
    return
  }
  if (argv[0] === 'reset-seed') {
    process.exitCode = await resetSeed(argv.slice(1))
    return
  }
  if (argv[0] === 'key-set') {
    process.exitCode = await keySet(argv.slice(1))
    return
  }

  const runEpisode = argv[0] === 'run-episode'
  const once = argv.includes('--once') || argv.includes('--init-only')
  const heartbeatMs = Number(argValue(argv, 'heartbeat') ?? 3000)
  const dataDir = resolveDataDir({ argv })
  const parentPort = getParentPort()
  const transport: EngineTransport = parentPort ? new ParentPortTransport(parentPort) : new StdoutTransport()

  const seed = argValue(argv, 'seed')
  const init = await initDataFolder(dataDir, seed ? path.resolve(seed) : undefined)
  log(`data folder: ${dataDir}`)
  log(`seed: copied ${init.copied.length} file(s), kept ${init.skipped.length} existing, created ${init.createdDirs} folder(s)`)
  if (once) return

  const startedAt = Date.now()
  const engine = new Engine({ dataDir, emit: (e) => transport.send(e), log })
  // The episode pipeline: story handlers, tool modules, newEpisode/approve/requestChanges, the episode list.
  const pipeline = installPipeline(engine)
  await engine.start()
  // The seed copy never overwrites, so an old data folder can keep stale prompts and sets: say so.
  void findSeedDrift(dataDir, seed ? path.resolve(seed) : findSeedDir())
    .then((drift) => {
      if (drift.stale.length === 0) return
      const shown = drift.stale.slice(0, 6).join(', ') + (drift.stale.length > 6 ? `, and ${drift.stale.length - 6} more` : '')
      const message = `${drift.stale.length} seed file(s) are newer than your data folder's copy (${shown}). Run "reset-seed" to update them (replaced files are backed up to .backup/).`
      log(`warning: ${message}`)
      transport.send({ type: 'engine.warning', message })
    })
    .catch(() => undefined)
  const watcher = watchDataFolder(dataDir, (e) => {
    log(`changed: ${e.kind} ${e.change} ${e.rel}`)
    void engine.handleWatch(e)
  })
  await watcher.ready
  transport.onMessage((cmd) => {
    engine.handleCommand(cmd).catch((err) => log(`command ${cmd.type} failed: ${(err as Error).message}`))
  })

  if (runEpisode) {
    void driveEpisode(engine, pipeline, argv, dataDir).then(async (code) => {
      await stopAll(code)
    })
  }

  let n = 0
  const beat = setInterval(() => {
    n++
    transport.send({ type: 'engine.heartbeat', n, at: new Date().toISOString(), uptimeMs: Date.now() - startedAt })
  }, heartbeatMs)

  let stopping = false
  const stopAll = async (code: number): Promise<void> => {
    if (stopping) return
    stopping = true
    clearInterval(beat)
    await watcher.close()
    await pipeline.stop()
    await engine.stop()
    transport.close()
    process.exit(code)
  }
  const stop = (): Promise<void> => stopAll(0)
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())

  transport.send({ type: 'engine.ready', pid: process.pid, dataDir, at: new Date().toISOString() })
  transport.send({ type: 'engine.heartbeat', n: 0, at: new Date().toISOString(), uptimeMs: 0 })
}

main().catch((err) => {
  process.stderr.write(`[engine] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
})
