import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../../src/engine/pipeline/catalog'
import { PuppetSpec, SetLayout } from '../../src/shared/episode'
import { seedDir } from '../helpers'

/** Every seed/cast and seed/sets file must load through the catalog loader (the frontmatter is the spec). */
async function check(folder: 'cast' | 'sets', load: (log: (m: string) => void) => Promise<{ spec: { id: string } }[]>): Promise<void> {
  const files = (await readdir(path.join(seedDir, folder)).catch(() => [] as string[])).filter((f) => f.endsWith('.md'))
  const problems: string[] = []
  const loaded = await load((m) => problems.push(m))
  expect(problems).toEqual([])
  expect(loaded).toHaveLength(files.length)
  for (const f of files) expect(loaded.some((c) => c.spec.id === f.slice(0, -3)), `${f}: id matches the file name`).toBe(true)
}

describe('seed catalogs', () => {
  // the seed folder has the same layout as a data folder, so it can be loaded as one
  it('every seed/cast file is a PuppetSpec', () => check('cast', (log) => loadCatalog(seedDir, 'cast', PuppetSpec, log)))
  it('every seed/sets file is a SetLayout', () => check('sets', (log) => loadCatalog(seedDir, 'sets', SetLayout, log)))
})
