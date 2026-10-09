# NOD-01 — Toybox Studio: multi-agent kids-episode factory (MVP)

> Authoritative plan: `.claude/tickets/NOD-01-toybox-studio-multi-agent-kids-episode/plan.md`
> Branch: `NOD-01_toybox-studio-mvp` (from `origin/master`)
> Temp files: `.claude/temp/` only.

## Progress checklist (updated by implementers)
- [x] M1 Scaffold + toolchain. Scaffold done. Installed via winget 2026-10-09: Blender 5.2.2 LTS, Godot 4.7.2, ffmpeg 9.0.2; `npm run doctor` reports all OK (LM Studio OK, ANTHROPIC_API_KEY not set). Data contracts in `docs/contracts.md`.
- [x] M2 Engine core port. Verified 2026-10-09: `npm install`, `npm run typecheck`, `npm run lint`, `npm test` (10 files, 82 tests) pass; `npm run doctor` prints the table (exit 0); `npm run engine -- probe --data <temp>` lists LM Studio models; `npm run build` and an Electron no-window launch start the engine.
  - Deviations: `book` renamed to `episode` everywhere (job field, spend rows, logs at `episodes/<id>/log.md`, `per_episode_cap_usd`). Agent frontmatter `kind` is now `llm | tool` (was the file kind `agent`); added `room`; dropped `focus`/`pin`/hire/fire. Pause-all persists in `config/pipeline.md` (`paused`) instead of factory.md. Embeddings and search provider kinds dropped from the registry. Scheduler: `register(task, fn, { tool: true })` routes to `kind: tool` agents only, skips models/limiter; `JobContext` gained `tool`, `progress()` (emits `render.progress`) and `emit()`. `Engine` exposes `onCommand()`, `onEvent()`, `setEpisodeSource()`, `onConfigChanged()` for the M3 pipeline; `src/engine/index.ts` has a marked spot for `installPipeline(engine)`. Added `src/engine/tools/{detect,exec}.ts` (tool discovery, child-process runner). Headless transport prints raw JSON lines on stdout, logs on stderr. Roles: LLM roles use snake_case (`story_editor` ...); tool roles are `puppet_workshop, animation_compiler, preview_crew, foley_booth, render_farm, editor`. Anthropic prices in seed/config/providers.md are placeholders to verify. Playwright not added yet (M8).
- [x] M3 Story agents + advance() + mock e2e. `src/shared/episode.ts`, `src/engine/pipeline/*`, 10 role prompts, QA validator, retryEpisode, deterministic QA; mock e2e covers full run, change requests, QA fix loop, retry.
- [x] M4 Toykit (Blender) + golden fixture
  - Done on Blender 5.2.2: 7 puppets + 6 sets build to .blend/.glb; golden shots render (preview 0.3-0.6 s/frame, final 1.5 s/frame); resume verified. Grain/vignette are done with numpy after the render instead of the compositor. Tool handlers in `src/engine/tools/handlers/blender.ts`.
- [x] M5 Animation compiler (`src/engine/anim/`) + Godot animatic (`godot/preview/`, `tools/handlers/godot.ts`); orientation verified Blender↔Godot to 4 decimals.
- [x] M6 Audio (`src/engine/audio/`: mumble, music, sfx, mix; `tools/handlers/animAudio.ts`). Samples checked numerically only — not listened to.
- [x] M7 Render + Editor: `tools/handlers/blender.ts` (render_shot) and `edit.ts` (edit_episode, iris/fade) done + unit-tested; final edit verified on upscaled Godot frames, verified on the full Blender render in M9.
- [x] M8 UI: Phaser toy-studio (7 rooms, 16 crew puppets/robots, bubbles, badges, handovers, progress), New Episode dialog, episode tabs, approvals, terminal, crew model picker, settings, fake engine (?demo). typecheck/lint/test + test:ui (8 passed) pass. Live Electron run verified; openGodot, tools/cast/styles in snapshot, resetSeed, retry added.
- [x] M9 Real run (all-local LM Studio): 5-min episode "Tock loses his cap on a windy day" — 18 shots, 297 s mp4 1280x720 24fps with audio. ~10 min LLM, 86 s animatic, 45 min Blender render (~0.8 s/frame), 57 s edit. Fixes: action repair, shot-duration fitting, camera percentile framing, the_hill marks. Notes: m9-run-notes.md. Post-M9 polish (75 MB output, −1 dBFS ceiling, title, reset-seed, framing, overlap) and live Electron integration (LIVE spec 7/7) done. See changelog.md.

