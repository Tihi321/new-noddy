import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMdWith } from '../../src/shared/md'
import { agentSchema, CONFIG_FILES, LLM_ROLES, pipelineSchema, rolesSchema, schemasByKind, TOOL_ROLES } from '../../src/shared/schemas'
import { seedDir } from '../helpers'

const ROOMS = ['writers_room', 'art_dept', 'stage', 'sound_booth', 'workshop', 'render_farm', 'edit_suite']

describe('seed', () => {
  it('every config file parses against its schema', async () => {
    for (const name of CONFIG_FILES) {
      const text = await readFile(path.join(seedDir, 'config', `${name}.md`), 'utf8')
      expect(() => parseMdWith(text, schemasByKind[name], name), name).not.toThrow()
    }
  })

  it('pipeline defaults match the plan', async () => {
    const p = parseMdWith(await readFile(path.join(seedDir, 'config', 'pipeline.md'), 'utf8'), pipelineSchema).data
    expect(p).toMatchObject({ target_length_min: 5, shots_min: 15, shots_max: 25, fps: 12, output_fps: 24, approvals: { script: true, animatic: true } })
    expect(p.render.preview).toMatchObject({ width: 640, height: 360 })
    expect(p.render.final).toMatchObject({ width: 1280, height: 720 })
  })

  it('roles.md has one entry for each LLM role', async () => {
    const r = parseMdWith(await readFile(path.join(seedDir, 'config', 'roles.md'), 'utf8'), rolesSchema).data
    expect(Object.keys(r.roles).sort()).toEqual([...LLM_ROLES].sort())
    expect(r.roles.producer!.models[0]).toBe('anthropic/claude-sonnet-5-5')
    expect(r.roles.director!.models[0]).toBe('strata/qwen3.8-flash-next')
  })

  it('the 16 crew files are valid, cover every role once and sit in a known room', async () => {
    const files = (await readdir(path.join(seedDir, 'agents'))).filter((f) => f.endsWith('.md'))
    expect(files).toHaveLength(16)
    const roles: string[] = []
    for (const f of files) {
      const doc = parseMdWith(await readFile(path.join(seedDir, 'agents', f), 'utf8'), agentSchema, f)
      roles.push(doc.data.role)
      expect(ROOMS, f).toContain(doc.data.room)
      expect(doc.body.trim().length, f).toBeGreaterThan(40)
      expect(doc.data.kind === 'tool', f).toBe((TOOL_ROLES as readonly string[]).includes(doc.data.role))
    }
    expect(roles.sort()).toEqual([...LLM_ROLES, ...TOOL_ROLES].sort())
  })

  it('the shared rules say kids-safe and JSON only', async () => {
    const text = await readFile(path.join(seedDir, 'prompts', '_rules.md'), 'utf8')
    expect(text).toMatch(/ages 3 to 6/)
    expect(text).toMatch(/JSON/)
  })
})
