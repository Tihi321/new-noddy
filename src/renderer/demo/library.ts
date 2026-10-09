/** Made-up episode data for the fake engine: briefs, scripts, shots, in the shapes of docs/contracts.md. */
import type { Brief, Script, Shot, Shots } from '../../shared/episode'
import type { AgentSummary, EpisodeType, ModelSummary } from '../../shared/protocol'

export const CAST_NAMES: Record<string, string> = {
  tock: 'Tock',
  bobbin: 'Bobbin',
  constable_buttons: 'Constable Buttons',
  granny_thimble: 'Granny Thimble',
  moo_moo: 'Moo Moo',
  squibble_a: 'Squibble',
  squibble_b: 'Squabble'
}

export const SETS: Record<string, string> = {
  town_square: 'Tumbletown Square',
  bakery: "Granny's Bakery",
  meadow: 'Buttercup Meadow',
  pond: 'Duck Pond'
}

interface AgentDef {
  id: string
  name: string
  role: string
  kind: 'llm' | 'tool'
  room: string
  model: string | null
}

const SONNET = 'anthropic/claude-sonnet-5-5'
const QWEN35 = 'lmstudio/nail-qwen3.6-35b-a3b-mtp'
const QWEN27 = 'lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp'

export const AGENT_DEFS: AgentDef[] = [
  { id: 'producer-penny-pennywhistle', name: 'Penny Pennywhistle', role: 'producer', kind: 'llm', room: 'writers_room', model: null },
  { id: 'screenwriter-wilbur-wobblewick', name: 'Wilbur Wobblewick', role: 'screenwriter', kind: 'llm', room: 'writers_room', model: null },
  { id: 'story-editor-mabel-marzipan', name: 'Mabel Marzipan', role: 'story_editor', kind: 'llm', room: 'writers_room', model: QWEN27 },
  { id: 'character-designer-poppy-peglegs', name: 'Poppy Peglegs', role: 'character_designer', kind: 'llm', room: 'art_dept', model: null },
  { id: 'set-designer-tobias-tinkertown', name: 'Tobias Tinkertown', role: 'set_designer', kind: 'llm', room: 'art_dept', model: null },
  { id: 'director-ludo-longshot', name: 'Ludo Longshot', role: 'director', kind: 'llm', room: 'stage', model: null },
  { id: 'animator-bonnie-bouncewell', name: 'Bonnie Bouncewell', role: 'animator', kind: 'llm', room: 'stage', model: null },
  { id: 'composer-clementine-chimes', name: 'Clementine Chimes', role: 'composer', kind: 'llm', room: 'sound_booth', model: null },
  { id: 'sound-designer-fizz-footstep', name: 'Fizz Footstep', role: 'sound_designer', kind: 'llm', room: 'sound_booth', model: null },
  { id: 'foley-booth-crew', name: 'The Foley and Voice Booth', role: 'foley_booth', kind: 'tool', room: 'sound_booth', model: null },
  { id: 'puppet-workshop-crew', name: 'The Puppet Workshop', role: 'puppet_workshop', kind: 'tool', room: 'workshop', model: null },
  { id: 'animation-compiler-crew', name: 'The Tick-Tock Compiler', role: 'animation_compiler', kind: 'tool', room: 'workshop', model: null },
  { id: 'render-farm-crew', name: 'The Render Farm', role: 'render_farm', kind: 'tool', room: 'render_farm', model: null },
  { id: 'preview-crew', name: 'The Preview Crew', role: 'preview_crew', kind: 'tool', room: 'edit_suite', model: null },
  { id: 'qa-sergeant-checkmark', name: 'Sergeant Checkmark', role: 'qa', kind: 'llm', room: 'edit_suite', model: null },
  { id: 'editor-crew', name: 'The Editor', role: 'editor', kind: 'tool', room: 'edit_suite', model: null }
]

export const ROLE_DEFAULTS: Record<string, string> = {
  producer: SONNET,
  screenwriter: SONNET,
  story_editor: SONNET,
  character_designer: QWEN35,
  set_designer: QWEN35,
  director: QWEN27,
  animator: QWEN35,
  composer: QWEN35,
  sound_designer: QWEN35,
  qa: QWEN27
}