## Context
`new-noddy` is an empty repo (README only). Goal: a desktop app where a user types a **theme** (and picks an **episode type**), and a crew of AI agents (producer, screenwriter, director, animator, composer…) writes and produces a ~5‑minute kids episode in the feel of old stop‑motion/puppet shows (Noddy's Toyland Adventures, Postman Pat, Fireman Sam). There is no real voice. Characters "mumble" like Pingu, and the music is music-box/ukulele style. The user watches the agents work live in a UI. LLMs can be local (LM Studio is installed with Qwen 3.x 27B/35B) or API (Claude etc.), and the model is chosen per agent.

Decisions confirmed with the user:
- **Original toyland cast.** No Noddy IP. The cast is in the same spirit: wooden peg-doll toys, felt, a small toy car.
- **Blender** makes the final render. **Godot** makes a fast real-time animatic preview.
- **~5 min, 15–25 shots** per episode.
- **Per-agent model mix**, configured in markdown like scriptorium and editable in the UI.

Environment findings: Node 24 (fnm), npm, pnpm, Python 3.13 and uv are present. **Blender, Godot and ffmpeg are NOT installed.** There is no NVIDIA GPU. The GPU is an AMD Radeon 8060S iGPU (Ryzen AI Max+ 395, ~96 GB shared VRAM), so we use **Eevee** rather than Cycles. LM Studio 0.4.25 is installed, with `lms.exe` at `~/.lmstudio/bin`.

## Architecture (mirrors `C:\projects\Personal\scriptorium`)
- **Stack:** TypeScript on Node 24, plus Electron and electron-vite. The UI uses React 19, Zustand and Phaser 3. Validation uses zod 4, `yaml` and chokidar. Tests use vitest and Playwright. The package manager is npm.
- **Engine as a separate process** (Electron `utilityProcess`, which can also run headless) behind a typed protocol. **All state lives in markdown/JSON files** in a data folder (`~/ToyboxStudio`, overridable with `--data` or `TOYBOX_DATA`). Seed defaults are copied in from `seed/`.
- **Port these scriptorium modules (copy and adapt, don't reinvent):**
  - `src/engine/models/*`: `OpenAiCompatClient` (LM Studio, Ollama, OpenAI, OpenRouter), `anthropic.ts`, `gemini.ts`, `mock.ts`, `sse.ts`, `ModelRegistry`, `ModelRouter` (fallback, retries), `ProviderLimiter`, `keys.ts` (env first, then Windows credential store).
  - `src/engine/pipeline/llm.ts`: `chatJson()` (zod → JSON schema, plus a repair retry), `stripThinking`, `extractJson`.
  - `src/engine/pipeline/prompts.ts`: `buildMessages`, `{{var}}` templates, `_rules.md`, and the prompt-version hash.
  - `src/engine/queue/jobs.ts` and `scheduler.ts`: file-backed jobs with deterministic ids, `register(task, handler)`, a `JobContext.chat()`, and per-agent state events. Extend it with **tool jobs** (Blender, Godot, ffmpeg, audio) that run child processes and stream their progress.
  - `src/engine/store/atomic.ts`, `watcher.ts`, `dataFolder.ts`, `src/shared/md.ts`.
  - `src/engine/budget/spend.ts`, for API spend caps.
  - `src/shared/protocol.ts` pattern: `snapshot`, `agent.state`, `job.started/token/done`, `handover`, `spend`, plus new `episode.updated`, `render.progress` and `asset.ready`.
  - Renderer: `api.ts` 50 ms event batching, the Zustand `applyEvents`, `Terminal.tsx` with `parseLog`, `demo/fake.ts` (fake engine for UI dev), and the custom sandboxed file protocol (`toybox-media:`) for thumbnails and videos.
- **Pure `advance(EpisodeState) → {patch, jobs}`** planner, like scriptorium's `pipeline/advance.ts`, so restarts are safe.

## Agent crew (seed/agents/*.md: persona + model override; prompts in seed/prompts/<role>/<task>.md)
LLM agents always output **validated JSON (zod)**. They never write raw keyframes or code; they choose from fixed vocabularies, and deterministic code does the rest.

| # | Agent | Kind | Output |
|---|---|---|---|
| 1 | **Producer / Showrunner** | LLM | `brief.md`: logline, moral, cast picks, locations, tone, target length. It approves the final cut summary. |
| 2 | **Screenwriter** | LLM | `outline.md` (beats), then `script.json` (scenes, action lines, dialogue lines with emotion + intent). The story must read **visually**, because dialogue is mumble. |
| 3 | **Story Editor** | LLM (different model family, via `avoidFamily`) | Review: age suitability, clarity without words, pacing, length. One or two rewrite rounds. |
| 4 | **Character Designer** | LLM | Picks cast from `seed/cast/*.md`. Guest puppets are designed as a `PuppetSpec` (body kit, colours, hat, accessory, voice pitch) within the toykit vocabulary. |
| 5 | **Set Designer** | LLM | Picks locations from `seed/sets/*.md`, or composes a set layout from the prop kit (houses, trees, road, shop, pond, hill, backdrop). |
| 6 | **Director** | LLM | `shots.json`: 15–25 shots with framing (wide/medium/close/over-shoulder), camera angle/move (locked, slow pan, push-in), staging marks, duration, and transitions (cut, iris wipe). |
| 7 | **Animator** | LLM | Per-shot `actions.json` from a fixed action vocabulary: `walk_to, hop, run_to, turn_to, look_at, wave, nod, shake_head, point, jump_joy, sad_slump, shrug, sit, stand, drive_to, pick_up, give, talk(line_id), gasp, laugh, sleep, wobble`. It sets timings and targets. |
| 8 | **Composer** | LLM | `music.json`: a theme motif plus per-scene cues as note lists (simple melody + chord root, tempo, mood, instrument preset: music box / glockenspiel / ukulele / tuba). |
| 9 | **Sound Designer** | LLM | `sfx.json`: cue list from the SFX library (bell jingle, car horn "parp", squeaky steps, boing, door, birds), plus a per-character voice profile. |
| 10 | **Continuity / QA** | deterministic + LLM fix | Validates the package: characters exist on the set, marks are reachable, durations sum to the target, dialogue fits its shot, and no unknown actions. Failures go back to the owning agent as a fix job. |
| 11 | **Puppet Workshop** | tool (Blender) | Builds puppets and sets as `.blend` + `.glb`, cached by spec hash. |
| 12 | **Animation Compiler** | tool (TS) | Turns actions into sampled transform tracks (12 fps) per object. **This is the single source of truth** for both Godot and Blender. |
| 13 | **Preview Crew** | tool (Godot) | Godot Movie Maker plays the tracks and writes an animatic per shot in minutes. |
| 14 | **Foley & Voice Booth** | tool (TS DSP) | Mumble voices, music render, SFX, mix → `audio/episode.wav`. |
| 15 | **Render Farm** | tool (Blender) | Eevee final render per shot, at 12 fps "on twos". |
| 16 | **Editor (Post)** | tool (ffmpeg) | Title card, shots, iris-wipe transitions, end card, audio mix → `out/episode.mp4`. |

**Pipeline stages:**
brief → outline → script → story review (rewrite loop) → **[optional user approval: script]** → design (cast + sets, run in parallel) → shots → actions (per shot, parallel) + music + sfx → QA → asset build → compile tracks → audio → **Godot animatic** → **[optional user approval: animatic]** → Blender render (per shot, resumable) → edit → done.

## Toykit: the stop-motion look (Blender Python, `blender/toykit/`)
- Run headless: `blender -b --factory-startup --python blender/run.py -- <job.json>`. One job file per invocation. Progress goes to stdout as JSON lines, which the engine parses into `render.progress`.
- **Puppets:** procedural peg-doll construction from primitives (rounded cylinder torso, sphere head, pin-jointed arms/legs, mitten hands). Painted dot eyes, plus **replacement mouths** (closed / mid / open, swapped per frame, like real stop-motion). Hats (bell cap, pom-pom, helmet, bonnet) and accessories come from parametric parts. Objects are parented per body part, with no armature, so glTF export to Godot stays trivial.
- **Materials:** painted wood (glossy, low-freq noise bump, chipped edges via a pointiness/AO mask), felt (fibre noise bump + sheen), clay, cardboard backdrop with painted sky. They are shared node groups in `toykit/materials.py`.
- **Stop-motion feel:**
  - Tracks are sampled at 12 fps with constant interpolation.
  - Small random "hand-placement" jitter per held pose (pos ±0.4 mm, rot ±0.3°).
  - Light flicker ±2%.
  - Miniature shallow DOF, a mostly locked-off camera, warm key + soft fill.
  - Compositor grain + vignette.
  - Render 12 unique fps, and ffmpeg doubles to 25/24 fps. This halves render time.
- **Sets:** a tabletop miniature built from a prop kit (toy houses, lollipop trees, felt hills, road) placed by `SetLayout` JSON.
- **Render budget:** 5 min ≈ 3,600 frames at 1280×720 Eevee. Expect roughly 1–2 h on the iGPU. There is a `preview` quality preset (640×360, low samples) and per-shot resume.

## Godot preview (`godot/preview/`, Godot 4.x, GDScript)
- `main.gd` reads `--episode <dir> --shot <n>` from the user args, loads the `.glb` puppets and set, and plays the compiled `tracks.json` and camera.
- Two modes:
  - **Movie Maker** (`--write-movie shot.avi --fixed-fps 12`) for the animatic. ffmpeg then converts it to mp4 with the mixed audio.
  - **Interactive scrub window**, launched from the UI ("Open in Godot").
- Materials are approximate (flat painted colours), because it is a blocking preview.

## Audio (`src/engine/audio/`, pure TS, writes WAV)
- **Mumble:** dialogue text → pseudo-syllables → a formant synth (glottal pulse + vowel formants) with per-character pitch, speed and timbre. The contour follows the emotion (questions rise, excited is faster/higher, sad is slower/lower). It also outputs a per-frame amplitude envelope, which drives the mouth replacement.
- **Music:** a simple additive/FM synth for music box, glockenspiel, ukulele pluck (Karplus-Strong) and tuba, rendered from `music.json`. The theme jingle plays on the title and end cards.
- **SFX:** synthesised where simple (boing, horn, jingle, squeak). There is an optional `seed/sfx/` folder for CC0 samples.
- **Mix:** dialogue ducks the music, and everything is normalised.

## Original seed cast and world (`seed/cast/`, `seed/sets/`, editable markdown)
**Town:** *Tumbletown*.

**Cast:**
- **Tock**, a wooden wind-up boy with a red pom-pom cap who drives a little yellow toy van.
- **Bobbin**, a felt teddy girl who loves fixing things.
- **Constable Buttons**, a toy-soldier policeman.
- **Granny Thimble**, a knitted gnome who runs the shop.
- **Moo-Moo**, a felt cow.
- **The Squibbles**, two cheeky jack-in-the-boxes. They are gentle troublemakers.

**Sets:** town square, Tock's house, the shop, the pond, the hill, the station.

**Episode types** (picked in the UI): adventure, lesson/moral, mystery, holiday special, silly comedy.

**Style preset:** `toyland-wood` (v1). The style is config (`seed/styles/*.md`: materials, lighting, fps, grain), so a "felt village" style can be added later.

## UI (Electron renderer)
- **Studio view (Phaser):** the scriptorium office pattern re-themed as a TV studio. Rooms are:
  - Writers' Room: Producer, Screenwriter, Story Editor.
  - Art Dept: Character and Set Designers.
  - Stage: Director, Animator.
  - Sound Booth: Composer, Sound.
  - Workshop / Render Farm / Edit Suite: the tool crews, with progress bars.
  - The scene shows agents at desks with state icons, task bubbles, model badges and handover lines.
- **New Episode dialog:** theme (free text), episode type, featured characters, length (default 5 min), style, model preset, and the approval checkpoints toggle.
- **Episode panel tabs:**
  - Brief.
  - Script: readable, with dialogue shown as "mumble" plus subtitle meaning.
  - Shots: storyboard grid with Godot thumbnails per shot.
  - Animatic player.
  - Render progress (per shot, frames done/ETA).
  - Final player + "Open folder".
- **Terminal:** live token streams per agent (ported).
- **Agents panel:** per-agent model picker (local vs API), pause/resume.
- **Settings:** providers, tool paths, budget.
- **Approve / Request changes** buttons at the checkpoints. A request for changes enqueues a rewrite job with the user's note.

## Config (seed/config/*.md, hot-reloaded)
- `providers.md`: LM Studio (`http://localhost:1234/v1`, `extra_body: {reasoning_effort: none}`), Ollama, Anthropic, OpenAI, OpenRouter.
- `roles.md`, with per-agent mix defaults:
  - Producer, Screenwriter and Story Editor → `anthropic/claude-sonnet-5-5`, falling back to local Qwen.
  - Director, Animator, Composer and Sound → local LM Studio Qwen 35B, falling back to Claude.
  - Model ids are verified via the `claude-api` skill at implementation time.
- `tools.md`: paths to blender, godot and ffmpeg. A `doctor` command checks their versions.
- `budget.md`, `pipeline.md` (approvals, target length, fps, render presets).

## Repo layout
```
src/engine/{models,queue,pipeline,agents,audio,anim,tools,store,budget,logs}
src/main  src/preload  src/renderer/{studio,ui,store,demo}  src/shared
blender/{run.py,toykit/{puppets,props,materials,look,render,export}.py}
godot/preview/{project.godot,main.gd,track_player.gd}
seed/{agents,prompts,config,cast,sets,styles,sfx}
tests/{unit,e2e,fixtures/episode-golden/}
docs/design.md  CLAUDE.md
```

## Milestones (each one ends runnable and tested)
1. **Scaffold + toolchain.**
   - Electron/vite/TS skeleton, CLAUDE.md, docs/design.md.
   - `npm run doctor`.
   - Install Blender (current LTS), Godot 4 and ffmpeg via `winget` (after asking the user to confirm the installs).
2. **Engine core port:** models, router, keys, chatJson, jobs, scheduler, protocol, data folder, seed, budget. Unit tests carried over.
3. **Story agents** (Producer → … → QA), with zod schemas in `src/shared/schemas.ts` and the `advance()` planner. Mock-provider e2e produces a full episode package.
4. **Toykit (Blender):** puppets, props, materials, the look. A golden fixture episode (hand-written JSON, 3 shots) renders stills and a short clip.
5. **Animation compiler + Godot animatic.** The same fixture plays in Godot Movie Maker, and the compiler is unit-tested (action → track samples).
6. **Audio:** mumble, music, SFX, mix, plus the mouth envelope wired into the tracks.
7. **Final render + Editor:** per-shot Blender render with resume, ffmpeg assembly (titles, iris wipes, audio) → `episode.mp4`.
8. **UI:** Studio Phaser view, New Episode dialog, episode tabs, players, approvals, agent model picker, fake engine demo.
9. **Real run:** an end-to-end episode with LM Studio + Claude, then tune prompts and record learnings in the handoff.

## Verification
- `npm run typecheck && npm run lint && npm test`. Covers: unit tests (router, chatJson, advance, anim compiler, audio synth determinism, QA validator) and an e2e with the mock provider from theme to complete episode package.
- `npm run doctor` reports Blender, Godot, ffmpeg and LM Studio as reachable.
- Golden fixture:
  - `npm run engine -- render-fixture` produces Blender stills/clip and a Godot animatic.
  - I inspect the stills (Read the PNGs) for the stop-motion look.
- `npm run dev:ui -- ?demo`, with a Playwright smoke test of the Studio view, the New Episode dialog and the episode tabs.
- Real run: theme "Tock loses his cap on a windy day", type "lesson", 5 min.
  - Watch the agents in the UI, approve the script, review the animatic, let the final render finish.
  - Confirm that `out/episode.mp4` plays with mumble, music and transitions, that the length is 4–6 min, and that there are 15–25 shots.
