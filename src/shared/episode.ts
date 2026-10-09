import { z } from 'zod'

/**
 * Zod schemas for everything in docs/contracts.md: puppets, sets, style, the episode file, the script, shots, actions,
 * tracks, audio files and the QA result. docs/contracts.md is the source of truth; change it first.
 * LLM agents answer with these schemas (through `chatJson`) and choose from the constant lists below.
 */

// ---- vocabularies ----

export const BODIES = ['peg', 'teddy', 'soldier', 'gnome', 'cow', 'jack_box'] as const
export const MATERIALS = ['wood', 'felt', 'knit', 'clay'] as const
export const HATS = ['none', 'pompom', 'bell_cap', 'helmet', 'bonnet', 'gnome_cone', 'police', 'top_hat', 'beret'] as const
export const ACCESSORIES = ['scarf', 'bow', 'apron', 'glasses', 'backpack', 'whistle', 'key_back', 'neckerchief'] as const
export const EYES = ['dot', 'button'] as const
export const NOSES = ['round', 'snout', 'button', 'none'] as const
export const EARS = ['none', 'round', 'cow'] as const
export const TIMBRES = ['bright', 'warm', 'gruff', 'squeaky'] as const
export const VEHICLE_KINDS = ['van', 'car', 'bike', 'train'] as const
export const GROUNDS = ['grass', 'cobble', 'felt_green', 'snow', 'sand'] as const
export const BACKDROPS = ['sky_day', 'sky_sunset', 'sky_night', 'sky_snow'] as const
export const LIGHTINGS = ['day', 'evening', 'night', 'snow'] as const
export const PROP_KINDS = [
  'house', 'shop', 'station', 'tree_lollipop', 'tree_pine', 'bush', 'fence', 'road', 'lamp_post', 'bench', 'pond', 'hill',
  'well', 'flower_patch', 'mailbox', 'signpost', 'bridge', 'cloud', 'rock', 'gate', 'market_stall', 'clock_tower'
] as const
export const EMOTIONS = ['neutral', 'happy', 'sad', 'excited', 'worried', 'angry', 'surprised', 'sleepy', 'question', 'laugh'] as const
export const FRAMINGS = ['establishing', 'wide', 'medium', 'close', 'two_shot', 'over_shoulder'] as const
export const ANGLES = ['eye', 'low', 'high'] as const
export const CAMERA_MOVES = ['locked', 'pan_left', 'pan_right', 'push_in', 'pull_out', 'follow'] as const
export const TRANSITIONS_IN = ['cut', 'iris_in', 'fade'] as const
export const TRANSITIONS_OUT = ['cut', 'iris_out', 'fade'] as const
export const ACTIONS = [
  'walk_to', 'run_to', 'hop', 'turn_to', 'look_at', 'wave', 'nod', 'shake_head', 'point', 'jump_joy', 'sad_slump', 'shrug', 'sit',
  'stand', 'drive_to', 'pick_up', 'give', 'talk', 'gasp', 'laugh', 'sleep', 'wobble', 'idle', 'enter', 'exit'
] as const
/** Actions that need a `target` (a mark, a prop id, a character id or [x, y]). */
export const ACTIONS_NEEDING_TARGET: readonly Action[] = ['walk_to', 'run_to', 'drive_to', 'turn_to', 'look_at', 'give']
export const HELD_PROPS = ['cap', 'ball', 'letter', 'flower', 'cake', 'key', 'umbrella', 'balloon'] as const
export const INSTRUMENTS = ['music_box', 'glockenspiel', 'ukulele', 'tuba', 'xylophone', 'recorder'] as const
export const SFX_CUES = [
  'bell_jingle', 'horn_parp', 'squeak_step', 'boing', 'door_knock', 'door_open', 'birds', 'wind', 'splash', 'pop', 'whistle',
  'clock_tick', 'twinkle', 'soft_crash', 'engine_putter', 'rain', 'snore', 'gasp_whoosh', 'drum_roll', 'ta_da'
] as const
/** Pipeline stages, in order. `failed` can replace any of them. */
export const STAGES = [
  'brief', 'outline', 'script', 'review', 'approve_script', 'design', 'shots', 'animate', 'qa', 'assets', 'voice', 'compile',
  'mix', 'preview', 'approve_animatic', 'render', 'edit', 'done', 'failed'
] as const
export const EPISODE_STATUSES = ['running', 'awaiting_approval', 'done', 'failed'] as const
/** Tasks whose output the QA validator can send back to its owner (`fix_<task>`). */
export const QA_OWNER_TASKS = ['cast', 'sets', 'shots', 'actions', 'music', 'sfx'] as const

