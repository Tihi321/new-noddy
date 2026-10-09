import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMd } from '../../src/shared/md'
import { SetLayout } from '../../src/shared/episode'
import { validateEpisode } from '../../src/engine/pipeline/qa'

const base = { cast: null, script: null, shots: null, actions: {}, music: null, sfx: null, targetSec: 60, shotsMin: 1, shotsMax: 9 }

function markIssues(set: unknown) {
  return validateEpisode({ ...base, sets: [set] }).filter((i) => i.code === 'mark_in_prop')
}

describe('marks inside props', () => {
  it('warns when a mark is inside a hill', () => {
    const set = SetLayout.parse({ id: 'h', name: 'H', props: [{ kind: 'hill', pos: [0, 4.2], scale: 1.7, id: 'big_hill' }], marks: { center: [0, 0], hill_foot: [0, 1.9] } })
    const issues = markIssues(set)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('hill_foot')
  })
  it('no seed set has a mark inside one of its props', () => {
    const dir = path.resolve(__dirname, '../../seed/sets')
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const doc = parseMd(readFileSync(path.join(dir, f), 'utf8'), f)
      const set = SetLayout.parse(doc.data)
      expect(markIssues(set).map((i) => i.message), f).toEqual([])
    }
  })
})
