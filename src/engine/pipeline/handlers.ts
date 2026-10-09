import {
  Brief, castSchema, CastAnswer, Music, Outline, Review, Script, Sfx, SetsAnswer, setsSchema, ShotActions, Shots, shotId
} from '../../shared/episode'
import type { PuppetSpec, SetLayout, Shot } from '../../shared/episode'
import type { PipelineConfig } from '../../shared/schemas'
import type { HandlerResult, JobContext, Scheduler } from '../queue/scheduler'
import { buildMessages } from './prompts'
import { chatJson } from './llm'
import type { ZodType } from 'zod'
import {
  briefMarkdown, castLine, loadCastCatalog, loadSetCatalog, normalizeScript, renderScript, scriptMarkdown, setLine, TYPE_GUIDANCE, vocabVars
} from './catalog'
import type { EpisodeStore } from './episodeStore'
import { qaResult, validateEpisode } from './qa'
import { fitShotDurations, repairActions } from './repair'

export interface HandlerDeps {
  dataDir: string
  store: EpisodeStore
  getConfig: () => PipelineConfig
  log: (message: string) => void
}

/** Tasks of the story crew that call a model, and the QA check. `fix_<task>` reuses the prompt of `<task>` with the QA notes. */
export const LLM_TASKS = ['brief', 'outline', 'script', 'review', 'rewrite', 'cast', 'sets', 'shots', 'actions', 'music', 'sfx'] as const

const json = (v: unknown) => JSON.stringify(v, null, 1)

function episodeOf(ctx: JobContext): string {
  const id = ctx.job.episode
  if (!id) throw new Error(`job ${ctx.job.id} has no episode`)
  return id
}

const revisionBlock = (text: string): string => (text.trim() ? `## Changes required\n${text.trim()}\n` : '')
const currentBlock = (value: unknown, revision: string): string =>
  value && revision.trim() ? `## Your previous version\nKeep everything that is fine. Change only what the changes above require, and answer with the complete corrected JSON.\n${json(value)}\n` : ''

async function ask<T>(
  ctx: JobContext,
  d: HandlerDeps,
  role: string,
  task: string,
  vars: Record<string, string | number | undefined | null>,
  schema: ZodType<T>,
  temperature = 0.5
): Promise<{ value: T; family: string }> {
  const { messages } = await buildMessages(d.dataDir, ctx, role, task, { ...vocabVars(), ...vars })
  const r = await chatJson(ctx, messages, schema, { temperature })
  return { value: r.value, family: r.chat.model.family }
}

async function episodeVars(d: HandlerDeps, id: string): Promise<Record<string, string | number>> {
  const m = await d.store.readMeta(id)
  if (!m) throw new Error(`episode ${id} not found`)
  const cfg = d.getConfig()
  return {
    theme: m.meta.theme,
    type: m.meta.type,
    type_guidance: TYPE_GUIDANCE[m.meta.type],
    length_min: m.meta.lengthMin,
    length_sec: Math.round(m.meta.lengthMin * 60),
    shots_min: cfg.shots_min,
    shots_max: cfg.shots_max,
    characters_requested: m.meta.characters.join(', ') || '(none: you choose)'
  }
}

const done = (result: string, resultPath?: string): HandlerResult => ({ result, ...(resultPath ? { resultPath } : {}) })

/** The shots with the script text they cover, one block per shot, for the composer and sound designer. */
export function shotSummary(shots: Shot[], script: Script): string {
  const beats = new Map(script.scenes.flatMap((s) => s.beats.map((b) => [b.id, b] as const)))
  return shots
    .map((s) => {
      const text = s.beats
        .map((id) => beats.get(id))
        .filter((b): b is NonNullable<typeof b> => !!b)
        .map((b) => (b.kind === 'line' ? `${b.character} says (${b.emotion}) "${b.text}"` : b.text))
        .join(' / ')
      return `- ${s.id}: ${s.duration} s, scene ${s.sceneId}, set ${s.setId}, ${s.framing}, cast ${s.cast.join('+')}. ${s.notes ? s.notes + ' ' : ''}Story: ${text || '(no beats listed)'}`
    })
    .join('\n')
}

