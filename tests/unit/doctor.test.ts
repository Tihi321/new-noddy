import { describe, expect, it } from 'vitest'
import { formatDoctor, runDoctor } from '../../src/engine/cli'
import { detectTool } from '../../src/engine/tools/detect'
import { runProcess } from '../../src/engine/tools/exec'
import type { ToolStatus } from '../../src/engine/tools/detect'

const missingTools = async (): Promise<ToolStatus[]> => [
  { name: 'blender', found: false, source: 'missing' },
  { name: 'godot', found: false, source: 'missing' },
  { name: 'ffmpeg', found: true, path: 'C:\\ffmpeg\\ffmpeg.exe', version: 'ffmpeg version 7.1', source: 'path' }
]

describe('doctor', () => {
  it('marks missing tools and an unreachable LM Studio, and still returns rows (no tools needed)', async () => {
    const rows = await runDoctor({
      detect: missingTools,
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED')
      }) as unknown as typeof fetch,
      env: {}
    })
    const byName = Object.fromEntries(rows.map((r) => [r.check, r]))
    expect(byName.node?.status).toBe('OK')
    expect(byName.blender?.status).toBe('MISSING')
    expect(byName.godot?.status).toBe('MISSING')
    expect(byName.ffmpeg?.status).toBe('OK')
    expect(byName['lm-studio']?.status).toBe('MISSING')
    const table = formatDoctor(rows)
    expect(table).toContain('CHECK')
    expect(table).toMatch(/blender\s+MISSING/)
  })

  it('reports LM Studio models when it answers', async () => {
    const rows = await runDoctor({
      detect: missingTools,
      fetchImpl: (async () => new Response(JSON.stringify({ data: [{ id: 'qwen' }, { id: 'text-embedding-x' }] }), { status: 200 })) as unknown as typeof fetch,
      env: {}
    })
    const lm = rows.find((r) => r.check === 'lm-studio')!
    expect(lm.status).toBe('OK')
    expect(lm.detail).toContain('1 chat model')
  })

  it('warns about an old Node version', async () => {
    const rows = await runDoctor({ detect: missingTools, nodeVersion: '20.1.0', fetchImpl: (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch, env: {} })
    expect(rows[0]).toMatchObject({ check: 'node', status: 'WARN' })
    expect(rows.find((r) => r.check === 'lm-studio')?.status).toBe('WARN')
  })

  it('detectTool: a configured path that does not exist is MISSING, not an error', async () => {
    const s = await detectTool('blender', 'Z:\\nowhere\\blender.exe', { PATH: '' })
    expect(s).toMatchObject({ found: false, source: 'missing' })
    expect(s.note).toMatch(/not found/)
  })
})

describe('runProcess', () => {
  it('streams stdout lines and returns the exit code', async () => {
    const lines: string[] = []
    const r = await runProcess(process.execPath, ['-e', 'console.log("a"); console.log("b"); process.exit(3)'], { onLine: (l) => lines.push(l) })
    expect(lines).toEqual(['a', 'b'])
    expect(r.code).toBe(3)
  })

  it('kills the process on abort', async () => {
    const ac = new AbortController()
    const p = runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { signal: ac.signal })
    setTimeout(() => ac.abort(), 200)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})
