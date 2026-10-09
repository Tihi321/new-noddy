import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { ToolsConfig } from '../../shared/schemas'

export type ToolName = 'blender' | 'godot' | 'ffmpeg'
export const TOOL_NAMES: readonly ToolName[] = ['blender', 'godot', 'ffmpeg']

export interface ToolStatus {
  name: ToolName
  found: boolean
  path?: string
  version?: string
  /** Where the path came from. */
  source: 'config' | 'path' | 'install-folder' | 'missing'
  note?: string
}

const EXE_NAMES: Record<ToolName, string[]> = {
  blender: ['blender'],
  godot: ['godot', 'godot4', 'godot.console'],
  ffmpeg: ['ffmpeg']
}

const VERSION_ARGS: Record<ToolName, string[]> = {
  blender: ['--version'],
  godot: ['--version'],
  ffmpeg: ['-version']
}

const isWin = process.platform === 'win32'

function pathCandidates(names: string[], env: NodeJS.ProcessEnv): string[] {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
  const exts = isWin ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : ['']
  const out: string[] = []
  for (const d of dirs) for (const n of names) for (const e of exts) out.push(path.join(d, n + e.toLowerCase()), path.join(d, n + e))
  return out
}

/** Folders where installers usually put the tools (Windows). Folder names are matched by prefix. */
function installFolderCandidates(name: ToolName, env: NodeJS.ProcessEnv): string[] {
  if (!isWin) return []
  const out: string[] = []
  const scan = (root: string, prefix: string, exe: (dir: string) => string) => {
    try {
      for (const e of readdirSync(root, { withFileTypes: true })) {
        if (e.isDirectory() && e.name.toLowerCase().startsWith(prefix.toLowerCase())) out.push(exe(path.join(root, e.name)))
      }
    } catch {
      /* the folder does not exist */
    }
  }
  if (name === 'blender') {
    for (const root of [env.ProgramFiles, env['ProgramFiles(x86)']]) {
      if (root) scan(path.join(root, 'Blender Foundation'), 'Blender', (d) => path.join(d, 'blender.exe'))
    }
  }
  const local = env.LOCALAPPDATA
  if (local) {
    out.push(path.join(local, 'Microsoft', 'WinGet', 'Links', `${name}.exe`))
    const prefix = name === 'ffmpeg' ? 'Gyan.FFmpeg' : name === 'godot' ? 'GodotEngine' : 'BlenderFoundation'
    scan(path.join(local, 'Microsoft', 'WinGet', 'Packages'), prefix, (d) => {
      // the package folder holds the exe directly, or in a versioned subfolder (ffmpeg: ffmpeg-x.y-full_build/bin)
      try {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const lower = e.name.toLowerCase()
          if (e.isFile() && lower.endsWith('.exe') && lower.startsWith(name) && !lower.includes('console')) return path.join(d, e.name)
          if (e.isDirectory()) {
            const bin = path.join(d, e.name, 'bin', `${name}.exe`)
            if (existsSync(bin)) return bin
          }
        }
      } catch {
        /* ignore */
      }
      return path.join(d, `${name}.exe`)
    })
  }
  return out
}

function runVersion(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      const text = `${stdout ?? ''}${stderr ?? ''}`.trim()
      if (err && !text) return resolve(null)
      resolve(text.split(/\r?\n/)[0] ?? null)
    })
  })
}

/** Finds a tool: the configured path first, then PATH, then the usual install folders. Runs it to read the version. */
export async function detectTool(name: ToolName, configured: string, env: NodeJS.ProcessEnv = process.env): Promise<ToolStatus> {
  const tried: { file: string; source: ToolStatus['source'] }[] = []
  if (configured.trim()) tried.push({ file: configured.trim(), source: 'config' })
  for (const f of pathCandidates(EXE_NAMES[name], env)) tried.push({ file: f, source: 'path' })
  for (const f of installFolderCandidates(name, env)) tried.push({ file: f, source: 'install-folder' })
  const seen = new Set<string>()
  for (const t of tried) {
    const key = t.file.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (!existsSync(t.file)) {
      if (t.source === 'config') return { name, found: false, source: 'missing', note: `configured path not found: ${t.file}` }
      continue
    }
    const version = await runVersion(t.file, VERSION_ARGS[name])
    if (version) return { name, found: true, path: t.file, version, source: t.source }
    if (t.source === 'config') return { name, found: false, path: t.file, source: 'missing', note: 'configured path did not run' }
  }
  return { name, found: false, source: 'missing' }
}

export async function detectAll(tools: Pick<ToolsConfig, 'blender' | 'godot' | 'ffmpeg'>, env: NodeJS.ProcessEnv = process.env): Promise<ToolStatus[]> {
  return Promise.all(TOOL_NAMES.map((n) => detectTool(n, tools[n], env)))
}
