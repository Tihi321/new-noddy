---
kind: providers
providers:
  - id: lmstudio
    kind: openai-compat
    local: true
    base_url: http://localhost:1234/v1
    concurrency: 1
    discover: true
    models:
      - id: nail-qwen3.6-35b-a3b-mtp
        family: qwen
        extra_body: { reasoning_effort: none }
      - id: ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp
        family: qwen
        extra_body: { reasoning_effort: none }
  - id: strata
    kind: openai-compat
    local: true
    base_url: http://127.0.0.1:8080/v1
    api_key_env: STRATA_API_KEY   # optional: only sent if set
    concurrency: 1
    discover: false               # Strata answers any model name, so fixed ids keep roles.md the same across quants
    json_schema: false
    models:
      - id: qwen3.8-flash-next
        family: qwen
        context: 131072
        extra_body: { reasoning_effort: none }
      - id: qwen3.8-flash-next-low
        family: qwen
        context: 131072
        extra_body: { reasoning_effort: low }
  - id: ollama
    kind: openai-compat
    enabled: false
    local: true
    base_url: http://localhost:11434/v1
    concurrency: 1
    discover: true
    models: []
  - id: anthropic
    kind: anthropic
    base_url: https://api.anthropic.com
    api_key_env: ANTHROPIC_API_KEY
    concurrency: 4
    models:
      # prices are USD per 1M tokens: verify them on the Anthropic pricing page
      - id: claude-opus-5-5
        family: claude
        context: 200000
        max_output: 32000
        price_in: 5
        price_out: 25
        price_cached_in: 0.5
      - id: claude-sonnet-5-5
        family: claude
        context: 200000
        max_output: 16000
        price_in: 3
        price_out: 15
        price_cached_in: 0.3
      - id: claude-haiku-5-5
        family: claude
        context: 200000
        max_output: 16000
        price_in: 1
        price_out: 5
        price_cached_in: 0.1
  - id: openai
    kind: openai-compat
    base_url: https://api.openai.com/v1
    api_key_env: OPENAI_API_KEY
    concurrency: 4
    models: []
  - id: openrouter
    kind: openai-compat
    base_url: https://openrouter.ai/api/v1
    api_key_env: OPENROUTER_API_KEY
    concurrency: 4
    models: []
  - id: mock
    kind: mock
    enabled: false
    concurrency: 4
    models:
      - id: mock-a
        family: mock
      - id: mock-b
        family: mock-other
---
# Providers

One entry per provider. Edit this file and the engine picks the change up without a restart. API keys are never written here: `api_key_env` names an environment variable, and the engine also looks in the Windows credential store under that name (`npm run key:set <NAME>`).

A model is written `provider/model`, for example `anthropic/claude-sonnet-5-5` or `lmstudio/nail-qwen3.6-35b-a3b-mtp`.

## Fields of a provider

- `id`: the name used in model references.
- `kind`: `openai-compat` (any OpenAI-style API: LM Studio, Strata, Ollama, OpenAI, OpenRouter), `anthropic`, `gemini`, or `mock` (scripted, for tests).
- `enabled`: `false` switches the provider off. A provider whose key can't be found is skipped automatically.
- `local`: `true` for models on this machine. Local models cost nothing and never count against the budget caps.
- `base_url`, `api_key_env`: where to call and which variable holds the key.
- `concurrency`: how many requests may run at once. LM Studio and Strata are 1 because all their requests share one GPU.
- `rpm`: optional requests per minute limit.
- `discover`: ask the provider for its models (`GET /v1/models`) and add the ones not listed here. LM Studio does this, so every model you have downloaded shows up in the model pickers.
- `json_schema`: `true` (the default) sends the JSON schema of a structured answer as `response_format`. Set `false` for a server that answers a bad JSON reply with an error instead of constraining it. The prompt then asks for the JSON shape and the engine checks it and repairs it.

## Fields of a model

- `id`, `family` (reviewers prefer a different family than the writer), `context`, `max_output`.
- `price_in`, `price_out`, `price_cached_in`: USD per 1M tokens. Cached input falls back to `price_in` when missing.
- `extra_body`: JSON fields merged into the request body. The LM Studio Qwen models send `reasoning_effort: none`, which turns thinking off (much faster, and the agents only need short JSON).
- LM Studio loads models with a small context window unless you change it. Episodes need 16384 tokens or more: for example `lms load nail-qwen3.6-35b-a3b-mtp -c 32768 --parallel 1 -y`.
- The `openai` and `openrouter` entries have no models listed: add the ones you want to use, with their prices.

## Strata

Strata (`D:\Strata`) is a fast local server for Qwen3.8-Flash-Next with an OpenAI-style API. It is the first choice in the roles that used LM Studio. Toybox Studio only connects to it, you start it:

- Run `D:\Strata\run-iq3_s.bat` (or `run-iq2_xs.bat`). Loading the model takes 1 to 3 minutes. Check `curl http://127.0.0.1:8080/health` and wait for `loaded: true`. Until then requests fail, and the router falls back to the next model in the role. `npm run doctor` shows the same check.
- It serves one model per process, and every quant uses port 8080. It ignores the `model` field of a request, so the two ids above (no thinking, and thinking on `low`) only differ in `extra_body`. They stand in for the LM Studio 27B and 35B models.
- The IQ3_S quant takes about 84 GB, so it does not fit beside the big LM Studio models: unload them while Strata runs. Toybox has no embedding model, so LM Studio is not needed at all then. Blender and Godot renders also use the iGPU's memory, so a render while Strata is loaded may be tight.
- `context` must match `--max-context` in the run config (131072).
- `json_schema: false` because Strata checks a structured answer after the fact and fails the request (502 `structured_output_failed`) when it is bad. That would be retried and then sent to paid Claude Sonnet, while the engine's own parse-and-repair step already copes with a loose JSON answer.
- No key is needed. `STRATA_API_KEY` is only sent if you set it.
