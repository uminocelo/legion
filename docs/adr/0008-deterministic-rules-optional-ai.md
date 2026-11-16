# 0008. Deterministic game rules; AI only for flavor text

**Status:** Accepted

## Context
Fairness and testability require that the same inputs give the same outcome. Some owners want generated narration.

## Decision
All game math (stats, XP, combat) is deterministic and lives in `packages/core/src/game`, using a seeded PRNG (mulberry32) where randomness is needed; the seed is stored so results can be replayed. An optional AI provider (`AI_*` env vars) may only produce flavor text, checked against the canon-name blocklist, and the game works fully without it.

## Consequences
- Property tests can cover game rules.
- Combat seeds may exceed int4; Sentinel will store them as bigint.

## Alternatives considered
- AI-driven outcomes: not reproducible, not fair, not testable.
