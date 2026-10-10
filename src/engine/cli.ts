import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMdWith } from '../shared/md'
import { toolsSchema } from '../shared/schemas'
import type { ToolsConfig } from '../shared/schemas'
import { Budget } from './budget/spend'
import { resolveKey, setStoredKey } from './models/keys'
import { ModelRegistry, computeCost, isPaidModel } from './models/registry'
import { ModelRouter } from './models/router'
import { emptyUsage } from './models/types'
import type { Usage } from './models/types'
import { argValue, findSeedDir, initDataFolder, resetToSeed, resolveDataDir } from './store/dataFolder'
import { detectAll } from './tools/detect'
import type { ToolStatus } from './tools/detect'

const out = (s: string) => process.stdout.write(s + '\n')

/** `engine probe [--model provider/model]`: lists providers and the models reachable, optionally streams one short reply. */
export async function probe(argv: string[]): Promise<number> {
  const dataDir = resolveDataDir({ argv })
  await initDataFolder(dataDir, argValue(argv, 'seed'))
  const registry = new ModelRegistry(dataDir)
  await registry.load()
  const discovered = await registry.discover()
  for (const d of discovered) out(`discovery ${d.provider}: ${d.error ? 'failed (' + d.error + ')' : d.found + ' model(s)'}`)

  out('')
  out('Providers')
  for (const p of registry.providers.values()) {
    const models = [...registry.models.values()].filter((m) => m.provider.id === p.id && !m.embedding)
    const status = p.available ? 'available' : `unavailable (${p.unavailableReason ?? 'unknown'})`
    out(`  ${p.id.padEnd(12)} ${p.kind.padEnd(14)} ${p.local ? 'local ' : 'remote'} ${status}, ${models.length} model(s)`)
    if (p.available) for (const m of models) out(`      ${m.ref}${m.discovered ? '  (discovered)' : ''}${isPaidModel(m) ? `  $${m.priceIn}/${m.priceOut} per 1M` : ''}`)
  }
  out('')
  out('Role defaults')
  for (const [role, v] of Object.entries(registry.roles.roles)) {
    const first = v.models.find((ref) => registry.getModel(ref)?.provider.available)
    out(`  ${role.padEnd(20)} ${first ?? 'NO USABLE MODEL'}${first && first !== v.models[0] ? `  (default ${v.models[0]} is unavailable)` : ''}`)
  }

  let code = 0
  const ref = argValue(argv, 'model')
  if (ref) {
    const budget = new Budget(dataDir)
    await budget.load()
    const router = new ModelRouter(registry, budget, { retries: 0 })
    const model = registry.getModel(ref)
    if (!model) {
      out(`\n[${ref}] unknown model (not in config/providers.md and not discovered)`)
      return 1
    }
    if (!model.provider.available) {
      out(`\n[${ref}] unavailable: ${model.provider.unavailableReason}`)
      return 1
    }
    out(`\n[${ref}] streaming a short reply...`)
    let usage: Usage = emptyUsage()
    let text = ''
    try {
      for await (const ev of router.chat([model], {
        messages: [{ role: 'user', content: 'Reply with one short, friendly sentence about a wooden toy train.' }],
        maxTokens: 300,
        meta: { role: 'probe', task: 'probe', agent: 'cli' }
      })) {
        if (ev.type === 'delta') {
          text += ev.text
          process.stdout.write(ev.text)
        } else if (ev.type === 'done') usage = ev.usage
      }
      out(`\n  tokens in/cached/out: ${usage.inputTokens}/${usage.cachedInputTokens}/${usage.outputTokens}, cost ${isPaidModel(model) ? computeCost(model, usage).toFixed(6) : '0 (local)'} USD, ${text.length} chars`)
    } catch (err) {
      out(`\n  failed: ${(err as Error).message}`)
      code = 1
    }
    await budget.flush()
  }
  return code
}

// ---- doctor ----

export interface DoctorRow {
  check: string
  status: 'OK' | 'MISSING' | 'WARN'
  detail: string
}

export interface DoctorDeps {
  fetchImpl?: typeof fetch
  detect?: (tools: ToolsConfig) => Promise<ToolStatus[]>
  env?: NodeJS.ProcessEnv
  nodeVersion?: string
  /** Where config/tools.md is looked for: the data folder, then the seed. */
  dataDir?: string
  seedDir?: string
}

async function readTools(dataDir: string | undefined, seedDir: string | undefined): Promise<ToolsConfig> {
  for (const base of [dataDir, seedDir]) {
    if (!base) continue
    const file = path.join(base, 'config', 'tools.md')
    if (!existsSync(file)) continue
    try {
      return parseMdWith(await fs.readFile(file, 'utf8'), toolsSchema, file).data
    } catch {
      /* an invalid file: fall back to auto-detect */
    }
  }
  return toolsSchema.parse({ kind: 'tools' })
}