export type BodyKind = (typeof BODIES)[number]
export type Emotion = (typeof EMOTIONS)[number]
export type Framing = (typeof FRAMINGS)[number]
export type Action = (typeof ACTIONS)[number]
export type PropKind = (typeof PROP_KINDS)[number]
export type HeldProp = (typeof HELD_PROPS)[number]
export type Instrument = (typeof INSTRUMENTS)[number]
export type SfxCue = (typeof SFX_CUES)[number]
export type Stage = (typeof STAGES)[number]
export type QaOwnerTask = (typeof QA_OWNER_TASKS)[number]

const hex = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'a colour like #d33b2c')
const xy = z.tuple([z.number(), z.number()])
const id = z.string().min(1)

// ---- puppet ----

export const vehicleSchema = z.object({
  kind: z.enum(VEHICLE_KINDS),
  color: hex.default('#ffd400'),
  accent: hex.default('#d33b2c')
})

export const voiceSchema = z.object({
  pitch: z.number().min(0.5).max(2.5).default(1),
  speed: z.number().min(0.5).max(2).default(1),
  timbre: z.enum(TIMBRES).default('warm')
})

export const PuppetSpec = z.looseObject({
  id,
  name: z.string().min(1),
  body: z.enum(BODIES),
  material: z.enum(MATERIALS).default('wood'),
  height: z.number().positive().default(1),
  colors: z
    .object({
      skin: hex.default('#f2c9a0'),
      torso: hex.default('#d33b2c'),
      legs: hex.default('#2a4fa8'),
      hat: hex.default('#dd2222'),
      accent: hex.default('#ffd400')
    })
    .default({ skin: '#f2c9a0', torso: '#d33b2c', legs: '#2a4fa8', hat: '#dd2222', accent: '#ffd400' }),
  hat: z.enum(HATS).default('none'),
  accessories: z.array(z.enum(ACCESSORIES)).default([]),
  eyes: z.enum(EYES).default('dot'),
  nose: z.enum(NOSES).default('round'),
  ears: z.enum(EARS).default('none'),
  vehicle: vehicleSchema.nullable().default(null),
  voice: voiceSchema.default({ pitch: 1, speed: 1, timbre: 'warm' })
})
export type PuppetSpec = z.output<typeof PuppetSpec>

// ---- set ----

export const SetProp = z.object({
  kind: z.enum(PROP_KINDS),
  pos: xy,
  rot: z.number().default(0),
  scale: z.number().positive().default(1),
  color: hex.optional(),
  accent: hex.optional(),
  variant: z.number().int().nonnegative().default(0),
  /** A prop with an id can be targeted by actions. */
  id: z.string().min(1).optional()
})
export type SetProp = z.output<typeof SetProp>

export const SetLayout = z.looseObject({
  id,
  name: z.string().min(1),
  size: xy.default([12, 8]),
  ground: z.enum(GROUNDS).default('grass'),
  backdrop: z.enum(BACKDROPS).default('sky_day'),
  lighting: z.enum(LIGHTINGS).default('day'),
  props: z.array(SetProp).default([]),
  /** Named ground positions [x, y]. */
  marks: z.record(z.string(), xy).default({})
})
export type SetLayout = z.output<typeof SetLayout>

// ---- style ----

