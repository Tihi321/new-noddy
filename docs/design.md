# Toybox Studio: design

A crew of AI agents turns a theme into a finished ~5 minute kids' episode (15 to 25 shots) in the feel of old stop-motion puppet shows: wooden peg-doll toys, felt, a small toy car. There is no real voice: characters mumble, and the music is music-box and ukulele. The user watches the agents work live in a studio view. The structure follows the sibling project `scriptorium` (file-backed jobs, agents, model router).

## Decisions

| # | Decision |
|---|---|
| 1 | TypeScript on Node 24, Electron with electron-vite, React 19, Zustand, Phaser 3 (studio view), zod 4, yaml, chokidar, vitest, Playwright (later). npm. |
| 2 | The engine is a separate process (Electron `utilityProcess`; also runs headless) behind a typed protocol (`src/shared/protocol.ts`). Events out, commands in. |
| 3 | All state is markdown or JSON in the data folder (`~/ToyboxStudio`, `--data`, `TOYBOX_DATA`). Seed defaults are copied from `seed/` and never overwrite existing files. Config is hot-reloaded. |
| 4 | Original cast and world (Tumbletown). No existing IP. |
| 5 | Blender renders the final video (Eevee, the machine has no NVIDIA GPU). Godot 4 makes a fast animatic preview. |
| 6 | Per-agent model choice: role defaults in `config/roles.md`, per-agent override in `agents/<id>.md`, editable in the UI. Creative roles default to Claude Sonnet with a local Qwen fallback, structured roles default to the local Qwen 35B with a Claude fallback. |
| 7 | LLM agents output zod-validated JSON and choose from fixed vocabularies. Deterministic code (animation compiler, audio DSP, Blender toykit) does everything else. |
| 8 | Pure planner `advance(EpisodeState) -> { patch, jobs }`, so a restart is safe. Job ids are deterministic (`episode--task--unit--round`), so enqueue is idempotent. |
| 9 | Tool crews (Blender, Godot, ffmpeg, audio) are tool jobs: agents of `kind: tool`, no model, child processes, progress as `render.progress` events. |
| 10 | The animation compiler's tracks (12 fps, constant interpolation) are the single source of truth for Godot and Blender. |
| 11 | Keys only from environment variables or the Windows credential store, never in files. |
| 12 | Approval checkpoints (script, animatic) are optional per episode. `requestChanges` enqueues a rewrite job with the user's note. |
| 13 | The renderer reads media through the sandboxed `toybox-media:` protocol, which serves only certain file types from inside the data folder. |

## Engine

- `models/`: `OpenAiCompatClient` (LM Studio, Ollama, OpenAI, OpenRouter), Anthropic, Gemini, a scripted mock, `ModelRegistry` (reads `config/providers.md` and `roles.md`, discovers LM Studio models), `ModelRouter` (retries, fallback, budget reservations), `ProviderLimiter` (concurrency, rpm), `keys.ts` (env first, then the credential store, service `toybox-studio`).
- `pipeline/llm.ts`: `chatJson(ctx, messages, zodSchema)` (JSON schema to the provider, one repair retry, retry without schema), `stripThinking`, `extractJson`, `cleanProse`. `pipeline/prompts.ts`: `buildMessages` from `prompts/<role>/<task>.md` plus `prompts/_rules.md` plus the agent persona, `{{var}}` templates, and a prompt-version hash stored on the job.
- `queue/jobs.ts`: one markdown file per job, moved between `jobs/{queued,running,done,failed}`. `queue/scheduler.ts`: picks agents by role, handles locks, `depends_on`, `waiting_on` (suspend), retries with backoff, budget caps, pause and stop. Handlers are registered with `scheduler.register(task, handler, { tool?, template?, reviewing? })`. `JobContext` offers `chat()`, `log()`, `enqueue()`, `progress()`, `emit()`.
- `tools/`: `detect.ts` finds Blender, Godot, ffmpeg (config path, PATH, install folders) and reads their versions. `exec.ts` runs a child process and streams its lines (for tool jobs).
- `store/`: atomic writes (tmp file then rename, Windows-safe retries), `watcher.ts` (config and agents), `dataFolder.ts` (layout, seed copy).
- `budget/spend.ts`: spend rows in `logs/spend/YYYY-MM.md`, daily, monthly and per-episode caps, reservations before paid requests. Local models cost 0.
- `Engine` (`engine.ts`) ties it together. The episode pipeline plugs in with `engine.onCommand()`, `engine.onEvent()`, `engine.setEpisodeSource()` and `scheduler.register()`.

## Protocol

Events: `engine.ready`, `engine.heartbeat`, `pong`, `snapshot`, `engine.warning`, `agent.state`, `factory.paused`, `job.started`, `job.token`, `job.done`, `handover`, `spend`, `episode.updated`, `render.progress`, `asset.ready`.
Commands: `pause`, `resume`, `stop`, `pauseAll`, `resumeAll`, `stopNow`, `setModel`, `newEpisode`, `approve`, `requestChanges`, `snapshot`, `ping`.

## Crew (`seed/agents/*.md`)

| Agent | Kind | Room |
|---|---|---|
| Producer, Screenwriter, Story Editor | llm | writers_room |
| Character Designer, Set Designer | llm | art_dept |
| Director, Animator | llm | stage |
| Composer, Sound Designer | llm | sound_booth |
| Continuity / QA | llm | edit_suite |
| Puppet Workshop, Animation Compiler | tool | workshop |
| Preview Crew (Godot), Editor (ffmpeg) | tool | edit_suite |
| Foley and Voice Booth | tool | sound_booth |
| Render Farm (Blender) | tool | render_farm |

Pipeline: brief, outline, script, story review (rewrite loop), optional approval (script), design (cast and sets in parallel), shots, actions (per shot) with music and sfx, QA, asset build, compile tracks, audio, Godot animatic, optional approval (animatic), Blender render (per shot, resumable), edit, done.

## Config (`seed/config`)

`providers.md`, `roles.md`, `tools.md` (paths, empty means auto-detect), `budget.md`, `pipeline.md` (approvals, target length, shots, fps 12, output fps 24, render presets 640x360 preview and 1280x720 final).

## Milestones

M1 scaffold and toolchain, M2 engine core port, M3 story agents and `advance()`, M4 Toykit (Blender), M5 animation compiler and Godot animatic, M6 audio, M7 final render and editor, M8 UI, M9 real run. See the ticket plan for details.

## History

- 2026-10-09: scaffold and engine core ported from scriptorium (M1, M2). Agent file `kind` is now `llm` or `tool` (scriptorium used `kind: agent`). Pause-all is persisted in `config/pipeline.md`.