export function registerStoryHandlers(scheduler: Scheduler, d: HandlerDeps): void {
  const { store } = d

  // ---- producer ----
  const brief = async (ctx: JobContext): Promise<HandlerResult> => {
    const id = episodeOf(ctx)
    const cast = await loadCastCatalog(d.dataDir, d.log)
    const sets = await loadSetCatalog(d.dataDir, d.log)
    const ev = await episodeVars(d, id)
    const r = await ask(ctx, d, 'producer', 'brief', {
      ...ev,
      cast_catalog: cast.map((c) => castLine(c.spec, c.description)).join('\n') || '(the catalog is empty: design guests)',
      set_catalog: sets.map((s) => setLine(s.spec, s.description)).join('\n') || '(the catalog is empty: describe new locations)'
    }, Brief, 0.8)
    const meta = (await store.readMeta(id))!.meta
    const b = r.value
    const castIds = new Set(cast.map((c) => c.spec.id))
    const setIds = new Set(sets.map((s) => s.spec.id))
    const guests = b.guests.filter((g) => !castIds.has(g.id))
    const newLocations = b.newLocations.filter((g) => !setIds.has(g.id))
    const allCast = new Set([...castIds, ...guests.map((g) => g.id)])
    const allSets = new Set([...setIds, ...newLocations.map((g) => g.id)])
    const picked = [...new Set([...meta.characters.filter((c) => castIds.has(c)), ...b.cast.filter((c) => allCast.has(c))])]
    const locations = [...new Set(b.locations.filter((l) => allSets.has(l)))]
    const fixed: Brief = {
      ...b,
      guests,
      newLocations,
      cast: picked.length ? picked : [...castIds].slice(0, 3),
      locations: locations.length ? locations : [...allSets].slice(0, 2),
      lengthSec: Math.round(meta.lengthMin * 60)
    }
    if (fixed.cast.length === 0 || fixed.locations.length === 0) throw new Error('the brief has no usable cast or locations')
    await store.writeJson(id, 'brief.json', fixed)
    await store.writeText(id, 'brief.md', briefMarkdown(fixed))
    await store.setTitle(id, fixed.title)
    ctx.emit({ type: 'asset.ready', episode: id, kind: 'brief', path: store.rel(id, 'brief.md') })
    return done(`Brief: "${fixed.title}": ${fixed.logline}`, store.rel(id, 'brief.json'))
  }

  // ---- screenwriter ----
  const outline = async (ctx: JobContext): Promise<HandlerResult> => {
    const id = episodeOf(ctx)
    const b = await store.readValid(id, 'brief.json', Brief)
    const cast = await loadCastCatalog(d.dataDir, d.log)
    const sets = await loadSetCatalog(d.dataDir, d.log)
    const r = await ask(ctx, d, 'screenwriter', 'outline', {
      ...(await episodeVars(d, id)),
      brief: json(b),
      cast_catalog: castCatalogFor(b, cast.map((c) => castLine(c.spec, c.description))),
      set_catalog: sets.map((s) => setLine(s.spec, s.description)).join('\n')
    }, Outline, 0.8)
    const known = new Set(b.locations)
    const o: Outline = { ...r.value, sections: r.value.sections.map((s) => (known.has(s.setId) ? s : { ...s, setId: b.locations[0]! })) }
    await store.writeJson(id, 'outline.json', o)
    await store.writeText(id, 'outline.md', outlineMarkdown(o))
    return done(`Outline with ${o.sections.length} sections`, store.rel(id, 'outline.json'))
  }

  const castCatalogFor = (b: Brief, lines: string[]): string =>
    [...lines, ...b.guests.map((g) => `- ${g.id} (${g.name}): GUEST, to be designed. ${g.description}`)].join('\n')

  const outlineMarkdown = (o: Outline): string =>
    [`# ${o.title}`, ...o.sections.flatMap((s) => ['', `## ${s.name} (${s.setId}, about ${s.approxSec} s)`, s.summary, ...s.beats.map((x) => `- ${x}`)])].join('\n')

  const writeScript = async (id: string, script: Script): Promise<void> => {
    const cast = (await store.readJson(id, 'cast.json')) as { id?: string; name?: string }[] | null
    const catalog = await loadCastCatalog(d.dataDir)
    const names: Record<string, string> = Object.fromEntries(catalog.map((c) => [c.spec.id, c.spec.name]))
    for (const c of cast ?? []) if (c.id && c.name) names[c.id] = c.name
    const b = (await store.readJson(id, 'brief.json')) as { guests?: { id: string; name: string }[] } | null
    for (const g of b?.guests ?? []) names[g.id] = g.name
    await store.writeJson(id, 'script.json', script)
    await store.writeText(id, 'script.md', scriptMarkdown(script, names))
    await store.setTitle(id, script.title)
  }

  const script = async (ctx: JobContext): Promise<HandlerResult> => {
    const id = episodeOf(ctx)
    const b = await store.readValid(id, 'brief.json', Brief)
    const o = await store.readValid(id, 'outline.json', Outline)
    const cast = await loadCastCatalog(d.dataDir, d.log)
    const sets = await loadSetCatalog(d.dataDir, d.log)
    const r = await ask(ctx, d, 'screenwriter', 'script', {
      ...(await episodeVars(d, id)),
      brief: json(b),
      outline: json(o),
      cast_catalog: castCatalogFor(b, cast.filter((c) => b.cast.includes(c.spec.id)).map((c) => castLine(c.spec, c.description))),
      set_catalog: sets.filter((s) => b.locations.includes(s.spec.id)).map((s) => setLine(s.spec, s.description)).join('\n') +
        '\n' + b.newLocations.map((l) => `- ${l.id} (${l.name}): NEW location. ${l.description}`).join('\n')
    }, Script, 0.85)
    const s = normalizeScript(r.value)
    await writeScript(id, s)
    await store.writeJson(id, 'notes/writer.json', { family: r.family, agent: ctx.agent.id })
    ctx.emit({ type: 'asset.ready', episode: id, kind: 'script', path: store.rel(id, 'script.md') })
    return done(`Script "${s.title}": ${s.scenes.length} scenes, ${s.scenes.reduce((n, sc) => n + sc.beats.length, 0)} beats`, store.rel(id, 'script.json'))
  }

  // ---- story editor ----
  const review = async (ctx: JobContext): Promise<HandlerResult> => {
    const id = episodeOf(ctx)
    const n = ctx.job.round
    const b = await store.readValid(id, 'brief.json', Brief)
    const s = await store.readValid(id, 'script.json', Script)
    const r = await ask(ctx, d, 'story_editor', 'review', {
      ...(await episodeVars(d, id)),
      brief: json(b),
      script: renderScript(s),
      line_count: s.scenes.reduce((c, sc) => c + sc.beats.filter((x) => x.kind === 'line').length, 0),
      review_round: n
    }, Review, 0.3)
    const out = { ...r.value, source: 'editor' as const }
    await store.writeJson(id, `reviews/review-${n}.json`, out)
    return done(`Review ${n}: ${out.verdict}. ${out.summary}`, store.rel(id, `reviews/review-${n}.json`))
  }

  const rewrite = async (ctx: JobContext): Promise<HandlerResult> => {
    const id = episodeOf(ctx)
    const n = ctx.job.round
    const b = await store.readValid(id, 'brief.json', Brief)
    const cur = await store.readValid(id, 'script.json', Script)
    const rv = await store.readValid(id, `reviews/review-${n}.json`, Review)
    const o = await store.readJson(id, 'outline.json')
    const r = await ask(ctx, d, 'screenwriter', 'rewrite', {
      ...(await episodeVars(d, id)),
      brief: json(b),
      outline: json(o),
      script: renderScript(cur),
      script_json: json(cur),
      review: json(rv),
      review_source: rv.source === 'user' ? 'the person who commissioned the episode' : 'the story editor'
    }, Script, 0.8)
    const s = normalizeScript(r.value)
    await store.writeJson(id, `reviews/script-before-${n}.json`, cur)
    await writeScript(id, s)
    await store.writeJson(id, 'notes/writer.json', { family: r.family, agent: ctx.agent.id })
    return done(`Rewrote the script after review ${n}`, store.rel(id, 'script.json'))
  }

  // ---- designers ----
  const cast = async (ctx: JobContext, revision = ''): Promise<HandlerResult> => {
    const id = episodeOf(ctx)
    const b = await store.readValid(id, 'brief.json', Brief)
    const sc = await store.readValid(id, 'script.json', Script)
    const catalog = await loadCastCatalog(d.dataDir, d.log)
    const speakers = new Map<string, number>()
    for (const scene of sc.scenes) for (const x of scene.beats) if (x.kind === 'line' && x.character) speakers.set(x.character, (speakers.get(x.character) ?? 0) + 1)
    const current = (await store.readJson(id, 'cast.json')) as PuppetSpec[] | null
    const r = await ask(ctx, d, 'character_designer', 'cast', {
      ...(await episodeVars(d, id)),
      brief: json(b),
      cast_catalog: catalog.map((c) => castLine(c.spec, c.description)).join('\n') || '(the catalog is empty: design everyone as guests)',
      needed: [...new Set([...b.cast, ...speakers.keys(), ...sc.scenes.flatMap((s) => s.beats.map((x) => x.character ?? '').filter(Boolean))])].join(', '),
      speakers: [...speakers].map(([k, v]) => `${k} (${v} lines)`).join(', '),
      guests: json(b.guests),
      revision: revisionBlock(revision),
      current: currentBlock(current, revision)
    }, CastAnswer, 0.6)
    const byId = new Map(catalog.map((c) => [c.spec.id, c.spec]))
    const out = new Map<string, PuppetSpec>()
    for (const p of r.value.picks) {
      const spec = byId.get(p)
      if (spec) out.set(spec.id, spec)
    }
    for (const g of r.value.guests) if (!byId.has(g.id)) out.set(g.id, g)
    // everyone in the brief who is in the catalog stays in, even if the model forgot to pick them
    for (const c of b.cast) if (byId.has(c) && !out.has(c)) out.set(c, byId.get(c)!)
    const list = castSchema.parse([...out.values()])
    await store.writeJson(id, 'cast.json', list)
    return done(`Cast: ${list.map((p) => p.id).join(', ')}`, store.rel(id, 'cast.json'))
  }

  const sets = async (ctx: JobContext, revision = ''): Promise<HandlerResult> => {
    const id = episodeOf(ctx)
    const b = await store.readValid(id, 'brief.json', Brief)
    const sc = await store.readValid(id, 'script.json', Script)
    const catalog = await loadSetCatalog(d.dataDir, d.log)
    const needed = [...new Set([...sc.scenes.map((s) => s.setId), ...b.locations])]
    const current = (await store.readJson(id, 'sets.json')) as SetLayout[] | null
    const r = await ask(ctx, d, 'set_designer', 'sets', {
      ...(await episodeVars(d, id)),
      brief: json(b),
      set_catalog: catalog.map((c) => setLine(c.spec, c.description, true)).join('\n') || '(the catalog is empty: compose every set)',
      needed: needed.join(', '),
      script_scenes: sc.scenes.map((s) => `${s.id} in ${s.setId}: ${s.summary}`).join('\n'),
      new_locations: json(b.newLocations),
      revision: revisionBlock(revision),
      current: currentBlock(current, revision)
    }, SetsAnswer, 0.6)
    const byId = new Map(catalog.map((c) => [c.spec.id, c.spec]))
    const out = new Map<string, SetLayout>()
    for (const p of r.value.picks) {
      const spec = byId.get(p)
      if (spec) out.set(spec.id, spec)
    }
    for (const c of r.value.custom) if (!byId.has(c.id)) out.set(c.id, c)
    for (const n of needed) if (byId.has(n) && !out.has(n)) out.set(n, byId.get(n)!)
    const list = setsSchema.parse([...out.values()])
    await store.writeJson(id, 'sets.json', list)
    return done(`Sets: ${list.map((p) => p.id).join(', ')}`, store.rel(id, 'sets.json'))
  }

  // ---- director ----
  const shots = async (ctx: JobContext, revision = ''): Promise<HandlerResult> => {
    const id = episodeOf(ctx)
    const sc = await store.readValid(id, 'script.json', Script)
    const castList = await store.readValid(id, 'cast.json', castSchema)
    const setList = await store.readValid(id, 'sets.json', setsSchema)
    const current = await store.readJson(id, 'shots.json')
    const r = await ask(ctx, d, 'director', 'shots', {
      ...(await episodeVars(d, id)),
      script: renderScript(sc),
      cast: castList.map((c) => castLine(c)).join('\n'),
      sets: setList.map((s) => setLine(s, '', true)).join('\n'),
      revision: revisionBlock(revision),
      current: currentBlock(current, revision)
    }, Shots, 0.5)
    const fitted = fitShotDurations(r.value.shots, (await store.readMeta(id))!.meta.lengthMin * 60)
    if (fitted.note) ctx.log(fitted.note)
    const list = { shots: fitted.shots.map((s, i) => ({ ...s, id: shotId(i + 1) })) }
    await store.writeJson(id, 'shots.json', list)
    ctx.emit({ type: 'asset.ready', episode: id, kind: 'shots', path: store.rel(id, 'shots.json') })
    return done(`${list.shots.length} shots, ${Math.round(list.shots.reduce((n, s) => n + s.duration, 0))} s in total`, store.rel(id, 'shots.json'))
  }

  // ---- animator ----
  const actions = async (ctx: JobContext, revision = ''): Promise<HandlerResult> => {
    const id = episodeOf(ctx)
    const unit = ctx.job.unit
    if (!unit) throw new Error('the actions job needs a shot id as its unit')
    const shotsFile = await store.readValid(id, 'shots.json', Shots)
    const shot = shotsFile.shots.find((s) => s.id === unit)
    if (!shot) throw new Error(`shot ${unit} is not in shots.json`)
    const sc = await store.readValid(id, 'script.json', Script)
    const castList = await store.readValid(id, 'cast.json', castSchema)
    const setList = await store.readValid(id, 'sets.json', setsSchema)
    const set = setList.find((s) => s.id === shot.setId)
    const beats = new Map(sc.scenes.flatMap((s) => s.beats.map((b) => [b.id, b] as const)))
    const lines = sc.scenes.flatMap((s) => s.beats).filter((b) => b.kind === 'line' && b.lineId && shot.lines.includes(b.lineId))
    const current = await store.readJson(id, 'actions', `${unit}.json`)
    const r = await ask(ctx, d, 'animator', 'actions', {
      ...(await episodeVars(d, id)),
      shot: json(shot),
      shot_id: shot.id,
      duration: shot.duration,
      set: set ? setLine(set, '', true) : `${shot.setId} (unknown set)`,
      cast: castList.filter((c) => shot.cast.includes(c.id)).map((c) => castLine(c)).join('\n'),
      shot_story: shot.beats.map((b) => beats.get(b)).filter((b): b is NonNullable<typeof b> => !!b).map((b) => (b.kind === 'line' ? `- LINE ${b.lineId} ${b.character} [${b.emotion}]: "${b.text}"` : `- ACTION: ${b.text}`)).join('\n'),
      shot_lines: lines.map((b) => `- ${b.lineId}: ${b.character} [${b.emotion}] "${b.text}"`).join('\n') || '(no lines in this shot)',
      revision: revisionBlock(revision),
      current: currentBlock(current, revision)
    }, ShotActions, 0.5)
    const repaired = repairActions(shot, r.value.actions, lines.map((b) => ({ lineId: b.lineId!, character: b.character ?? '', text: b.text })))
    if (repaired.notes.length > 0) ctx.log(`repaired ${shot.id}: ${repaired.notes.join('; ')}`)
    const out = { shotId: shot.id, actions: repaired.actions }
    await store.writeJson(id, `actions/${shot.id}.json`, out)
    return done(`${out.actions.length} actions for ${shot.id}`, store.rel(id, `actions/${shot.id}.json`))
  }

  // ---- composer and sound designer ----
  const music = async (ctx: JobContext, revision = ''): Promise<HandlerResult> => {
    const id = episodeOf(ctx)
    const b = await store.readValid(id, 'brief.json', Brief)
    const sc = await store.readValid(id, 'script.json', Script)
    const shotsFile = await store.readValid(id, 'shots.json', Shots)
    const current = await store.readJson(id, 'music.json')
    const r = await ask(ctx, d, 'composer', 'music', {
      ...(await episodeVars(d, id)),
      brief: json(b),
      shots: shotSummary(shotsFile.shots, sc),
      shot_ids: shotsFile.shots.map((s) => s.id).join(', '),
      revision: revisionBlock(revision),
      current: currentBlock(current, revision)
    }, Music, 0.7)
    await store.writeJson(id, 'music.json', r.value)
    return done(`Music: ${r.value.cues.length} cues at ${r.value.tempo} bpm`, store.rel(id, 'music.json'))
  }

  const sfx = async (ctx: JobContext, revision = ''): Promise<HandlerResult> => {
    const id = episodeOf(ctx)
    const sc = await store.readValid(id, 'script.json', Script)
    const shotsFile = await store.readValid(id, 'shots.json', Shots)
    const castList = await store.readValid(id, 'cast.json', castSchema)
    const current = await store.readJson(id, 'sfx.json')
    const r = await ask(ctx, d, 'sound_designer', 'sfx', {
      ...(await episodeVars(d, id)),
      shots: shotSummary(shotsFile.shots, sc),
      cast: castList.map((c) => `- ${c.id} (${c.name}): ${c.body}, voice ${JSON.stringify(c.voice)}`).join('\n'),
      revision: revisionBlock(revision),
      current: currentBlock(current, revision)
    }, Sfx, 0.6)
    // every character gets a voice: the model's choice, else the voice in the puppet spec
    const voices = { ...r.value.voices }
    for (const c of castList) voices[c.id] = voices[c.id] ?? c.voice
    const out = { ...r.value, voices }
    await store.writeJson(id, 'sfx.json', out)
    return done(`Sound: ${out.cues.length} cues, ${Object.keys(voices).length} voices`, store.rel(id, 'sfx.json'))
  }

  // ---- QA (deterministic) ----
  const qa = async (ctx: JobContext): Promise<HandlerResult> => {
    const id = episodeOf(ctx)
    const m = (await store.readMeta(id))!.meta
    const cfg = d.getConfig()
    const shotsRaw = await store.readJson(id, 'shots.json')
    const shotIds = Array.isArray((shotsRaw as { shots?: unknown } | null)?.shots)
      ? ((shotsRaw as { shots: { id?: unknown }[] }).shots.map((s) => s.id).filter((x): x is string => typeof x === 'string'))
      : []
    const acts: Record<string, unknown> = {}
    // A fix_shots job can shorten shots after their actions were written: trim those actions to the shots as they are now.
    const parsedShots = Shots.safeParse(shotsRaw)
    const parsedScript = Script.safeParse(await store.readJson(id, 'script.json'))
    const scriptLines = parsedScript.success
      ? parsedScript.data.scenes.flatMap((sc) => sc.beats).flatMap((b) => (b.kind === 'line' && b.lineId ? [{ lineId: b.lineId, character: b.character ?? '', text: b.text }] : []))
      : []
    for (const s of shotIds) {
      let raw = await store.readJson(id, 'actions', `${s}.json`)
      const shot = parsedShots.success ? parsedShots.data.shots.find((x) => x.id === s) : undefined
      const file = ShotActions.safeParse(raw)
      if (shot && file.success) {
        const rep = repairActions(shot, file.data.actions, scriptLines)
        if (rep.notes.length > 0) {
          raw = { shotId: file.data.shotId, actions: rep.actions }
          await store.writeJson(id, `actions/${s}.json`, raw)
          ctx.log(`repaired ${s}: ${rep.notes.join('; ')}`)
        }
      }
      acts[s] = raw
    }
    const issues = validateEpisode({
      cast: await store.readJson(id, 'cast.json'),
      sets: await store.readJson(id, 'sets.json'),
      script: await store.readJson(id, 'script.json'),
      shots: shotsRaw,
      actions: acts,
      music: await store.readJson(id, 'music.json'),
      sfx: await store.readJson(id, 'sfx.json'),
      targetSec: m.lengthMin * 60,
      shotsMin: cfg.shots_min,
      shotsMax: cfg.shots_max
    })
    const result = qaResult(issues, ctx.job.round)
    await store.writeJson(id, 'qa.json', result)
    for (const i of issues) ctx.log(`- [${i.severity}] ${i.task}${i.unit ? ' ' + i.unit : ''}: ${i.message}`)
    return done(issues.length === 0 ? 'QA passed: nothing to fix' : `QA found ${issues.length} problem(s) in ${new Set(issues.map((i) => i.task)).size} area(s)`, store.rel(id, 'qa.json'))
  }

  /** The user's note (a change request at the animatic) arrives as the job body of `shots` and `actions`. */
  const userNote = (ctx: JobContext): string => (ctx.jobBody.trim() ? `The person who commissioned the episode watched the animatic and asked for these changes: ${ctx.jobBody.trim()}` : '')
  const reg = (task: string, fn: (ctx: JobContext) => Promise<HandlerResult>, opts: { reviewing?: boolean; deterministic?: boolean } = {}) => scheduler.register(task, fn, opts)

  reg('brief', brief)
  reg('outline', outline)
  reg('script', script)
  reg('review', review, { reviewing: true })
  reg('rewrite', rewrite)
  reg('cast', (ctx) => cast(ctx))
  reg('sets', (ctx) => sets(ctx))
  reg('shots', (ctx) => shots(ctx, userNote(ctx)))
  reg('actions', (ctx) => actions(ctx, userNote(ctx)))
  reg('music', (ctx) => music(ctx))
  reg('sfx', (ctx) => sfx(ctx))
  reg('qa', qa, { reviewing: true, deterministic: true })
  reg('fix_cast', (ctx) => cast(ctx, ctx.jobBody))
  reg('fix_sets', (ctx) => sets(ctx, ctx.jobBody))
  reg('fix_shots', (ctx) => shots(ctx, ctx.jobBody))
  reg('fix_actions', (ctx) => actions(ctx, ctx.jobBody))
  reg('fix_music', (ctx) => music(ctx, ctx.jobBody))
  reg('fix_sfx', (ctx) => sfx(ctx, ctx.jobBody))
}
