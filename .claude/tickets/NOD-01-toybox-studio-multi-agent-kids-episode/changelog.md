# Changelog — NOD-01 Toybox Studio MVP

## 2026-10-09 — NOD-01: multi-agent stop-motion kids-episode factory, end to end

**Outcome:** a user enters a theme and episode type. A crew of 10 LLM agents and 6 tool crews then writes, stages, animates, scores and renders a ~5-minute episode in a stop-motion puppet style: Blender final render, Godot animatic, mumble voices, music-box music. The user watches it all in a toy-studio Electron UI. One full 5-minute episode was produced end to end with local LM Studio models.

**Repo:** `new-noddy`
**Branch:** `NOD-01_toybox-studio-mvp` (from `origin/master`)
**Commit status:** **uncommitted** (≈222 new files outside `.claude/`).

### What was added
| Area | Paths | Behaviour |
|---|---|---|
| Scaffold | `package.json`, `tsconfig*.json`, `electron.vite.config.ts`, `vite.*.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `playwright.config.ts`, `.gitignore`, `.gitattributes`, `CLAUDE.md`, `docs/design.md`, `docs/contracts.md` | Electron, React 19, TypeScript, Node 24 app. `docs/contracts.md` is the single source of truth for every JSON passed between the engine, Blender and Godot. |
| Engine core (ported from scriptorium) | `src/engine/{models,queue,store,budget,logs,agents}`, `src/engine/{engine,index,cli,transport,summary}.ts`, `src/shared/{protocol,schemas,md}.ts` | <ul><li>Providers: LM Studio, Ollama, OpenAI, OpenRouter, Anthropic and Gemini, all streaming.</li><li>Router with fallback and retries, plus per-provider limits.</li><li>File-backed job queue and scheduler, extended with tool jobs, deterministic jobs and progress events.</li><li>Budget, and hot-reloaded markdown config.</li><li>CLI commands: `doctor`, `probe`, `run-episode`, `reset-seed`, `key-set`.</li></ul> |
| Tool detection | `src/engine/tools/{detect,exec}.ts` | Finds Blender, Godot and ffmpeg (configured path, PATH, WinGet, Program Files) and runs child processes with streamed output. |
| Story pipeline | `src/shared/episode.ts`, `src/engine/pipeline/{advance,pipeline,handlers,qa,repair,catalog,episodeStore,install}.ts`, `seed/prompts/**` | <ul><li>Zod schemas for every contract.</li><li>A pure `advance()` planner runs brief → outline → script → review/rewrite → script approval → design → shots → actions/music/sfx → QA (deterministic, with a fix loop) → assets → voice → compile → mix → preview → animatic approval → render → edit.</li><li>Commands: `newEpisode`, `approve`, `requestChanges`, `retryEpisode`.</li><li>Action repair and shot-duration fitting cover the slips local models make.</li></ul> |
| Animation compiler | `src/engine/anim/{compile,camera,target,curves}.ts` | Turns the action vocabulary into tracks sampled at 12 fps: walk, hop, wave, talk with replacement mouths, drive and the rest. Also does auto camera framing (vehicle-aware, toy-table height), baked stop-motion jitter, separation of overlapping actors, and auto SFX events. |
| Audio | `src/engine/audio/{wav,dsp,rng,mumble,music,sfx,mix}.ts` | <ul><li>Pingu-like formant "mumble" voice per character and emotion, with mouth levels.</li><li>Music box, glockenspiel, ukulele (Karplus-Strong), tuba, xylophone and recorder.</li><li>20 synthesised SFX.</li><li>Ducking mix with a −1 dBFS ceiling. `audio/episode.json` records the timeline layout.</li></ul> |
| Tool handlers | `src/engine/tools/handlers/{registry,animAudio,blender,godot,edit,media}.ts` | <ul><li>`voice_lines`, `compile_tracks`, `mix_audio`.</li><li>`build_puppet` and `build_set`, cached by hash.</li><li>`render_shot`, which can resume.</li><li>`preview_shot` and `animatic`.</li><li>`edit_episode`: title and end cards, crisp iris wipes and fades, H.264 at CRF 25 with `-tune animation`.</li></ul> |
| Blender toykit | `blender/run.py`, `blender/toykit/*.py`, `blender/tests/*`, `blender/README.md` | Procedural peg-doll puppets for 6 body types, with hats, accessories, replacement mouths and vehicles. Also a prop kit, painted-wood, felt, knit and clay materials, a painted sky backdrop, warm lighting, DOF, grain, vignette and light flicker. Renders with Eevee, picking the right engine name at runtime on Blender 5.2. |
| Godot preview | `godot/preview/*` | Loads glb files at runtime and plays the tracks, including the Blender→Godot axis conversion. Movie Maker mode outputs the animatic. Interactive mode has a scrub slider. |
| Seed world | `seed/cast/*` (7 original Tumbletown puppets), `seed/sets/*` (6), `seed/styles/toyland-wood.md`, `seed/agents/*` (16 crew), `seed/config/*` | Original cast, with no Noddy IP. Each role's default models can be changed per agent. |
| UI | `src/main/**` (Range-capable `toybox-media:` protocol), `src/preload/**`, `src/renderer/**` | <ul><li>Phaser toy studio: 7 rooms, puppet and robot crew, state bubbles, model badges, handovers, progress bars.</li><li>New Episode dialog.</li><li>Episode tabs: Brief, Script (mumble text with its meaning), Shots, Animatic, Render, Final.</li><li>Approvals, Try again, Open in Godot.</li><li>Terminal, crew model picker, and Settings (tools, keys, budget, reset to defaults).</li><li>A fake engine for `?demo`.</li></ul> |
| Tests | `tests/unit/**` (29 files), `tests/e2e/episode-mock.test.ts`, `tests/ui/{smoke,screenshots,electron-live}.spec.ts`, `tests/fixtures/{story,episode-golden}` | Unit tests, an end-to-end run against a mock provider, Playwright tests against the demo, and a live Electron spec. |

### Deviations from the plan
- **Rename:** "book" is now "episode" throughout. Agent `kind` is `llm | tool`, with a `room` field. Hire and fire were dropped because the crew is fixed.
- **QA:** QA is a deterministic job that needs no model. Only errors start fix rounds; warnings are recorded and never trigger one.
- **Blender grain and vignette:** applied with numpy after each frame instead of in the Blender compositor, because the compositor API differs between 4.x and 5.x.
- **Godot:** the Godot preview recovers colours from the material name when a glb has no base colour. Blender now also exports `baseColorFactor`.
- **Added beyond the plan:**
  - The `run-episode` and `reset-seed` CLI commands.
  - A seed-drift warning.
  - `retryEpisode`.
  - Range support in the media protocol, needed for seeking video.
- **Models:** no Anthropic key is set, so every role ran on local LM Studio models. The default for creative roles is still Claude Sonnet 5.5, with local Qwen as the fallback.

### Verification
**Run and passing:**
- `npm run typecheck`, `npm run lint`, `npm test` (29 files, 240 tests), `npm run test:ui` (8 passed, 9 live/screenshot tests skipped by design).
- `npm run doctor`: Blender 5.2.2 LTS, Godot 4.7.2, ffmpeg 9.0.2 and LM Studio all OK.
- **Real run:** "Tock loses his cap on a windy day", lesson type, 5 min, all local.
  - 18 shots. `out/episode.mp4` is 297 s at 1280×720, 24 fps, H.264 with AAC.
  - About 10 min of LLM work, 86 s for the animatic, 45 min of Blender render (~0.8 s/frame) and 57 s of edit.
  - The edit was redone with the new encoder settings: 75 MB.
- **Live Electron spec (`LIVE=1`, 7/7):**
  - The real episode, tabs, thumbnails and video (playback and seeking) work over `toybox-media:`.
  - A new episode started from the UI reached the script-approval banner.
- **Visual review** of Blender stills, final frames, Godot thumbnails and UI screenshots.

**Not run / not verified:**
- Nobody has listened to the audio; it was only measured (levels, durations, peaks).
- No Blender final render was done after the post-M9 framing and overlap changes. They were checked only through Godot thumbnails and Blender preview stills.
- The Anthropic and other API providers are untested, since no keys are set. The Anthropic prices in `seed/config/providers.md` are placeholders.
- "Open in Godot" and "Reset to defaults" were not clicked against the live engine; both are covered by unit tests.

### Follow-ups and known limitations
- Wide shots on the hill still have a lot of empty foreground, and hill shots look alike.
- The establishing shot at 28 mm can show the edge of the sky dome.
- The Godot preview has no sky backdrop.
- An episode that fails QA after its last fix round can't be retried in a useful way.
- Existing data folders don't get seed updates automatically. Use `reset-seed` or the Settings button.
- Run notes are in `m9-run-notes.md`.
- `.claude/temp/` holds about 14 GB of test renders and data folders, which are safe to delete.

### Late fixes (same day)
- `src/renderer/store/store.ts`, `ui/NewEpisodeDialog.tsx`, `studio/StudioView.tsx`: the UI auto-selects a newly started episode, and the studio stepper follows the running episode. There is no dedicated test for this, and the live spec was not re-run afterwards.
- `seed/styles/toyland-wood.md`: added `name: Toyland Wood`.
- Re-verified: typecheck, lint, `npm test` (240) and `npm run test:ui` (8 passed).
