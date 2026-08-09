---
title: Providers
description: OpenAI Responses, Codex Agent, Grok Agent, and DeepSeek
---

# Providers

Chris Assistant uses explicit model-registry routing. Unknown model IDs fail validation; there is no catch-all provider.

| Provider | Authentication | Best use | Chris tools | Images | Headless schedules |
|----------|----------------|----------|-------------|--------|--------------------|
| OpenAI Responses | `chris openai login` (ChatGPT OAuth) | Everyday assistant work | Full | Yes | Yes |
| Codex Agent | `codex login` | Coding and workspace work | Agent-oriented; memory context is injected | Text-only | No by default |
| Grok Agent | Grok CLI OAuth | Alternative agentic workspace work | Limited initially | Text-only until verified | No by default |
| DeepSeek | `DEEPSEEK_API_KEY` | Economical text chat and reasoning | Full text-tool set | Via the configured OpenAI image model | Yes |

Provider capability metadata lives in the central model registry so the CLI, Telegram `/model`, doctor output, and dashboard report the same provider, model, requested effort, effective effort, and capabilities.

## OpenAI Responses

This is the subscription-backed personal-assistant path. It streams from the Responses endpoint, uses the shared tool registry, and supports memory, recall, journal, schedules, and image inputs.

Authentication uses OAuth + PKCE through `chris openai login`. Tokens and account metadata are stored in `~/.chris-assistant/openai-auth.json` with owner-only permissions. Do not copy that file into the repository, support messages, or logs.

## Codex Agent

The Codex Agent path uses `@openai/codex-sdk`, which launches the Codex CLI with a persistent thread and a workspace sandbox. It is a separate backend and a separate OAuth session from OpenAI Responses.

Use `codex login` once as the same operating-system user that runs Chris Assistant. The agent receives relevant identity and memory context, but it must not be described as having the full Chris memory, journal, or schedule tool set until those integrations are implemented and verified.

## Grok Agent

Grok Agent launches the authenticated Grok CLI directly in headless streaming mode. It must use an explicit workspace, permission policy, timeout, bounded turns, and cancellation. OAuth state belongs to the Grok CLI; never put copied browser cookies or OAuth tokens into `.env`.

Treat Grok as an agentic workspace provider initially. Chris-specific memory, journal, and schedule tools are limited until an explicit, guarded bridge is implemented.

## DeepSeek

DeepSeek uses its OpenAI-compatible Chat Completions API with the shared text-tool registry. Configure `DEEPSEEK_API_KEY` in the local `.env` only. The key must be redacted from CLI configuration output, doctor output, dashboard responses, errors, and logs.

Thinking-mode tool loops must preserve DeepSeek's `reasoning_content` between assistant tool calls. DeepSeek is text-only in this integration; incoming images continue through the configured OpenAI image model.

## Reasoning effort

`AI_REASONING_EFFORT` records the requested level, but each model registry entry defines which values are valid. User-facing status must show both the requested and effective values; the application must not silently claim an unsupported level was honoured.

Typical commands after provider integration:

```bash
chris model set terra --effort medium
chris model set codex-agent --effort high
chris model set grok --effort high
chris model set deepseek-flash --effort high
```

Run `chris model` for the authoritative installed aliases and effort choices.

## Streaming and cancellation

All four providers stream through the `Provider` callback. `/stop` must cancel the active operation for the current chat without affecting concurrent work. OpenAI and DeepSeek cancel network requests; Codex and Grok terminate their bounded child-process runs.

## Adding a provider

1. Implement the `Provider` interface.
2. Add explicit models, aliases, capabilities, context limits, authentication, and supported effort values to the central registry.
3. Add provider construction and abort/session handling.
4. Add doctor checks and redacted setup guidance.
5. Verify streaming, cancellation, tool filtering, unknown-model rejection, and headless suitability.