export const Style = z.looseObject({
  id: z.string().default('toyland-wood'),
  fps: z.number().int().positive().default(12),
  output_fps: z.number().int().positive().default(24),
  jitter_pos: z.number().nonnegative().default(0.003),
  jitter_rot: z.number().nonnegative().default(0.3),
  light_flicker: z.number().nonnegative().default(0.02),
  dof_fstop: z.number().positive().default(2),
  grain: z.number().nonnegative().default(0.04),
  vignette: z.number().nonnegative().default(0.25),
  key_light: hex.default('#ffe2b8'),
  fill_light: hex.default('#b8d4ff')
})
export type Style = z.output<typeof Style>

// ---- episode.md frontmatter ----

export const EpisodeMeta = z.looseObject({
  kind: z.literal('episode').default('episode'),
  /** The folder name. Filled in by the store when it reads the file. */
  id: z.string().default(''),
  title: z.string().default(''),
  theme: z.string().default(''),
  type: z.enum(['adventure', 'lesson', 'mystery', 'holiday', 'comedy']).default('adventure'),
  style: z.string().default('toyland-wood'),
  lengthMin: z.number().positive().default(5),
  /** Cast ids the user asked for. Empty: the producer picks. */
  characters: z.array(z.string()).default([]),
  stage: z.enum(STAGES).default('brief'),
  status: z.enum(EPISODE_STATUSES).default('running'),
  approvals: z.object({ script: z.boolean().default(true), animatic: z.boolean().default(true) }).default({ script: true, animatic: true }),
  approved: z.object({ script: z.boolean().default(false), animatic: z.boolean().default(false) }).default({ script: false, animatic: false }),
  /** Index of the script review under way (review-N.json). Each revise verdict leads to a rewrite and the next index. */
  round: z.number().int().nonnegative().default(0),
  /** First review index after the user's last change request. Limits the story editor's rewrite loop. */
  roundBase: z.number().int().nonnegative().default(0),
  /** QA round (0 = first check). */
  qaRound: z.number().int().nonnegative().default(0),
  /** Production cut: goes up when the user asks for changes at the animatic. Job ids from `shots` on carry it. */
  cut: z.number().int().nonnegative().default(0),
  /** The user's note for the current cut (given to the director and animator). */
  cutNote: z.string().default(''),
  error: z.string().nullable().default(null),
  /** The stage that was running when the episode failed (for `retryEpisode`). */
  failedStage: z.enum(STAGES).nullable().default(null),
  createdAt: z.string().default(''),
  updatedAt: z.string().default('')
})
export type EpisodeMeta = z.output<typeof EpisodeMeta>

// ---- brief and outline (producer / screenwriter) ----

export const Brief = z.object({
  title: z.string().min(1),
  logline: z.string().min(1),
  /** The gentle lesson, one short sentence. */
  moral: z.string().min(1),
  /** The one clear, simple problem. */
  problem: z.string().min(1),
  /** How friendship or kindness solves it. */
  solution: z.string().min(1),
  tone: z.string().default('warm and playful'),
  /** Ids of the main characters. Existing cast ids, or the ids of the guests below. */
  cast: z.array(id).min(1),
  /** Guest characters that do not exist in the cast yet. The character designer builds them. */
  guests: z.array(z.object({ id, name: z.string().min(1), description: z.string() })).default([]),
  /** Ids of the locations. Existing set ids, or the ids of the new locations below. */
  locations: z.array(id).min(1),
  newLocations: z.array(z.object({ id, name: z.string().min(1), description: z.string() })).default([]),
  /** Target running time in seconds. */
  lengthSec: z.number().positive()
})
export type Brief = z.output<typeof Brief>

export const OutlineSection = z.object({
  id,
  /** For example "Cold open", "The problem", "First try", "Help from friends", "Solution", "Happy ending". */
  name: z.string().min(1),
  setId: id,
  summary: z.string().min(1),
  /** Visible story beats in order, written as things you can see. */
  beats: z.array(z.string().min(1)).min(1),
  approxSec: z.number().positive()
})
export const Outline = z.object({
  title: z.string().min(1),
  sections: z.array(OutlineSection).min(3)
})
export type Outline = z.output<typeof Outline>

// ---- script ----

