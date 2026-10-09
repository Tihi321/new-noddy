import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ZodType } from 'zod'
import {
  ACCESSORIES, ACTIONS, ANGLES, BACKDROPS, BODIES, CAMERA_MOVES, EARS, EMOTIONS, EYES, FRAMINGS, GROUNDS, HATS, HELD_PROPS, INSTRUMENTS,
  LIGHTINGS, MATERIALS, NOSES, PROP_KINDS, PuppetSpec, SetLayout, SFX_CUES, TIMBRES, TRANSITIONS_IN, TRANSITIONS_OUT, VEHICLE_KINDS
} from '../../shared/episode'
import type { Brief, Script } from '../../shared/episode'
import { parseMd } from '../../shared/md'
import type { EpisodeType } from '../../shared/protocol'

export interface CatalogEntry<T> {
  spec: T
  /** The markdown body of the file: who this is, what the place looks like. */
  description: string
}

/** Reads `cast/*.md` or `sets/*.md` of the data folder: the frontmatter is the spec, the body is the description. Invalid files are reported and skipped. */
export async function loadCatalog<T>(dataDir: string, folder: 'cast' | 'sets', schema: ZodType<T>, log?: (m: string) => void): Promise<CatalogEntry<T>[]> {
  const dir = path.join(dataDir, folder)
  let names: string[]
  try {
    names = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return []
  }
  const out: CatalogEntry<T>[] = []
  for (const n of names) {
    try {
      const doc = parseMd(await fs.readFile(path.join(dir, n), 'utf8'), `${folder}/${n}`)
      const r = schema.safeParse(doc.data)
      if (r.success) out.push({ spec: r.data, description: doc.body.trim() })
      else log?.(`${folder}/${n}: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')} (skipped)`)
    } catch (err) {
      log?.(`${folder}/${n}: ${(err as Error).message} (skipped)`)
    }
  }
  return out
}

export const loadCastCatalog = (dataDir: string, log?: (m: string) => void) => loadCatalog(dataDir, 'cast', PuppetSpec, log)
export const loadSetCatalog = (dataDir: string, log?: (m: string) => void) => loadCatalog(dataDir, 'sets', SetLayout, log)

const oneLine = (s: string, max = 220): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

export function castLine(p: PuppetSpec, description = ''): string {
  const bits = [p.body, p.material, p.hat !== 'none' ? `${p.hat.replace('_', ' ')} hat` : '', ...p.accessories, p.vehicle ? `drives a ${p.vehicle.kind}` : ''].filter(Boolean)
  return `- ${p.id} (${p.name}): ${bits.join(', ')}${description ? '. ' + oneLine(description) : ''}`
}

export function setLine(s: SetLayout, description = '', detailed = false): string {
  const props = s.props.filter((p) => p.id).map((p) => `${p.id}(${p.kind})`)
  const head = `- ${s.id} (${s.name}): ${s.ground} ground, ${s.backdrop}, ${s.lighting} light${description ? '. ' + oneLine(description) : ''}`
  if (!detailed) return head
  return `${head}\n    marks: ${Object.entries(s.marks).map(([k, v]) => `${k}=[${v.join(', ')}]`).join(' ') || 'none'}\n    targetable props: ${props.join(', ') || 'none'}\n    size: ${s.size.join(' x ')}`
}

/** The fixed vocabularies, as comma lists, for every prompt (`{{actions}}`, `{{emotions}}`, ...). */
export function vocabVars(): Record<string, string> {
  const j = (a: readonly string[]) => a.join(', ')
  return {
    actions: j(ACTIONS),
    emotions: j(EMOTIONS),
    framings: j(FRAMINGS),
    angles: j(ANGLES),
    camera_moves: j(CAMERA_MOVES),
    prop_kinds: j(PROP_KINDS),
    held_props: j(HELD_PROPS),
    sfx_cues: j(SFX_CUES),
    instruments: j(INSTRUMENTS),
    hats: j(HATS),
    accessories: j(ACCESSORIES),
    bodies: j(BODIES),
    materials: j(MATERIALS),
    grounds: j(GROUNDS),
    backdrops: j(BACKDROPS),
    lightings: j(LIGHTINGS),
    timbres: j(TIMBRES),
    eyes: j(EYES),
    noses: j(NOSES),
    ears: j(EARS),
    vehicle_kinds: j(VEHICLE_KINDS),
    transitions_in: j(TRANSITIONS_IN),
    transitions_out: j(TRANSITIONS_OUT)
  }
}

