import { z } from 'zod'
import type { ZodType } from 'zod'

/**
 * Frontmatter schemas for config, agent and job files. Episode schemas (brief, script, shots ...) live in
 * `src/shared/episode.ts`, which arrives with the story agents.
 * Config files carry a `kind` field, so a file says what it is.
 * Unknown fields are kept (loose), so you can add your own notes to a file.
 */

/** Any markdown file with a frontmatter mapping. */
export const genericSchema = z.looseObject({})

const configBase = <K extends string>(kind: K) => z.looseObject({ kind: z.literal(kind) })

export const budgetSchema = configBase('budget').extend({
  monthly_cap_usd: z.number().nonnegative(),
  daily_cap_usd: z.number().nonnegative(),
  per_episode_cap_usd: z.number().nonnegative().nullable().default(null),
  /** Fraction of a cap at which a warning is shown. */
  warn_at: z.number().min(0).max(1).default(0.8)
})

// ---- providers ----

export const providerModelSchema = z.looseObject({
  id: z.string().min(1),
  family: z.string().default('unknown'),
  context: z.number().int().positive().optional(),
  max_output: z.number().int().positive().optional(),
  /** USD per 1M tokens. */
  price_in: z.number().nonnegative().default(0),
  price_out: z.number().nonnegative().default(0),
  /** USD per 1M cached input tokens. Falls back to price_in when missing. */
  price_cached_in: z.number().nonnegative().optional(),
  embedding: z.boolean().default(false),
  /** Extra JSON fields merged into the request body for this model (for example to switch thinking off). */
  extra_body: z.record(z.string(), z.unknown()).nullable().optional()
})

export const providerEntrySchema = z.looseObject({
  id: z.string().min(1),
  kind: z.enum(['openai-compat', 'anthropic', 'gemini', 'mock']),
  enabled: z.boolean().default(true),
  local: z.boolean().default(false),
  base_url: z.string().optional(),
  api_key_env: z.string().optional(),
  /** How many requests may run at once. */
  concurrency: z.number().int().positive().default(4),
  rpm: z.number().int().positive().optional(),
  tpm: z.number().int().positive().optional(),
  /** Ask the provider which models it has (GET /v1/models) and add the unknown ones. */
  discover: z.boolean().default(false),
  /** Send the JSON schema as `response_format`. Set false for servers that reject a bad JSON answer (502) instead of constraining it: the prompt and the repair step handle the JSON then. */
  json_schema: z.boolean().default(true),
  models: z.array(providerModelSchema).default([])
})

export const providersSchema = configBase('providers').extend({
  providers: z.array(providerEntrySchema).default([])
})

// ---- roles ----

export const rolesSchema = configBase('roles').extend({
  /** Per role: ordered model list, `provider/model`. The first one is the default, the rest are fallbacks. */
  roles: z.record(z.string(), z.looseObject({ models: z.array(z.string()).default([]) })).default({})
})

// ---- tools ----

/** Paths to the external programs. Empty means "look on PATH and in the usual install folders". */
export const toolsSchema = configBase('tools').extend({
  blender: z.string().default(''),
  godot: z.string().default(''),
  ffmpeg: z.string().default('')
})

// ---- pipeline ----

export const renderPresetSchema = z.looseObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  samples: z.number().int().positive().optional()
})

export const pipelineSchema = configBase('pipeline').extend({
  /** Checkpoints where the pipeline waits for the user. */
  approvals: z
    .looseObject({ script: z.boolean().default(true), animatic: z.boolean().default(true) })
    .default({ script: true, animatic: true }),
  target_length_min: z.number().positive().default(5),
  shots_min: z.number().int().positive().default(15),
  shots_max: z.number().int().positive().default(25),
  /** Animation sample rate (unique frames per second, "on twos" stop-motion). */
  fps: z.number().int().positive().default(12),
  /** Output video frame rate. */
  output_fps: z.number().int().positive().default(24),
  render: z
    .looseObject({
      preview: renderPresetSchema.default({ width: 640, height: 360, samples: 16 }),
      final: renderPresetSchema.default({ width: 1280, height: 720, samples: 64 })
    })
    .default({ preview: { width: 640, height: 360, samples: 16 }, final: { width: 1280, height: 720, samples: 64 } }),
  /** How often the story editor may send the script back for a rewrite. */
  max_review_rounds: z.number().int().nonnegative().default(2),
  /** How many QA fix rounds before the episode goes on (warnings) or fails (errors). */
  max_qa_rounds: z.number().int().nonnegative().default(2),
  /** Attempts before a job moves to failed/. */
  max_attempts: z.number().int().positive().default(3),
  /** Persisted "pause all": no new jobs start while true. */
  paused: z.boolean().default(false)
})