export const MODELS: ModelSummary[] = [
  { ref: QWEN35, provider: 'lmstudio', model: 'nail-qwen3.6-35b-a3b-mtp', family: 'qwen', local: true, enabled: true },
  { ref: QWEN27, provider: 'lmstudio', model: 'ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp', family: 'qwen', local: true, enabled: true },
  { ref: 'lmstudio/gemma-4-12b', provider: 'lmstudio', model: 'gemma-4-12b', family: 'gemma', local: true, enabled: true },
  { ref: 'anthropic/claude-opus-5-5', provider: 'anthropic', model: 'claude-opus-5-5', family: 'claude', local: false, enabled: true },
  { ref: SONNET, provider: 'anthropic', model: 'claude-sonnet-5-5', family: 'claude', local: false, enabled: true },
  { ref: 'openai/gpt-5.5', provider: 'openai', model: 'gpt-5.5', family: 'gpt', local: false, enabled: false },
  { ref: 'openrouter/qwen/qwen3.6-plus', provider: 'openrouter', model: 'qwen/qwen3.6-plus', family: 'qwen', local: false, enabled: false }
]

export function agentSummaries(): AgentSummary[] {
  return AGENT_DEFS.map((d) => {
    const resolved = d.kind === 'tool' ? null : (d.model ?? ROLE_DEFAULTS[d.role] ?? QWEN35)
    return { id: d.id, name: d.name, role: d.role, kind: d.kind, room: d.room, model: d.model, resolvedModel: resolved, paused: false, state: 'idle' }
  })
}

export function agentIdByRole(role: string): string {
  return AGENT_DEFS.find((d) => d.role === role)?.id ?? role
}

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s.slice(0, 40) || 'episode'
}

