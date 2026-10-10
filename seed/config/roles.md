---
kind: roles
roles:
  producer:
    models: [anthropic/claude-sonnet-5-5, strata/qwen3.8-flash-next, lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp]
  screenwriter:
    models: [anthropic/claude-sonnet-5-5, strata/qwen3.8-flash-next, lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp]
  story_editor:
    models: [anthropic/claude-sonnet-5-5, strata/qwen3.8-flash-next, lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp]
  character_designer:
    models: [strata/qwen3.8-flash-next, lmstudio/nail-qwen3.6-35b-a3b-mtp, anthropic/claude-sonnet-5-5]
  set_designer:
    models: [strata/qwen3.8-flash-next, lmstudio/nail-qwen3.6-35b-a3b-mtp, anthropic/claude-sonnet-5-5]
  director:
    models: [strata/qwen3.8-flash-next, lmstudio/nail-qwen3.6-35b-a3b-mtp, anthropic/claude-sonnet-5-5]
  animator:
    models: [strata/qwen3.8-flash-next, lmstudio/nail-qwen3.6-35b-a3b-mtp, anthropic/claude-sonnet-5-5]
  composer:
    models: [strata/qwen3.8-flash-next, lmstudio/nail-qwen3.6-35b-a3b-mtp, anthropic/claude-sonnet-5-5]
  sound_designer:
    models: [strata/qwen3.8-flash-next, lmstudio/nail-qwen3.6-35b-a3b-mtp, anthropic/claude-sonnet-5-5]
  qa:
    models: [strata/qwen3.8-flash-next-low, lmstudio/nail-qwen3.6-35b-a3b-mtp, anthropic/claude-sonnet-5-5]
---
# Roles

The default models for each LLM role, as an ordered list of `provider/model`. The first model is the default. If it fails, is rate-limited or is over budget, the next one is tried. An agent's own `model` field (in `agents/<agent>.md`) goes in front of this list. You can also change them in the app, in the agents panel.

The creative roles (producer, screenwriter, story editor) default to Claude Sonnet and fall back to Strata (local Qwen3.8-Flash-Next) and then the LM Studio Qwen 27B. The structured roles (character and set designers, director, animator, composer, sound designer) default to Strata, then the LM Studio Qwen 35B, then Claude Sonnet. QA does the same with Strata's `-low` thinking variant. Available Claude ids: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`.

The tool crews (puppet workshop, animation compiler, preview crew, foley booth, render farm, editor) run programs and need no model.
