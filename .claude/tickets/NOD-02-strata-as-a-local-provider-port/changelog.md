# Changelog

## 2026-10-10 · NOD-02 · Strata added as a local provider (port of scriptorium SCP-03)

Toybox Studio can use Strata, the user's local Qwen3.8-Flash-Next server on `127.0.0.1:8080`. It is the first local model in every role, and a short episode ran on it from brief to QA with no failures and no fallback.

### new-noddy, branch `NOD-02_strata-local-provider` (from `origin/master` 6eb613f)

Engine
- `src/shared/schemas.ts`: new provider field `json_schema` (default `true`).
- `src/engine/models/registry.ts`: `ProviderInfo.jsonSchema`, passed to `OpenAiCompatClient`.
- `src/engine/models/openaiCompat.ts`: `response_format` is only sent when `jsonSchema !== false`. Strata fails a bad structured answer with a 502 that would be retried and then go to paid Claude, while `chatJson` already parses and repairs loose JSON.
- `src/engine/cli.ts`: `npm run doctor` has a `strata` row (`GET /health`, 3 s). It is OK when `loaded: true`, WARN when unreachable, loading or on an HTTP error, and never MISSING.
- `src/engine/index.ts`: doctor help line mentions Strata.

Seed config
- `seed/config/providers.md`: `strata` provider (`local`, `concurrency: 1`, `discover: false`, `json_schema: false`, optional `STRATA_API_KEY`) with `qwen3.8-flash-next` (thinking off) and `qwen3.8-flash-next-low` (thinking `low`), both 131072 context. Field note for `json_schema`, and a "Strata" section on starting it, the health check, one model per process, about 84 GB of memory (unload the big LM Studio models; Blender/Godot renders share the iGPU memory), and why `json_schema: false`.
- `seed/config/roles.md`:
  - creative roles: Claude Sonnet, then Strata, then LM Studio 27B;
  - structured roles: Strata, then LM Studio 35B, then Claude Sonnet;
  - `qa`: Strata `-low` first;
  - the description is updated to match.

Renderer
- `src/renderer/store/model.ts`: `strata` counts as local in `isLocalModel`.
- `src/renderer/ui/AgentsPanel.tsx`: the picker group is now "Local"; the hint says LM Studio or Strata.
- `src/renderer/demo/fake.ts`, `src/renderer/demo/library.ts`: the demo treats `strata/` as local and lists the Strata model.

Tests
- `tests/unit/models.test.ts`:
  - `strata` is available without a key, is local, has `jsonSchema: false`, and is not paid;
  - `director` resolves to Strata first;
  - fake-server test: `response_format` is sent by default and not with `jsonSchema: false`, and `reasoning_content` is not emitted as text.
- `tests/unit/seed.test.ts`: director's first model is now Strata.
- `tests/unit/doctor.test.ts`: URL-aware fake fetch; strata WARN when unreachable, OK on `loaded: true`, WARN while loading.

Docs
- `docs/design.md`:
  - decision 6 updated;
  - new decision 14 (Strata);
  - Strata listed in the `models/` bullet;
  - History entry.
- `CLAUDE.md`, `AGENTS.md`: Machine line about Strata, and the Commands doctor line mentions Strata. `AGENTS.md` was a staged new file before this ticket and was carried onto the branch.

### Deviations from the plan
- The router test uses `candidates('director')`; scriptorium's `line-editor` has no equivalent here.
- Scriptorium's office badge and provider colour changes were not ported: Toybox has no such view.
- Added after review: the Commands line about `npm run doctor` in `CLAUDE.md`/`AGENTS.md` now mentions Strata.

### Verification
- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 29 files, 242 tests passed.
- `npm run test:ui`: 8 passed, 9 skipped (the live Electron/screenshot specs skip by design).
- `npm run doctor`: `strata OK 127.0.0.1:8080 loaded, qwen3.8-flash-next-iq3_s, context 131072`.
- `npm run engine -- probe --model strata/qwen3.8-flash-next` and `...-low`: both streamed a reply at 0 USD.
- Episode run on a scratch folder (`.claude/temp/strata-data`, `anthropic` and `lmstudio` set to `enabled: false` there only), `run-episode --theme "Pip learns to share the red wagon" --length 2 --approve-all`:
  - it reached brief, outline, script, review, design, shots, animate and qa in 575 s, and was stopped at `assets` (Blender);
  - 38 jobs done, 0 failed;
  - all 36 model calls ran on `strata/qwen3.8-flash-next` at 0 USD, with no 502 and no fallback.

Not run:
- Blender assets, render and the rest of the pipeline while Strata is loaded (memory headroom not checked).
- Fallback behaviour with Strata stopped. The router fallback is covered by the existing unit tests.
- The `-low` variant inside a pipeline job. The `qa` stage was a tool job in this run.

### Follow-ups and limits
- Existing scratch data folders under `.claude/temp/*` keep their old config. `npm run engine -- reset-seed --only config --data <dir>` refreshes one. `~/ToyboxStudio` does not exist yet, so it gets the new seed on first run.
- Strata takes about 84 GB, so check render memory before running Blender with Strata loaded.

### Status
Uncommitted on `NOD-02_strata-local-provider`.