const SMALL = new Set(['and', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for'])
function titleCase(s: string): string {
  return s.replace(/\b(\w)(\w*)/g, (m, first: string, rest: string, offset: number) => (offset > 0 && SMALL.has(m) ? m : first.toUpperCase() + rest))
}

const MORALS: Record<EpisodeType, string> = {
  adventure: 'Brave friends can solve any problem together.',
  lesson: 'Sharing makes everything better.',
  mystery: 'Asking kindly helps us find what is lost.',
  holiday: 'The best gift is time with friends.',
  comedy: 'It is fine to wobble. Friends help you up.'
}

export function makeBrief(theme: string, type: EpisodeType, cast: string[], lengthMin: number): Brief {
  const hero = cast[0] ?? 'tock'
  const heroName = CAST_NAMES[hero] ?? titleCase(hero)
  const topic = titleCase(theme.trim().replace(/^(the|a|an)\s+/i, '')) || 'Windy Day'
  const named = theme.toLowerCase().includes(heroName.toLowerCase())
  return {
    title: named ? titleCase(theme.trim()) : `${heroName} and the ${topic}`,
    logline: `${heroName} meets ${theme.trim() || 'a windy day'} in Tumbletown and, with a little help from friends, makes everything right.`,
    moral: MORALS[type],
    problem: `Something about ${theme.trim() || 'the wind'} makes ${heroName}'s plan go wobbly.`,
    solution: `${heroName} asks friends for help and they solve it together.`,
    tone: 'warm and playful',
    cast,
    guests: [],
    locations: ['town_square', 'bakery', 'meadow'],
    newLocations: [],
    lengthSec: lengthMin * 60
  }
}

const EMOTION_CYCLE = ['happy', 'worried', 'excited', 'question', 'surprised', 'laugh', 'sad', 'happy'] as const

export function makeScript(brief: Brief): Script {
  const cast = brief.cast.length ? brief.cast : ['tock', 'bobbin']
  const name = (i: number) => CAST_NAMES[cast[i % cast.length] ?? 'tock'] ?? 'Tock'
  const id = (i: number) => cast[i % cast.length] ?? 'tock'
  let line = 0
  const talk = (who: number, text: string, e: number) => {
    line++
    return {
      id: `b${line}`,
      kind: 'line' as const,
      character: id(who),
      lineId: `L${String(line).padStart(3, '0')}`,
      text,
      emotion: EMOTION_CYCLE[e % EMOTION_CYCLE.length]!
    }
  }
  let beat = 0
  const act = (text: string) => ({ id: `a${++beat}`, kind: 'action' as const, text })
  return {
    title: brief.title,
    logline: brief.logline,
    moral: brief.moral,
    scenes: [
      {
        id: 'sc1',
        setId: 'town_square',
        summary: 'A bright morning in Tumbletown. Everything is going well, until it is not.',
        beats: [
          act(`${name(0)} rolls into the square, waving at everyone.`),
          talk(0, 'Good morning, everybody!', 0),
          act(`A little gust of wind lifts ${name(1)}'s hat and sends it spinning away.`),
          talk(1, 'Oh no, my hat!', 1),
          act(`${name(1)} hops after the hat, but it is too fast.`)
        ]
      },
      {
        id: 'sc2',
        setId: 'bakery',
        summary: `${name(0)} asks for help at the bakery.`,
        beats: [
          act(`${name(0)} peeks in through the bakery door.`),
          talk(0, 'Can you help us catch a hat?', 3),
          act(`${name(2)} looks up from a tray of warm buns and nods.`),
          talk(2, 'Of course, little one!', 2),
          act('Everyone shares a bun, and the bun smell drifts out of the window.')
        ]
      },
      {
        id: 'sc3',
        setId: 'meadow',
        summary: 'A funny chase across the meadow.',
        beats: [
          act('The hat bobs over the grass, with the friends running after it.'),
          talk(1, 'Wheee!', 5),
          act(`${name(0)} slips on a patch of grass and wobbles, then laughs.`),
          talk(0, 'Whoops! Hee hee!', 5),
          act(`${name(3)} holds up a long scarf like a net.`)
        ]
      },
      {
        id: 'sc4',
        setId: 'town_square',
        summary: 'The hat is caught and everyone cheers.',
        beats: [
          act('The hat drops softly into the scarf. Everyone gasps, then cheers.'),
          talk(1, 'Thank you, friends!', 0),
          talk(0, 'We did it together!', 2),
          act('The sun sets in pink and gold. A little tune plays as everyone waves goodbye.')
        ]
      }
    ]
  }
}

const FRAMINGS = ['establishing', 'wide', 'medium', 'close', 'two_shot', 'over_shoulder'] as const
const MOVES = ['locked', 'locked', 'pan_left', 'push_in', 'pan_right', 'follow', 'pull_out'] as const
const ANGLES = ['eye', 'eye', 'low', 'high'] as const

export function makeShots(script: Script, totalSec: number, count = 18): Shots {
  const beats = script.scenes.flatMap((s) => s.beats.map((b) => ({ scene: s, beat: b })))
  const each = totalSec / count
  const shots: Shot[] = []
  for (let i = 0; i < count; i++) {
    const pick = beats[Math.min(beats.length - 1, Math.floor((i / count) * beats.length))]!
    const lineIds = pick.beat.kind === 'line' && pick.beat.lineId ? [pick.beat.lineId] : []
    const cast = pick.beat.character ? [pick.beat.character] : []
    shots.push({
      id: `shot-${String(i + 1).padStart(2, '0')}`,
      sceneId: pick.scene.id,
      setId: pick.scene.setId,
      duration: Math.round(each * 2) / 2 || 12,
      framing: i === 0 ? 'establishing' : FRAMINGS[(i * 5 + 1) % FRAMINGS.length]!,
      angle: ANGLES[i % ANGLES.length]!,
      cameraMove: MOVES[i % MOVES.length]!,
      subjects: cast,
      cast,
      startMarks: {},
      beats: [pick.beat.id],
      lines: lineIds,
      transitionIn: i === 0 ? 'iris_in' : 'cut',
      transitionOut: i === count - 1 ? 'iris_out' : 'cut',
      notes: pick.beat.text
    })
  }
  return { shots }
}

/** A thumbnail for a shot as an SVG data URL: a little toy-stage picture in the set's colours. */
export function thumbDataUrl(shotNo: number, setId: string, label: string): string {
  const palettes: Record<string, [string, string, string]> = {
    town_square: ['#9fd3f5', '#7cbf5a', '#e2564a'],
    bakery: ['#f6d9a8', '#c98f5a', '#d9503f'],
    meadow: ['#bfe6f2', '#8ccf5f', '#f2c53a'],
    pond: ['#a8dce8', '#5fb3c8', '#f0a030']
  }
  const [sky, ground, accent] = palettes[setId] ?? palettes.town_square!
  const x = 90 + ((shotNo * 53) % 200)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">` +
    `<rect width="320" height="180" fill="${sky}"/><circle cx="270" cy="34" r="20" fill="#ffe27a"/>` +
    `<rect y="120" width="320" height="60" fill="${ground}"/>` +
    `<rect x="${x - 70}" y="70" width="46" height="50" rx="6" fill="#f4e4c4" stroke="#8a5a44" stroke-width="3"/><polygon points="${x - 74},72 ${x - 47},46 ${x - 20},72" fill="${accent}"/>` +
    `<rect x="${x}" y="92" width="22" height="34" rx="8" fill="${accent}" stroke="#5a3a2a" stroke-width="3"/><circle cx="${x + 11}" cy="82" r="11" fill="#f2c9a0" stroke="#5a3a2a" stroke-width="3"/>` +
    `<circle cx="${x + 8}" cy="80" r="1.8" fill="#333"/><circle cx="${x + 14}" cy="80" r="1.8" fill="#333"/>` +
    `<text x="10" y="170" font-family="sans-serif" font-size="13" font-weight="700" fill="#5a3a2a">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
