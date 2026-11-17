# 0026. AI is optional, OpenAI-compatible, off by default, and limited to flavor text

**Status:** Accepted

## Context
Generated taunts make the villain feel alive, but self-hosters may not want network calls, and a model must never decide game outcomes.

## Decision
`ultron.ai.provider` is `none` by default (static locale lines, seeded pick, no network). With `openai-compatible`, ULTRON calls `{AI_BASE_URL}/chat/completions` only after mechanics are stored, sending only decided facts. The answer is filtered (mentions, links, newlines removed; canon names rejected; 200 chars). A timeout, an error, an empty or filtered answer, or the hourly budget falls back to the static line. Only kind, provider, success and latency are logged.

## Consequences
Works offline and with a local Ollama (compose profile `ai`). AI text can never change a number.

## Alternatives considered
A vendor SDK: locks the project to one provider. Storing prompts and outputs: privacy cost for little value.
