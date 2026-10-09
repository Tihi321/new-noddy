import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { atomicWrite } from './atomic'

/** Folders created inside the data folder (see "Shared files" in docs/design.md). */
export const DATA_LAYOUT = [
  'config',
  'agents',
  'prompts',
  'cast',
  'sets',
  'styles',
  'sfx',
  'episodes',
  'jobs/queued',
  'jobs/running',
  'jobs/done',
  'jobs/failed',
  'logs/agents',
  'logs/spend'
] as const

export interface ResolveOptions {
  argv?: readonly string[]
  env?: NodeJS.ProcessEnv
  homedir?: string
}

/** Reads `--data <dir>` or `--data=<dir>` from an argument list. */
export function argValue(argv: readonly string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === `--${name}`) return argv[i + 1]
    if (a?.startsWith(`--${name}=`)) return a.slice(name.length + 3)
  }
  return undefined
}

/** `--data` argument, then the TOYBOX_DATA env var, then `~/ToyboxStudio`. */
export function resolveDataDir(opts: ResolveOptions = {}): string {
  const argv = opts.argv ?? process.argv.slice(2)
  const env = opts.env ?? process.env
  const chosen = argValue(argv, 'data') || env.TOYBOX_DATA || path.join(opts.homedir ?? os.homedir(), 'ToyboxStudio')
  return path.resolve(chosen)
}

/** Finds the repo's `seed/` folder: TOYBOX_SEED, else walk up from this file. */
export function findSeedDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.TOYBOX_SEED) return path.resolve(env.TOYBOX_SEED)
  let dir = __dirname
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'seed')
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

export interface InitResult {
  dataDir: string
  createdDirs: number
  copied: string[]
  skipped: string[]
}

// ---------------------------------------------------------------- seed manifest

/** File in the data folder that records the hash of every seed file at the moment it was copied there. */
export const SEED_MANIFEST = '.seed-manifest.json'
/** Folder in the data folder where `resetToSeed` keeps the files it overwrote (one sub folder per reset). */
export const BACKUP_DIR = '.backup'

export interface SeedManifest {
  version: 1
  /** relative path (forward slashes) -> sha256 of the seed file when it was copied */
  files: Record<string, string>
}

const hashBuf = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const hashFile = async (f: string): Promise<string | null> => {
  try {
    return hashBuf(await fs.readFile(f))
  } catch {
    return null
  }
}

export async function readSeedManifest(dataDir: string): Promise<SeedManifest> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dataDir, SEED_MANIFEST), 'utf8')) as Partial<SeedManifest>
    if (raw && typeof raw === 'object' && raw.files && typeof raw.files === 'object') return { version: 1, files: { ...raw.files } }
  } catch {
    /* none yet */
  }
  return { version: 1, files: {} }
}

async function writeSeedManifest(dataDir: string, m: SeedManifest): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(m.files).sort(([a], [b]) => a.localeCompare(b)))
  await atomicWrite(path.join(dataDir, SEED_MANIFEST), JSON.stringify({ version: 1, files: sorted }, null, 2) + '\n')
}

/** Every file below `root` as a relative path with forward slashes. */
async function listFiles(root: string, rel = ''): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await fs.readdir(path.join(root, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await listFiles(root, r)))
    else if (e.isFile()) out.push(r)
  }
  return out.sort()
}

async function copyTree(src: string, dest: string, root: string, result: InitResult, manifest: SeedManifest): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyTree(from, to, root, result, manifest)
    } else if (entry.isFile()) {
      const rel = path.relative(root, to).split(path.sep).join('/')
      try {
        // COPYFILE_EXCL: never overwrite a file that already exists.
        await fs.copyFile(from, to, 1)
        result.copied.push(rel)
        const h = await hashFile(from)
        if (h) manifest.files[rel] = h
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          result.skipped.push(rel)
          // A file that already equals the seed is "in sync": remember that, so a later seed change is noticed.
          const [a, b] = await Promise.all([hashFile(from), hashFile(to)])
          if (a && a === b && manifest.files[rel] !== a) manifest.files[rel] = a
        } else throw err
      }
    }
  }
}

/** Creates the data folder layout and copies `seed/` into it. Existing files are never overwritten. Records `.seed-manifest.json`. */
export async function initDataFolder(dataDir: string, seedDir: string | undefined = findSeedDir()): Promise<InitResult> {
  const result: InitResult = { dataDir, createdDirs: 0, copied: [], skipped: [] }
  await fs.mkdir(dataDir, { recursive: true })
  if (seedDir && existsSync(seedDir)) {
    const manifest = await readSeedManifest(dataDir)
    const before = JSON.stringify(manifest.files)
    await copyTree(seedDir, dataDir, dataDir, result, manifest)
    if (JSON.stringify(manifest.files) !== before) await writeSeedManifest(dataDir, manifest)
  }
  for (const rel of DATA_LAYOUT) {
    const dir = path.join(dataDir, ...rel.split('/'))
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true })
      result.createdDirs++
    }
  }
  return result
}

