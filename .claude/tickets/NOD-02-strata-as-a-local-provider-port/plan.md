# NOD-02: Strata as a local provider (port of scriptorium SCP-03)

**Ticket folder:** `.claude/tickets/NOD-02-strata-as-a-local-provider-port/`. **Branch:** `NOD-02_strata-local-provider` from `origin/master` (6eb613f). The staged `AGENTS.md` was carried over.

## Context

Scriptorium commit `8f54f93` ("SCP-03: Add Strata support", merged as PR #2) added Strata, the user's fast local Qwen3.8-Flash-Next server, as the first-choice local model with LM Studio as the fallback. The user wants the same support in Toybox Studio. The model layer here is a port of scriptorium's (`src/engine/models/*` is nearly identical), so the change carries over almost line for line.

Facts carried over from SCP-03 and checked again just now:
- Strata serves `http://127.0.0.1:8080/v1`. It is running right now: `/health` reports `loaded: true` and `max_context: 131072`, and `/v1/models` lists `qwen3.8-flash-next-iq3_s`. Strata ignores the `model` field, so fixed ids keep `roles.md` the same across quants. The user starts it with `D:\Strata\run-iq3_s.bat`, and Toybox only connects to it.
- No key is needed (`STRATA_API_KEY` is optional). Thinking is on by default; `extra_body.reasoning_effort` turns it down. `reasoning_content` deltas are already ignored by `OpenAiCompatClient`.
- **`response_format` must not be sent.** Strata checks structured output after generation and returns **502 `structured_output_failed`** on a bad answer. 5xx is retryable, and the router falls back on errors, so one bad JSON answer would end up on paid Claude Sonnet. `chatJson` (`src/engine/pipeline/llm.ts:69`) already parses, validates and repairs JSON without a schema.
- IQ3_S takes about 84 GB, so the LM Studio 27B/35B can't be loaded next to it. Toybox has no embeddings, so LM Studio isn't needed while Strata runs. Blender/Godot also use the iGPU's memory, so a render while Strata is loaded may be tight. This will be documented, not solved.

**Role defaults (mirroring SCP-03; can be changed in the agents panel):** Strata goes first wherever LM Studio is first now, and second wherever Claude is first. The QA check uses the `-low` thinking variant, like scriptorium's checks.

## Changes

### 1. `json_schema` provider flag (same as scriptorium)
- `src/shared/schemas.ts` `providerEntrySchema` (~line 53): `json_schema: z.boolean().default(true)` with a doc comment.
- `src/engine/models/registry.ts`: add `jsonSchema: boolean` to `ProviderInfo`, set it from `p.json_schema` in `load()` (~line 99), and pass it to `new OpenAiCompatClient({...})` in `setupClient()` (~line 156).
- `src/engine/models/openaiCompat.ts`: add `jsonSchema?: boolean` to `OpenAiCompatOptions`, and set `response_format` only when `req.schema && this.opts.jsonSchema !== false`.

### 2. `seed/config/providers.md`
- Add a `strata` entry after `lmstudio`: `kind: openai-compat`, `local: true`, `base_url: http://127.0.0.1:8080/v1`, `api_key_env: STRATA_API_KEY`, `concurrency: 1`, `discover: false`, `json_schema: false`. It has two models, both `family: qwen` with `context: 131072`: `qwen3.8-flash-next` (`reasoning_effort: none`) and `qwen3.8-flash-next-low` (`reasoning_effort: low`). This is the same YAML as scriptorium's.
- Body text:
  - mention Strata in the `kind` and `concurrency` notes;
  - add a `json_schema` field note;
  - add a "Strata" section adapted from scriptorium's (start/health check, one model per process on port 8080, the 84 GB memory note including Blender renders, `context` matching `--max-context`, and why `json_schema: false`).

### 3. `seed/config/roles.md`
- producer, screenwriter, story_editor: `[anthropic/claude-sonnet-5-5, strata/qwen3.8-flash-next, lmstudio/ista-daslab-qwen3.8-27b-…]`
- character_designer, set_designer, director, animator, composer, sound_designer: `[strata/qwen3.8-flash-next, lmstudio/nail-qwen3.6-35b-a3b-mtp, anthropic/claude-sonnet-5-5]`
- qa: `[strata/qwen3.8-flash-next-low, lmstudio/nail-qwen3.6-35b-a3b-mtp, anthropic/claude-sonnet-5-5]`
- Update the paragraph below the frontmatter to match.

### 4. Doctor (`src/engine/cli.ts` `runDoctor`, ~line 128)
- Add a `strata` row: `GET http://127.0.0.1:8080/health` with a 3 s timeout.
  - `OK` when it answers with `loaded: true` (detail: model name and max context);
  - `WARN` when it is not running or still loading ("optional: start D:\Strata\run-iq3_s.bat").
- It is never `MISSING`, because Strata is optional. Update the `doctor` help text in `src/engine/index.ts:27`.

### 5. Renderer
- `src/renderer/store/model.ts:209` `isLocalModel` fallback list: add `'strata'`.
- `src/renderer/ui/AgentsPanel.tsx`:
  - rename the optgroup `Local (LM Studio)` to `Local`, and update the comment on line 6;
  - change the hint on line 127 to "Local models run on LM Studio or Strata…".
- Demo only:
  - `src/renderer/demo/fake.ts:259`: treat `strata/` as local;
  - `src/renderer/demo/library.ts:~68`: add a `strata/qwen3.8-flash-next` model row.

### 6. Tests
- `tests/unit/models.test.ts`:
  - seed-config test: `strata` is available with no key, `local: true`, `jsonSchema: false`, its models are not paid, and `new ModelRouter(...).candidates('director')[0].ref === 'strata/qwen3.8-flash-next'` (check the `ModelRouter` constructor signature here);
  - fake-server test, copied from scriptorium: the default client sends `response_format`, `jsonSchema: false` does not, and `reasoning_content` is not emitted as text.
- `tests/unit/seed.test.ts:29`: the director's first model is now `strata/qwen3.8-flash-next`.
- `tests/unit/doctor.test.ts`: assert the `strata` row is `WARN` when unreachable, and `OK` with a fake `/health` that answers `{loaded:true}`. Make the fake fetch URL-aware.

### 7. Docs
- `docs/design.md`:
  - Decision 6: add "Strata (local Qwen3.8-Flash-Next) is the first local model, then LM Studio";
  - add a new Decisions row 14 for Strata (127.0.0.1:8080, user-started, `json_schema: false`, memory);
  - list Strata in the Engine `models/` bullet;
  - add a History entry for 2026-10-10.
- `CLAUDE.md` and `AGENTS.md` "Machine" sections (their content is the same there): add one line about Strata (`D:\Strata`, `run-iq3_s.bat`, port 8080, `/health`, 84 GB, so unload the big LM Studio models).

### Data folders
`~/ToyboxStudio` doesn't exist and `TOYBOX_DATA` is unset, so no live config needs updating. The scratch folders under `.claude/temp/*/config` keep their old config. To refresh one, use `npm run engine -- reset-seed --only config --data <dir>`. Mention this to the user and don't change them.

## Verification
1. `npm run typecheck && npm run lint && npm test` (and `npm run test:ui` if it's part of the normal run).
2. `npm run doctor`: the `strata` row shows OK (it is running now).
3. Live probes against the running Strata:
   - `npm run engine -- probe --model strata/qwen3.8-flash-next`: streams a reply, reports usage, 0 USD.
   - `npm run engine -- probe --model strata/qwen3.8-flash-next-low`: the made-up id is accepted.
4. A short headless run with a fresh `--data .claude/temp/strata-data`: start an episode and let the story and director stages run. The agent logs in `logs/agents/*.md` should show the structured roles done on `strata/...` with no 502s and no fallback. Stop before the Blender render.
5. Write `changelog.md` in the ticket folder and leave the changes uncommitted until the user asks.

## Implementation status

Sections 1 to 7 done and all verification steps run (uncommitted). Changelog: `changelog.md` in this folder.

- [x] 1. `json_schema` flag: `src/shared/schemas.ts`, `src/engine/models/registry.ts`, `src/engine/models/openaiCompat.ts`.
- [x] 2. `seed/config/providers.md`: `strata` entry, `json_schema` field note, "Strata" section (Claude Sonnet as paid fallback, Blender/Godot iGPU memory note).
- [x] 3. `seed/config/roles.md`: roles and paragraph updated as planned.
- [x] 4. Doctor: `strata` row in `src/engine/cli.ts` (OK when `loaded: true`, otherwise WARN, never MISSING); help line in `src/engine/index.ts`.
- [x] 5. Renderer: `store/model.ts`, `ui/AgentsPanel.tsx`, `demo/fake.ts`, `demo/library.ts`.
- [x] 6. Tests: `tests/unit/models.test.ts` (seed assertions, director candidate, fake-server response_format test), `tests/unit/seed.test.ts`, `tests/unit/doctor.test.ts` (WARN unreachable, OK with fake /health, WARN while loading, LM Studio still OK with URL-aware fetch).
- [x] 7. Docs: `docs/design.md` (decision 6, new decision 14, models bullet, History), `CLAUDE.md` and `AGENTS.md` Machine line.

Verification:
- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 29 files, 242 tests passed.
- `npm run test:ui`: 8 passed, 9 skipped (live Electron/screenshot specs).
- `npm run doctor`: `strata OK 127.0.0.1:8080 loaded, qwen3.8-flash-next-iq3_s, context 131072`.
- `npm run engine -- probe --model strata/qwen3.8-flash-next` and `...-low` (`--data .claude/temp/strata-data`): both streamed a reply, 0 USD (local).

Deviations: the ModelRouter candidates assertion uses `candidates('director')` (the scriptorium one used `line-editor`). The `src/renderer/office` badge change from scriptorium has no equivalent here. Old scratch data folders keep their old config (`reset-seed --only config --data <dir>` refreshes one).
- Step 4 (orchestrator): `npm run engine -- run-episode --data .claude/temp/strata-data --theme "Pip learns to share the red wagon" --length 2 --approve-all`, with `anthropic` and `lmstudio` set `enabled: false` in that scratch folder only, so no paid calls and no hidden fallback. It ran brief to qa in 575 s and was stopped at `assets` (Blender). Result: 38 jobs done, 0 failed, 36 model calls all on `strata/qwen3.8-flash-next` at 0 USD, no 502 and no fallback. The `qa` stage was a tool job, so the `-low` variant was only exercised by the probe.
- Follow-up after review: the `npm run doctor` line in the Commands sections of `CLAUDE.md` and `AGENTS.md` now mentions Strata.