export const Beat = z
  .object({
    id,
    kind: z.enum(['action', 'line']),
    text: z.string().min(1),
    /** Lines only. */
    character: z.string().min(1).optional(),
    lineId: z.string().min(1).optional(),
    emotion: z.enum(EMOTIONS).optional()
  })
  .superRefine((b, ctx) => {
    if (b.kind === 'line') {
      for (const k of ['character', 'lineId', 'emotion'] as const) {
        if (!b[k]) ctx.addIssue({ code: 'custom', path: [k], message: `a line beat needs ${k}` })
      }
    }
  })
export type Beat = z.output<typeof Beat>

export const Scene = z.object({
  id,
  setId: id,
  summary: z.string().min(1),
  beats: z.array(Beat).min(1)
})
export type Scene = z.output<typeof Scene>

export const Script = z.object({
  title: z.string().min(1),
  logline: z.string().min(1),
  moral: z.string().min(1),
  scenes: z.array(Scene).min(1)
})
export type Script = z.output<typeof Script>

export const Review = z.object({
  verdict: z.enum(['pass', 'revise']),
  /** Who wrote it. `user` is a change request from the script checkpoint. */
  source: z.enum(['editor', 'user']).default('editor'),
  summary: z.string().default(''),
  /** 1 (poor) to 5 (great). */
  scores: z
    .object({
      age_fit: z.number().int().min(1).max(5),
      clarity_without_words: z.number().int().min(1).max(5),
      pacing: z.number().int().min(1).max(5),
      length: z.number().int().min(1).max(5)
    })
    .optional(),
  issues: z.array(z.object({ sceneId: z.string().optional(), problem: z.string(), fix: z.string() })).default([])
})
export type Review = z.output<typeof Review>

// ---- shots and actions ----

export const Shot = z.object({
  id,
  sceneId: id,
  setId: id,
  /** Seconds. */
  duration: z.number().positive(),
  framing: z.enum(FRAMINGS),
  angle: z.enum(ANGLES).default('eye'),
  cameraMove: z.enum(CAMERA_MOVES).default('locked'),
  subjects: z.array(z.string()).default([]),
  cast: z.array(z.string()).default([]),
  /** Where each character starts: a mark name, a prop id or [x, y]. */
  startMarks: z.record(z.string(), z.union([z.string(), xy])).default({}),
  beats: z.array(z.string()).default([]),
  lines: z.array(z.string()).default([]),
  transitionIn: z.enum(TRANSITIONS_IN).default('cut'),
  transitionOut: z.enum(TRANSITIONS_OUT).default('cut'),
  notes: z.string().default('')
})
export type Shot = z.output<typeof Shot>

export const Shots = z.object({ shots: z.array(Shot).min(1) })
export type Shots = z.output<typeof Shots>

export const ActionTarget = z.union([z.string(), xy])
export const ActionStep = z.object({
  /** Seconds from the start of the shot. */
  t: z.number().min(0),
  actor: id,
  action: z.enum(ACTIONS),
  target: ActionTarget.optional(),
  dur: z.number().positive().optional(),
  /** `talk` only. */
  lineId: z.string().optional(),
  /** A small held item. */
  prop: z.enum(HELD_PROPS).optional()
})
export type ActionStep = z.output<typeof ActionStep>

export const ShotActions = z.object({ shotId: id, actions: z.array(ActionStep) })
export type ShotActions = z.output<typeof ShotActions>

// ---- tracks (compiled animation) ----

