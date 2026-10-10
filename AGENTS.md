# Toybox Studio

A desktop app (Electron) where a crew of AI agents writes and produces a ~5 minute kids' episode in the look of old stop-motion puppet shows. The user types a theme and watches the crew work. `docs/design.md` is the source of truth for architecture and decisions; the ticket plan is `.Codex/tickets/NOD-01-toybox-studio-multi-agent-kids-episode/plan.md`.

## Rules

- All state lives in markdown or JSON files in the data folder (default `~/ToyboxStudio`, override with `--data <dir>` or `TOYBOX_DATA`). Jobs, agents, config, episodes, logs and spend are files. The engine can be restarted at any time and carries on from the files.
- Config is markdown with YAML frontmatter in `seed/config/*.md`, copied into the data folder (never overwriting) and hot-reloaded.
- API keys never go in the repo or in any file. They come from environment variables or the Windows credential store (`npm run key:set <NAME>`).
- LLM agents output zod-validated JSON and choose from fixed vocabularies (actions, shots, moods, instruments, props). They never write raw keyframes, code or Blender scripts. Deterministic code does the rest. Validate every model reply with `chatJson()` and a zod schema.
- Content is for ages 3 to 6: gentle, kind, never scary. Characters mumble (no real words); the story must read visually. The shared rules are in `seed/prompts/_rules.md`.
- Tool crews (Blender, Godot, ffmpeg, audio DSP) are tool jobs: no model, child processes, progress through `ctx.progress()`.
- The animation compiler's sampled tracks are the single source of truth for both Godot and Blender.
- Original cast and world only (Tumbletown). No existing characters or IP.
- Temporary, scratch and intermediate files go under `.Codex/temp/` (git-ignored). Durable ticket notes go in `.Codex/tickets/<ticket>/`.

## Layout

```
src/engine   models, queue, pipeline, agents, tools, store, budget, logs (headless engine, also run by Electron)
src/main     Electron main: engine utilityProcess, IPC, toybox-media: protocol
src/preload  window.toybox.on / send
src/renderer React UI
src/shared   protocol.ts, schemas.ts, md.ts
seed/        defaults copied into the data folder: config, agents, prompts, cast, sets, styles
tests/       unit, e2e, fixtures
```

## Commands

- `npm run dev` runs the app. `npm run engine -- [--data <dir>]` runs the engine headless (JSON event lines on stdout).
- `npm run engine -- probe [--model provider/model]` lists reachable providers and models. `npm run doctor` checks Node, Blender, Godot, ffmpeg, LM Studio and Strata (exit code 0 even when tools are missing).
- `npm run typecheck && npm run lint && npm test` must pass before a change is done.

## Machine (Windows 11)

- Node 24 through fnm (it may not be on PATH in non-interactive shells). npm is the package manager.
- LM Studio runs at `http://localhost:1234/v1` (`lms.exe` in `~/.lmstudio/bin`). The GPU is an AMD iGPU, so Blender uses Eevee, not Cycles.
- Strata (fast local Qwen3.8-Flash-Next) lives in `D:\Strata`: the user starts `run-iq3_s.bat`, it serves `http://127.0.0.1:8080/v1` (`/health` says `loaded: true`) and takes about 84 GB, so unload the big LM Studio models while it runs.
- Blender, Godot and ffmpeg may need installing: see `npm run doctor`.