/** Runs every check. Never throws, and a missing tool is a row with status MISSING, not an error. */
export async function runDoctor(deps: DoctorDeps = {}): Promise<DoctorRow[]> {
  const rows: DoctorRow[] = []
  const nodeVersion = deps.nodeVersion ?? process.versions.node
  const major = Number(nodeVersion.split('.')[0])
  rows.push({ check: 'node', status: major >= 24 ? 'OK' : 'WARN', detail: `v${nodeVersion}${major >= 24 ? '' : ' (24 or newer is expected)'}` })

  const tools = await readTools(deps.dataDir, deps.seedDir)
  const found = await (deps.detect ?? ((t) => detectAll(t, deps.env)))(tools)
  for (const t of found) {
    rows.push({ check: t.name, status: t.found ? 'OK' : 'MISSING', detail: t.found ? `${t.version} (${t.path}, ${t.source})` : (t.note ?? 'not found on PATH or in config/tools.md') })
  }

  const f = deps.fetchImpl ?? fetch
  try {
    const res = await f('http://localhost:1234/v1/models', { signal: AbortSignal.timeout(3000) })
    if (!res.ok) rows.push({ check: 'lm-studio', status: 'WARN', detail: `localhost:1234 answered HTTP ${res.status}` })
    else {
      const json = (await res.json()) as { data?: { id: string }[] }
      const n = json.data?.filter((m) => !/embed/i.test(m.id)).length ?? 0
      rows.push({ check: 'lm-studio', status: 'OK', detail: `localhost:1234 reachable, ${n} chat model(s)` })
    }
  } catch {
    rows.push({ check: 'lm-studio', status: 'MISSING', detail: 'localhost:1234 not reachable (start the LM Studio server)' })
  }

  // Strata is optional (a fast local server the user starts), so it is never MISSING.
  const startHint = 'optional: start D:\\Strata\\run-iq3_s.bat'
  try {
    const res = await f('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(3000) })
    if (!res.ok) rows.push({ check: 'strata', status: 'WARN', detail: `127.0.0.1:8080 answered HTTP ${res.status} (${startHint})` })
    else {
      const json = (await res.json()) as { loaded?: boolean; model?: string; max_context?: number }
      if (json.loaded) rows.push({ check: 'strata', status: 'OK', detail: `127.0.0.1:8080 loaded, ${json.model ?? 'model'}, context ${json.max_context ?? '?'}` })
      else rows.push({ check: 'strata', status: 'WARN', detail: `127.0.0.1:8080 is up but the model is still loading (${startHint})` })
    }
  } catch {
    rows.push({ check: 'strata', status: 'WARN', detail: `127.0.0.1:8080 not reachable (${startHint})` })
  }

  const key = (deps.env ?? process.env).ANTHROPIC_API_KEY ? true : !!resolveKey('ANTHROPIC_API_KEY')
  rows.push({ check: 'anthropic-key', status: key ? 'OK' : 'WARN', detail: key ? 'ANTHROPIC_API_KEY is set' : 'ANTHROPIC_API_KEY not set (npm run key:set ANTHROPIC_API_KEY); local models still work' })
  return rows
}

export function formatDoctor(rows: DoctorRow[]): string {
  const w1 = Math.max(5, ...rows.map((r) => r.check.length))
  const w2 = Math.max(6, ...rows.map((r) => r.status.length))
  const line = (a: string, b: string, c: string) => `${a.padEnd(w1)}  ${b.padEnd(w2)}  ${c}`
  return [line('CHECK', 'STATUS', 'DETAIL'), line('-'.repeat(w1), '-'.repeat(w2), '-'.repeat(20)), ...rows.map((r) => line(r.check, r.status, r.detail))].join('\n')
}

/** `engine doctor`: prints the table. Exit code 0 even when tools are missing. */
export async function doctor(argv: string[]): Promise<number> {
  const dataDir = resolveDataDir({ argv })
  const rows = await runDoctor({ dataDir, seedDir: argValue(argv, 'seed') ?? findSeedDir() })
  out(formatDoctor(rows))
  const missing = rows.filter((r) => r.status === 'MISSING').map((r) => r.check)
  out(missing.length ? `\n${missing.length} item(s) MISSING: ${missing.join(', ')}` : '\nEverything needed was found.')
  return 0
}

/**
 * `engine reset-seed [--only prompts,sets,...] [--no-backup] [--seed <dir>]`: overwrites the data folder's copies of the seed
 * files (prompts, sets, cast, styles, config, agents, sfx) with the repo's versions. Overwritten files are backed up to
 * `<data>/.backup/<timestamp>/` unless `--no-backup` is given.
 */
export async function resetSeed(argv: string[]): Promise<number> {
  const dataDir = resolveDataDir({ argv })
  const seed = argValue(argv, 'seed')
  const only = argValue(argv, 'only')
    ?.split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  try {
    const r = await resetToSeed(dataDir, seed ? path.resolve(seed) : findSeedDir(), { only, backup: !argv.includes('--no-backup') })
    out(`reset-seed: ${r.replaced.length} replaced, ${r.added.length} added, ${r.unchanged.length} already up to date`)
    for (const f of r.replaced) out(`  replaced ${f}`)
    for (const f of r.added) out(`  added    ${f}`)
    if (r.backupDir) out(`backup of the replaced files: ${r.backupDir}`)
    return 0
  } catch (err) {
    out(`reset-seed failed: ${(err as Error).message}`)
    return 1
  }
}

/** `engine key-set <ENV_NAME>`: asks for the key without echo and stores it in the Windows credential store. */
export async function keySet(argv: string[]): Promise<number> {
  const name = argv.find((a) => !a.startsWith('-'))
  if (!name || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
    out('Usage: npm run key:set <ENV_NAME>   for example: npm run key:set ANTHROPIC_API_KEY')
    return 2
  }
  if (resolveKey(name) && process.env[name]) out(`Note: ${name} is also set in the environment, which takes priority.`)
  const value = await promptHidden(`Key for ${name} (input is hidden): `)
  if (!value) {
    out('No key entered, nothing stored.')
    return 1
  }
  setStoredKey(name, value)
  out(`Stored ${name} in the Windows credential store (service "toybox-studio").`)
  return 0
}

function promptHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    process.stdout.write(prompt)
    if (!stdin.isTTY) {
      let data = ''
      stdin.setEncoding('utf8')
      stdin.on('data', (c) => (data += c))
      stdin.on('end', () => resolve(data.trim()))
      return
    }
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.removeListener('data', onData)
          process.stdout.write('\n')
          return resolve(value.trim())
        }
        if (ch === '\u0003') process.exit(130)
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    stdin.on('data', onData)
  })
}
