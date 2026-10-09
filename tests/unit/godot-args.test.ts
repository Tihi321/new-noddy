import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { animaticArgs, findGlb, godotInteractiveArgs, godotMovieArgs, godotThumbArgs, previewEncodeArgs, thumbExtractArgs } from '../../src/engine/tools/handlers/godot'

const inputs = { projectDir: 'godot/preview', tracks: 't.json', setGlb: 's.glb', puppets: { tock: 'tock.glb', bobbin: 'b.glb' } }

describe('godot argument builders', () => {
  it('movie mode follows the contract', () => {
    const a = godotMovieArgs({ ...inputs, out: 'o.avi' })
    expect(a.slice(0, 9)).toEqual(['--path', 'godot/preview', '--write-movie', 'o.avi', '--fixed-fps', '12', '--resolution', '640x360', '--'])
    expect(a.slice(9)).toEqual(['--tracks', 't.json', '--set', 's.glb', '--puppet', 'tock=tock.glb', '--puppet', 'bobbin=b.glb'])
  })
  it('thumbnail and interactive modes', () => {
    const t = godotThumbArgs({ ...inputs, out: 'x.png', frame: 7 })
    expect(t).not.toContain('--write-movie')
    expect(t.slice(-4)).toEqual(['--thumb', 'x.png', '--frame', '7'])
    expect(godotInteractiveArgs(inputs)).not.toContain('--thumb')
  })
  it('encodes at 24 fps from 12 with exact length', () => {
    const a = previewEncodeArgs({ avi: 'a.avi', frames: 48, audio: 'a.wav', out: 'o.mp4' })
    expect(a[a.indexOf('-frames:v') + 1]).toBe('96')
    expect(a[a.indexOf('-t') + 1]).toBe('4')
    expect(a).toContain('fps=24,format=yuv420p')
    expect(previewEncodeArgs({ avi: 'a.avi', frames: 48, audio: null, out: 'o.mp4' })).toContain('anullsrc=r=48000:cl=stereo')
  })
  it('thumb extraction and animatic', () => {
    expect(thumbExtractArgs({ video: 'a.avi', frame: 5, out: 'p.png' })).toContain('select=eq(n\\,5)')
    const a = animaticArgs({ listFile: 'l.txt', audio: 'e.wav', out: 'a.mp4' })
    expect(a).toEqual(expect.arrayContaining(['-map', '1:a:0', '-shortest']))
    expect(animaticArgs({ listFile: 'l.txt', audio: null, out: 'a.mp4' })).not.toContain('-shortest')
  })
  it('finds the newest glb of an id', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'glb-'))
    try {
      await writeFile(path.join(dir, 'tock-aaaaaaaa.glb'), 'x')
      await writeFile(path.join(dir, 'tock-bbbbbbbb.glb'), 'x')
      await writeFile(path.join(dir, 'tockjr-cccccccc.glb'), 'x')
      await utimes(path.join(dir, 'tock-aaaaaaaa.glb'), new Date(), new Date(Date.now() + 5000))
      expect(await findGlb(dir, 'tock')).toBe(path.join(dir, 'tock-aaaaaaaa.glb'))
      expect(await findGlb(dir, 'nope')).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