/** How each episode type shapes the story. */
export const TYPE_GUIDANCE: Record<EpisodeType, string> = {
  adventure:
    'ADVENTURE. A small, gentle journey: someone needs to get somewhere or find something, and the friends travel across Tumbletown to do it. Structure: cold open in town, the goal, setting off, a small obstacle (a bridge, a hill, a muddy road), friends help each other over it, arrival, happy ending. Lots of movement and different places.',
  lesson:
    'LESSON. One kind, simple lesson (sharing, saying sorry, waiting your turn, trying again, asking for help). Structure: cold open in town, a character makes a small mistake or struggles, the first attempts go wrong in a funny way, a friend shows the kind thing to do, the problem is fixed, everybody has learned the lesson without anyone telling it in words. The lesson must be SHOWN by actions.',
  mystery:
    'MYSTERY. A gentle puzzle with nothing scary: where did the missing thing go? Structure: cold open in town, something is missing or strange, clues are found one by one (a footprint, a feather, a trail of flowers), friends follow them, a funny and kind solution (the thing was borrowed by a sleepy hedgehog or blew away in the wind), everybody is relieved and laughing.',
  holiday:
    'HOLIDAY SPECIAL. A cosy, festive day in Tumbletown (a snowy day, a party, a lantern night, a birthday). Structure: cold open of the decorated town, friends prepare, something small goes wrong with the preparations, everyone pitches in, the celebration happens with music and presents, warm happy ending with everyone together.',
  comedy:
    'SILLY COMEDY. A cheerful chain of funny mix-ups with big visible physical gags (a runaway hat, a wobbly tower of boxes, a stuck van, a boing). Structure: cold open in town, one silly problem, every attempt to fix it makes it sillier in a new way, a simple kind idea fixes everything, everybody ends up laughing together.'
}

// ---- script helpers ----

/** Numbers scenes `sc1..`, beats `b1..` (unique in the whole script) and lines `L001..` in story order. */
export function normalizeScript(script: Script): Script {
  let b = 0
  let l = 0
  return {
    ...script,
    scenes: script.scenes.map((sc, i) => ({
      ...sc,
      id: `sc${i + 1}`,
      beats: sc.beats.map((beat) => {
        b++
        if (beat.kind === 'line') {
          l++
          return { ...beat, id: `b${b}`, lineId: `L${String(l).padStart(3, '0')}`, text: beat.text.trim() }
        }
        return { id: `b${b}`, kind: beat.kind, text: beat.text.trim(), ...(beat.emotion ? { emotion: beat.emotion } : {}) }
      })
    }))
  }
}

/** The script for a prompt: every beat with its id, lines with speaker, emotion and line id. */
export function renderScript(script: Script): string {
  const out: string[] = [`TITLE: ${script.title}`, `LOGLINE: ${script.logline}`, `MORAL: ${script.moral}`]
  for (const sc of script.scenes) {
    out.push('', `SCENE ${sc.id} (set ${sc.setId}): ${sc.summary}`)
    for (const b of sc.beats) {
      out.push(b.kind === 'line' ? `  ${b.id} LINE ${b.lineId} ${b.character} [${b.emotion}]: "${b.text}"` : `  ${b.id} ACTION: ${b.text}`)
    }
  }
  return out.join('\n')
}

/** A readable `script.md`. Dialogue is shown as what the audience sees: a mumble, plus what it means. */
export function scriptMarkdown(script: Script, names: Record<string, string> = {}): string {
  const out: string[] = [`# ${script.title}`, '', `_${script.logline}_`, '', `**Moral:** ${script.moral}`]
  for (const sc of script.scenes) {
    out.push('', `## ${sc.id.toUpperCase()}: ${sc.summary}`, '', `Set: ${sc.setId}`, '')
    for (const b of sc.beats) {
      if (b.kind === 'action') out.push(`- *${b.text}*`)
      else out.push(`- **${(names[b.character ?? ''] ?? b.character ?? '').toUpperCase()}** (${b.emotion}, mumbles): "${b.text}"`)
    }
  }
  return out.join('\n')
}

export function briefMarkdown(b: Brief): string {
  const list = (items: string[]) => items.map((i) => `- ${i}`).join('\n')
  return [
    `# ${b.title}`,
    '',
    `_${b.logline}_`,
    '',
    `**Moral:** ${b.moral}`,
    `**Problem:** ${b.problem}`,
    `**Solution:** ${b.solution}`,
    `**Tone:** ${b.tone}`,
    `**Length:** about ${Math.round(b.lengthSec / 60 * 10) / 10} minutes`,
    '',
    '## Cast',
    list(b.cast.map((c) => `${c}${b.guests.find((g) => g.id === c) ? ' (guest)' : ''}`)),
    ...(b.guests.length ? ['', '## Guests', list(b.guests.map((g) => `${g.name} (${g.id}): ${g.description}`))] : []),
    '',
    '## Locations',
    list(b.locations.map((c) => `${c}${b.newLocations.find((g) => g.id === c) ? ' (new)' : ''}`)),
    ...(b.newLocations.length ? ['', '## New locations', list(b.newLocations.map((g) => `${g.name} (${g.id}): ${g.description}`))] : [])
  ].join('\n')
}
