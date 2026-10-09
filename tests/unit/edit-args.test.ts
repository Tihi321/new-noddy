import { describe, expect, it } from 'vitest'
import {
  END_SECONDS,
  TITLE_SECONDS,
  cardClipArgs,
  concatListText,
  contiguousFrames,
  escapeFilterPath,
  finalMuxArgs,
  pickFont,
  shotClipArgs,
  wrapTitle
} from '../../src/engine/tools/handlers/edit'

const base = { pattern: 'r/shot-01/f_%04d.png', frameCount: 48, width: 1280, height: 720, out: 'o.mp4' }
const graph = (a: string[]) => a[a.indexOf('-filter_complex') + 1]!

describe('edit argument builders', () => {
  it('holds each drawn frame for two output frames', () => {
    const a = shotClipArgs({ ...base, transitionIn: 'cut', transitionOut: 'cut' })
    expect(a).toContain('12')
    expect(graph(a)).toContain('fps=24')
    expect(a[a.indexOf('-frames:v') + 1]).toBe('96')
    expect(graph(a)).not.toContain('xfade')
  })
  it('adds iris transitions inside the shot length', () => {
    const a = shotClipArgs({ ...base, transitionIn: 'iris_in', transitionOut: 'iris_out' })
    const g = graph(a)
    expect(g.match(/xfade/g)).toHaveLength(2)
    expect(g).toContain('offset=0')
    expect(g).toContain('offset=3.2') // 4 s shot, 0.8 s iris
    expect(a.filter((x) => x.startsWith('color=c=black'))).toHaveLength(2)
    expect(a[a.indexOf('-frames:v') + 1]).toBe('96')
  })
  it('fades from and to black', () => {
    const g = graph(shotClipArgs({ ...base, transitionIn: 'fade', transitionOut: 'fade' }))
    expect(g).toContain('fade=t=in')
    expect(g).toContain('fade=t=out:st=3.4')
  })
  it('limits a transition of a very short shot to half its length', () => {
    const g = graph(shotClipArgs({ ...base, frameCount: 6, transitionIn: 'iris_in', transitionOut: 'cut' }))
    expect(g).toContain('duration=0.25')
  })
  it('makes cards with text and without', () => {
    const o = { kind: 'title' as const, textFile: 'C:\\t\\title.txt', fontFile: 'C:/Windows/Fonts/comic.ttf', seconds: TITLE_SECONDS, width: 1280, height: 720, out: 'x.mp4' }
    const vf = cardClipArgs(o)[cardClipArgs(o).indexOf('-vf') + 1]!
    expect(vf).toContain("textfile='C\\:/t/title.txt'")
    expect(vf).toContain("fontfile='C\\:/Windows/Fonts/comic.ttf'")
    expect(cardClipArgs(o).join(' ')).toContain(`d=${TITLE_SECONDS}`)
    const none = cardClipArgs({ ...o, kind: 'end', seconds: END_SECONDS, textFile: null })
    expect(none.join(' ')).not.toContain('drawtext')
  })
  it('muxes aac audio and stream-copies the video', () => {
    const a = finalMuxArgs({ listFile: 'l.txt', audio: 'episode.wav', out: 'e.mp4' })
    expect(a).toEqual(expect.arrayContaining(['-c:v', 'copy', '-c:a', 'aac', '-shortest']))
    expect(finalMuxArgs({ listFile: 'l.txt', audio: null, out: 'e.mp4' })).not.toContain('aac')
  })
  it('helpers', () => {
    expect(wrapTitle('Tock and the Windy Day', 12)).toEqual(['Tock and the', 'Windy Day'])
    expect(escapeFilterPath("C:\\a\\b'c")).toBe("C\\:/a/b\\'c")
    expect(concatListText(['C:\\a b\\c.mp4'])).toBe("file 'C:/a b/c.mp4'\n")
    expect(contiguousFrames(['f_0000.png', 'f_0001.png', 'f_0003.png'])).toBe(2)
    expect(pickFont(['a', 'b'], (p) => p === 'b')).toBe('b')
    expect(pickFont(['a'], () => false)).toBeNull()
  })
})
