import { existsSync, readdirSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { detectTool } from '../detect'
import { runProcess } from '../exec'
import type { JobContext } from '../../queue/scheduler'
import type { ToolDeps } from './registry'

/** Shared helpers of the Godot preview and the ffmpeg editor tool modules. */

const found = new Map<string, string>()

/** Godot ships a GUI exe and a `_console` exe next to each other. The console one gives exit codes and stdout. */
export function preferConsoleGodot(exe: string): string {
  if (!/\.exe$/i.test(exe) || /console/i.test(exe)) return exe
  const dir = path.dirname(exe)
  const base = path.basename(exe).replace(/\.exe$/i, '')
  try {
    for (const f of readdirSync(dir)) {
      if (f.toLowerCase() === `${base}_console.exe`.toLowerCase()) return path.join(dir, f)
    }
  } catch {
    /* use the exe as it is */
  }
  return exe
}

/** The configured (or detected) path of godot or ffmpeg. Throws a readable error when the tool is missing. */
export async function requireTool(deps: Pick<ToolDeps, 'toolsConfig'>, name: 'godot' | 'ffmpeg'): Promise<string> {
  const configured = deps.toolsConfig()[name] ?? ''
  const key = `${name}|${configured}`
  const hit = found.get(key)
  if (hit && existsSync(hit)) return hit
  const st = await detectTool(name, configured)
  if (!st.found || !st.path) throw new Error(`${name} was not found${st.note ? ` (${st.note})` : ''}. Install it or set its path in config/tools.md (run \`npm run doctor\`).`)
  const p = name === 'godot' ? preferConsoleGodot(st.path) : st.path
  found.set(key, p)
  return p
}

/** Finds the repo's `godot/preview` project: TOYBOX_GODOT_PROJECT, else walk up from this file. */
export function findGodotProject(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TOYBOX_GODOT_PROJECT) return path.resolve(env.TOYBOX_GODOT_PROJECT)
  let dir = __dirname
  for (let i = 0; i < 7; i++) {
    const candidate = path.join(dir, 'godot', 'preview')
    if (existsSync(path.join(candidate, 'project.godot'))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.resolve('godot', 'preview')
}

export interface RunChecked {
  signal: AbortSignal
  /** Kill the process after this long. A timeout is a failure (it is retried), not a user stop. */
  timeoutMs?: number
  cwd?: string
  onLine?: (line: string) => void
  log?: (text: string) => void
}

/** Runs a program, fails with its stderr tail on a non-zero exit, and turns a timeout into a plain error. */
export async function runChecked(label: string, command: string, args: string[], o: RunChecked): Promise<void> {
  const timeout = o.timeoutMs ? AbortSignal.timeout(o.timeoutMs) : undefined
  const signal = timeout ? AbortSignal.any([o.signal, timeout]) : o.signal
  let res
  try {
    res = await runProcess(command, args, { signal, cwd: o.cwd, onLine: o.onLine })
  } catch (err) {
    if (!o.signal.aborted && timeout?.aborted) throw new Error(`${label} timed out after ${Math.round((o.timeoutMs ?? 0) / 1000)} s`, { cause: err })
    throw err
  }
  if (res.code !== 0) throw new Error(`${label} failed (exit ${res.code}): ${res.stderrTail.split('\n').slice(-6).join(' | ').slice(0, 800)}`)
}

export type ProgressFn = JobContext['progress']

/** Renames a finished temp file over the target (atomic on the same drive). */
export async function commitFile(tmp: string, target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.rename(tmp, target)
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
