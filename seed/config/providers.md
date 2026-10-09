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
- `kind`: `openai-compat` (any OpenAI-style API: LM Studio, Ollama, OpenAI, OpenRouter), `anthropic`, `gemini`, or `mock` (scripted, for tests).
- `enabled`: `false` switches the provider off. A provider whose key can't be found is skipped automatically.
- `local`: `true` for models on this machine. Local models cost nothing and never count against the budget caps.
- `base_url`, `api_key_env`: where to call and which variable holds the key.
- `concurrency`: how many requests may run at once. LM Studio is 1 because all its requests share one GPU.
- `rpm`: optional requests per minute limit.
- `discover`: ask the provider for its models (`GET /v1/models`) and add the ones not listed here. LM Studio does this, so every model you have downloaded shows up in the model pickers.

## Fields of a model

- `id`, `family` (reviewers prefer a different family than the writer), `context`, `max_output`.
- `price_in`, `price_out`, `price_cached_in`: USD per 1M tokens. Cached input falls back to `price_in` when missing.
- `extra_body`: JSON fields merged into the request body. The LM Studio Qwen models send `reasoning_effort: none`, which turns thinking off (much faster, and the agents only need short JSON).
- LM Studio loads models with a small context window unless you change it. Episodes need 16384 tokens or more: for example `lms load nail-qwen3.6-35b-a3b-mtp -c 32768 --parallel 1 -y`.
- The `openai` and `openrouter` entries have no models listed: add the ones you want to use, with their prices.