const vec3 = z.tuple([z.number(), z.number(), z.number()])
export const TrackEvent = z.object({
  frame: z.number().int().nonnegative(),
  kind: z.enum(['line', 'sfx']),
  lineId: z.string().optional(),
  actor: z.string().optional(),
  cue: z.string().optional(),
  gain: z.number().optional()
})
export const Tracks = z
  .object({
    shotId: id,
    setId: id,
    fps: z.number().int().positive(),
    frames: z.number().int().positive(),
    seed: z.number().int(),
    cast: z.array(z.string()),
    camera: z.object({ loc: z.array(vec3), target: z.array(vec3), lens: z.array(z.number()) }),
    objects: z.record(z.string(), z.object({ loc: z.array(vec3).optional(), rot: z.array(vec3).optional() })),
    /** Per character, one mouth index (0 closed, 1 mid, 2 open) per frame. */
    mouths: z.record(z.string(), z.array(z.number().int().min(0).max(2))),
    /** Per character, the held prop name per frame (`none` for nothing). */
    props: z.record(z.string(), z.array(z.string())),
    events: z.array(TrackEvent)
  })
  .superRefine((t, ctx) => {
    const check = (path: (string | number)[], n: number) => {
      if (n !== t.frames) ctx.addIssue({ code: 'custom', path, message: `expected ${t.frames} entries, got ${n}` })
    }
    check(['camera', 'loc'], t.camera.loc.length)
    check(['camera', 'target'], t.camera.target.length)
    check(['camera', 'lens'], t.camera.lens.length)
    for (const [k, o] of Object.entries(t.objects)) {
      if (o.loc) check(['objects', k, 'loc'], o.loc.length)
      if (o.rot) check(['objects', k, 'rot'], o.rot.length)
    }
    for (const [k, a] of Object.entries(t.mouths)) check(['mouths', k], a.length)
    for (const [k, a] of Object.entries(t.props)) check(['props', k], a.length)
  })
export type Tracks = z.output<typeof Tracks>

// ---- audio ----

export const MouthFile = z.object({
  lineId: id,
  duration: z.number().nonnegative(),
  fps: z.number().int().positive(),
  levels: z.array(z.number().int().min(0).max(2))
})
export type MouthFile = z.output<typeof MouthFile>

/** `p` is a note name ("C5") or a MIDI number, or "r" for a rest. `d` is in beats. */
export const Note = z.object({ p: z.union([z.string(), z.number()]), d: z.number().positive() })
export type Note = z.output<typeof Note>

export const Music = z.object({
  tempo: z.number().min(40).max(200),
  key: z.string().default('C'),
  theme: z.object({ instrument: z.enum(INSTRUMENTS), melody: z.array(Note).min(1), bass: z.array(Note).default([]) }),
  cues: z.array(
    z.object({
      id,
      shots: z.array(z.string()).min(1),
      mood: z.string(),
      instrument: z.enum(INSTRUMENTS),
      tempo: z.number().min(40).max(200),
      melody: z.array(Note).default([]),
      bass: z.array(Note).default([]),
      loop: z.boolean().default(true),
      gain: z.number().min(0).max(1).default(0.5)
    })
  )
})
export type Music = z.output<typeof Music>

export const Sfx = z.object({
  cues: z.array(z.object({ shotId: id, t: z.number().min(0), cue: z.enum(SFX_CUES), gain: z.number().min(0).max(1).default(0.8) })),
  /** Per character id. */
  voices: z.record(z.string(), voiceSchema).default({})
})
export type Sfx = z.output<typeof Sfx>

// ---- QA ----

export const QaIssue = z.object({
  /** The task that owns the fix. */
  task: z.enum(QA_OWNER_TASKS),
  /** For `actions`: the shot id. */
  unit: z.string().optional(),
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  message: z.string()
})
export type QaIssue = z.output<typeof QaIssue>

export const QaResult = z.object({
  ok: z.boolean(),
  round: z.number().int().nonnegative(),
  issues: z.array(QaIssue),
  checkedAt: z.string()
})
export type QaResult = z.output<typeof QaResult>

// ---- LLM answers of the design tasks ----

/** The character designer picks existing puppets by id and designs guests in full. */
export const CastAnswer = z.object({ picks: z.array(z.string()), guests: z.array(PuppetSpec).default([]) })
export type CastAnswer = z.output<typeof CastAnswer>

/** The set designer picks existing sets by id and composes new ones from the prop kit. */
export const SetsAnswer = z.object({ picks: z.array(z.string()), custom: z.array(SetLayout).default([]) })
export type SetsAnswer = z.output<typeof SetsAnswer>

// ---- helpers ----

export const castSchema = z.array(PuppetSpec)
export const setsSchema = z.array(SetLayout)

/** Pads to two digits: `shotFileId(3) === 'shot-03'`. */
export const shotId = (n: number): string => `shot-${String(n).padStart(2, '0')}`
