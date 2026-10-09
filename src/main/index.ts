import { app, BrowserWindow, ipcMain, powerSaveBlocker, protocol, shell } from 'electron'
import { createReadStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import path from 'node:path'
import { isCommand } from '../shared/protocol'
import type { EngineEvent } from '../shared/protocol'
import { MEDIA_SCHEME } from '../renderer/hostApi'
import { startEngine } from './engineClient'
import { mediaUrlToPath, parseRange, readFileInside, resolveInside, tailFileInside } from './files'

const EVENT_CHANNEL = 'engine:event'
const COMMAND_CHANNEL = 'engine:command'

let win: BrowserWindow | null = null
let dataDir: string | null = null
let quitting = false
const runningJobs = new Set<string>()
let blockerId: number | null = null

// TOYBOX_NO_WINDOW=1 runs the engine without the main window (for scripted checks).
const noWindow = process.env.TOYBOX_NO_WINDOW === '1'

// Thumbnails, animatics and the final video are served by this scheme, from the data folder only (see files.ts).
protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

function forwardedEngineArgs(): string[] {
  const i = process.argv.findIndex((a) => a === '--data')
  const value = i >= 0 ? process.argv[i + 1] : undefined
  const args = value ? ['--data', value] : []
  // `resetSeed` in the engine finds the seed folder through this
  if (app.isPackaged) process.env.TOYBOX_SEED = path.join(process.resourcesPath, 'seed')
  // The engine cannot find `seed/` from inside the archive, so a packaged app hands it the copy in resources.
  if (app.isPackaged) args.push('--seed', path.join(process.resourcesPath, 'seed'))
  return args
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Toybox Studio',
    backgroundColor: '#1d1a2b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void w.loadFile(path.join(__dirname, '../renderer/index.html'))
  return w
}

/** Keeps the machine awake while jobs run (renders take hours). */
function updatePowerBlocker(): void {
  if (runningJobs.size > 0 && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension')
  else if (runningJobs.size === 0 && blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  void app.whenReady().then(() => {
    const engine = startEngine(path.join(__dirname, '../engine/index.js'), forwardedEngineArgs())

    protocol.handle(MEDIA_SCHEME, async (request) => {
      const hit = dataDir ? mediaUrlToPath(dataDir, request.url) : null
      if (!hit || !dataDir) return new Response('not found', { status: 404 })
      try {
        // a link inside the data folder that points elsewhere is refused too
        const root = await fs.realpath(dataDir)
        const real = await fs.realpath(hit.file)
        if (!resolveInside(root, path.relative(root, real))) return new Response('not found', { status: 404 })
        // Range requests are answered here: <video> needs them to seek and to stream large files
        const size = (await fs.stat(real)).size
        const range = parseRange(request.headers.get('range'), size)
        const base = { 'content-type': hit.type, 'accept-ranges': 'bytes' }
        if (range === 'invalid') return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } })
        const { start, end } = range ?? { start: 0, end: Math.max(0, size - 1) }
        const stream = size === 0 ? null : (Readable.toWeb(createReadStream(real, { start, end })) as unknown as ReadableStream)
        return new Response(stream, {
          status: range ? 206 : 200,
          headers: { ...base, 'content-length': String(size === 0 ? 0 : end - start + 1), ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) }
        })
      } catch {
        return new Response('not found', { status: 404 })
      }
    })

    engine.onMessage((event: EngineEvent) => {
      if (event.type !== 'engine.heartbeat') console.log(`[main] engine event: ${event.type}`)
      if (win && !win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, event)
      switch (event.type) {
        case 'engine.ready':
          dataDir = event.dataDir
          break
        case 'snapshot':
          for (const r of event.running) runningJobs.add(r.jobId)
          updatePowerBlocker()
          break
        case 'job.started':
          runningJobs.add(event.jobId)
          updatePowerBlocker()
          break
        case 'job.done':
          runningJobs.delete(event.jobId)
          updatePowerBlocker()
          break
        default:
          break
      }
    })

    ipcMain.on(COMMAND_CHANNEL, (_e, command: unknown) => {
      if (isCommand(command)) engine.send(command)
    })
    ipcMain.handle('host:readFile', (_e, rel: unknown) => (dataDir ? readFileInside(dataDir, rel) : null))
    ipcMain.handle('host:tailFile', (_e, rel: unknown, from: unknown) => (dataDir ? tailFileInside(dataDir, rel, from) : null))
    ipcMain.handle('host:openFolder', async (_e, rel: unknown) => {
      const full = dataDir ? resolveInside(dataDir, rel) : null
      if (!full) return false
      return (await shell.openPath(full)) === ''
    })

    if (!noWindow) {
      win = createWindow()
      // The renderer asks for a first state once it has loaded.
      win.webContents.on('did-finish-load', () => {
        engine.send({ type: 'ping', id: 'startup' })
        engine.send({ type: 'snapshot' })
      })
    }

    // Quit ends the engine. Jobs that were running are recovered into the queue when it starts again.
    app.on('before-quit', (e) => {
      if (quitting) return
      quitting = true
      e.preventDefault()
      if (blockerId !== null) powerSaveBlocker.stop(blockerId)
      engine.close()
      setTimeout(() => app.exit(0), 200)
    })
    app.on('window-all-closed', () => {
      if (!noWindow) app.quit()
    })
  })
}
