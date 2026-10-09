import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { Style } from '../../src/shared/episode'
import type { PuppetSpec } from '../../src/shared/episode'
import { assetHash, assetPaths, blenderArgs, parseBlenderLine, puppetJob, renderJob, setJob, stableJson } from '../../src/engine/tools/handlers/blender'

const style = Style.parse({ id: 'toyland-wood' })
const spec = { id: 'tock', name: 'Tock', body: 'peg', material: 'wood' } as unknown as PuppetSpec

describe('blender tool helpers', () => {
  it('hashes independent of key order and sensitive to content', () => {
    const a = assetHash(spec, style)
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(assetHash({ material: 'wood', body: 'peg', name: 'Tock', id: 'tock' } as unknown as PuppetSpec, style)).toBe(a)
    expect(assetHash({ ...spec, material: 'felt' } as PuppetSpec, style)).not.toBe(a)
    expect(assetHash(spec, { ...style, grain: 0.1 })).not.toBe(a)
    expect(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}')
  })

  it('builds asset paths and job json that follow the contract', () => {
    const p = assetPaths('/ep', 'puppets', 'tock', 'abcd1234')
    expect(p.blend).toBe(path.join('/ep', 'assets', 'puppets', 'tock-abcd1234.blend'))
    expect(p.glb.endsWith('tock-abcd1234.glb')).toBe(true)
    expect(puppetJob(spec, style, p)).toMatchObject({ kind: 'build_puppet', out_blend: p.blend, out_glb: p.glb })
    expect(setJob({ id: 's' } as never, style, p)).toMatchObject({ kind: 'build_set', layout: { id: 's' } })
    expect(renderJob({ tracks: 't.json', puppets: { tock: 'a.blend' }, set: 's.blend', style, preset: 'final', outDir: 'out' })).toMatchObject({
      kind: 'render_shot',
      preset: 'final',
      out_dir: 'out',
      frames: null,
      resume: true
    })
    expect(blenderArgs('run.py', 'j.json')).toEqual(['-b', '--factory-startup', '--python', 'run.py', '--', 'j.json'])
  })

  it('parses the stdout protocol', () => {
    expect(parseBlenderLine('@@PROGRESS {"done": 12, "total": 144, "label": "shot-01"}')).toEqual({ kind: 'progress', done: 12, total: 144, label: 'shot-01' })
    expect(parseBlenderLine('@@DONE {"outputs": ["a"]}')).toEqual({ kind: 'done', outputs: ['a'] })
    expect(parseBlenderLine('@@ERROR {"message": "boom"}')).toEqual({ kind: 'error', message: 'boom' })
    expect(parseBlenderLine('Fra:1 Mem:10M')).toBeNull()
    expect(parseBlenderLine('@@PROGRESS {bad')).toBeNull()
  })
})