// ---------------------------------------------------------------- seed drift and reset

export interface SeedDrift {
  /** Seed files whose content changed since they were copied, and whose data-folder copy is not the new version. */
  stale: string[]
  /** Subset of `stale` that was also edited in the data folder (a reset replaces these too, after a backup). */
  edited: string[]
}

/**
 * Seed files that are newer than the data-folder copy: the seed content hash differs from the hash recorded when the
 * file was copied (`.seed-manifest.json`), and the data folder does not have the new version. Files with no recorded
 * hash (a data folder from before the manifest existed, edited since) cannot be judged and are not reported.
 */
export async function findSeedDrift(dataDir: string, seedDir: string | undefined = findSeedDir()): Promise<SeedDrift> {
  const drift: SeedDrift = { stale: [], edited: [] }
  if (!seedDir || !existsSync(seedDir)) return drift
  const manifest = await readSeedManifest(dataDir)
  for (const rel of await listFiles(seedDir)) {
    const recorded = manifest.files[rel]
    if (!recorded) continue
    const seedHash = await hashFile(path.join(seedDir, rel))
    if (!seedHash || seedHash === recorded) continue
    const mine = await hashFile(path.join(dataDir, ...rel.split('/')))
    if (mine === seedHash) continue // already up to date by hand
    drift.stale.push(rel)
    if (mine !== null && mine !== recorded) drift.edited.push(rel)
  }
  return drift
}

export interface ResetOptions {
  /** Top-level seed folders to reset (`prompts`, `sets`, `cast`, `styles`, `config`, `agents`, `sfx`). Default: all of them. */
  only?: string[]
  /** Keep a copy of every overwritten file in `<data>/.backup/<timestamp>/`. Default true. */
  backup?: boolean
  /** Time stamp used for the backup folder name (tests). */
  now?: Date
}

export interface ResetResult {
  dataDir: string
  /** Files that were different and were replaced with the seed version. */
  replaced: string[]
  /** Seed files that did not exist in the data folder and were added. */
  added: string[]
  /** Files that already matched the seed. */
  unchanged: string[]
  /** The backup folder, when something was backed up. */
  backupDir: string | null
}

/** Top-level folders of the seed (what `only` may name). */
export async function seedAreas(seedDir: string): Promise<string[]> {
  const entries = await fs.readdir(seedDir, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
}

/**
 * Overwrites data-folder files with the seed versions (all areas, or only the named top-level folders). Files that
 * differ are first copied to `<data>/.backup/<timestamp>/<same relative path>`. Files that exist only in the data
 * folder (your own cast, sets, ...) are never touched. Updates `.seed-manifest.json`.
 */
export async function resetToSeed(dataDir: string, seedDir: string | undefined = findSeedDir(), opts: ResetOptions = {}): Promise<ResetResult> {
  if (!seedDir || !existsSync(seedDir)) throw new Error('seed folder not found (set TOYBOX_SEED or pass --seed <dir>)')
  const areas = await seedAreas(seedDir)
  const only = opts.only?.map((a) => a.trim().replace(/^[\\/]+|[\\/]+$/g, '')).filter(Boolean)
  if (only) {
    const bad = only.filter((a) => !areas.includes(a))
    if (bad.length) throw new Error(`unknown seed folder(s): ${bad.join(', ')}. Choose from: ${areas.join(', ')}`)
  }
  const wanted = only && only.length ? only : areas
  const backup = opts.backup ?? true
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, '-')
  const backupDir = path.join(dataDir, BACKUP_DIR, stamp)
  const result: ResetResult = { dataDir, replaced: [], added: [], unchanged: [], backupDir: null }
  const manifest = await readSeedManifest(dataDir)
  await fs.mkdir(dataDir, { recursive: true })
  for (const rel of await listFiles(seedDir)) {
    if (!wanted.includes(rel.split('/')[0]!)) continue
    const from = path.join(seedDir, ...rel.split('/'))
    const to = path.join(dataDir, ...rel.split('/'))
    const seedHash = hashBuf(await fs.readFile(from))
    let current: Buffer | null = null
    try {
      current = await fs.readFile(to)
    } catch {
      /* not there yet */
    }
    if (current && hashBuf(current) === seedHash) {
      result.unchanged.push(rel)
      manifest.files[rel] = seedHash
      continue
    }
    if (current) {
      if (backup) {
        const b = path.join(backupDir, ...rel.split('/'))
        await fs.mkdir(path.dirname(b), { recursive: true })
        await fs.writeFile(b, current)
        result.backupDir = backupDir
      }
      result.replaced.push(rel)
    } else result.added.push(rel)
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.copyFile(from, to)
    manifest.files[rel] = seedHash
  }
  await writeSeedManifest(dataDir, manifest)
  return result
}