// ---- agents ----

export const agentSchema = z.looseObject({
  /** `llm` agents call a model. `tool` crews run programs (Blender, Godot, ffmpeg, audio) and never call a model. */
  kind: z.enum(['llm', 'tool']).default('llm'),
  role: z.string().min(1),
  name: z.string().min(1),
  /** `provider/model` override. Empty means "use the role default". */
  model: z.string().nullable().default(null),
  /** Where the agent sits in the studio view. */
  room: z.string().default(''),
  max_parallel: z.number().int().positive().default(1),
  paused: z.boolean().default(false)
})

// ---- jobs ----

export const jobSchema = z.looseObject({
  kind: z.literal('job').default('job'),
  /** Deterministic: episode--task--unit--round. */
  id: z.string().min(1),
  episode: z.string().nullable().default(null),
  task: z.string().min(1),
  role: z.string().min(1),
  unit: z.string().nullable().default(null),
  round: z.number().int().nonnegative().default(0),
  /** An agent id, `you` or `engine`. */
  requested_by: z.string().default('engine'),
  depends_on: z.array(z.string()).default([]),
  /** Job id this job is suspended on. */
  waiting_on: z.string().nullable().default(null),
  /** Short text for the studio view (the handover line and the agent's bubble) instead of `task unit`. */
  label: z.string().optional(),
  /** Locks that must be free to run, for example `blend:ep1`. */
  locks: z.array(z.string()).default([]),
  /** Reviewers prefer a model family different from this one. */
  avoid_family: z.string().nullable().default(null),
  /** Prefer this agent. Not strict. */
  agent_hint: z.string().nullable().default(null),
  paid: z.boolean().nullable().default(null),
  attempts: z.number().int().nonnegative().default(0),
  max_attempts: z.number().int().positive().nullable().default(null),
  /** Do not start before this time (ISO). Used for retry backoff. */
  not_before: z.string().nullable().default(null),
  created: z.string().optional()
})

export const schemasByKind = {
  budget: budgetSchema,
  providers: providersSchema,
  roles: rolesSchema,
  tools: toolsSchema,
  pipeline: pipelineSchema,
  agent: agentSchema,
  job: jobSchema,
  generic: genericSchema
} as const satisfies Record<string, ZodType>

export type FileKind = keyof typeof schemasByKind
export type BudgetConfig = z.output<typeof budgetSchema>
export type ProvidersConfig = z.output<typeof providersSchema>
export type ProviderEntry = z.output<typeof providerEntrySchema>
export type ProviderModelEntry = z.output<typeof providerModelSchema>
export type RolesConfig = z.output<typeof rolesSchema>
export type ToolsConfig = z.output<typeof toolsSchema>
export type PipelineConfig = z.output<typeof pipelineSchema>
export type AgentFrontmatter = z.output<typeof agentSchema>
export type JobFrontmatter = z.output<typeof jobSchema>

/** Config files in `config/`, by file name (without `.md`). */
export const CONFIG_FILES = ['providers', 'roles', 'tools', 'budget', 'pipeline'] as const

/** Roles of the LLM agents. Each has a model list in config/roles.md. */
export const LLM_ROLES = [
  'producer',
  'screenwriter',
  'story_editor',
  'character_designer',
  'set_designer',
  'director',
  'animator',
  'composer',
  'sound_designer',
  'qa'
] as const

/** Roles of the tool crews. They run programs and need no model. */
export const TOOL_ROLES = ['puppet_workshop', 'animation_compiler', 'preview_crew', 'foley_booth', 'render_farm', 'editor'] as const

export const ROLES = [...LLM_ROLES, ...TOOL_ROLES] as const
