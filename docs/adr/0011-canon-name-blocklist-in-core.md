# 0011. Canon-name blocklist in core, shared by all bots

**Status:** Accepted

## Context
Players, enemies and AI text must use original names, not Marvel characters.

## Decision
`packages/core/data/canon-names.txt` (PT and EN names) and `isCanonName(text)` in `core/game/canon.ts`, which normalizes accents, case, spacing, punctuation and leetspeak digits and checks exact and contained matches. Every bot uses it (codenames now; community content and AI output later). Cérebro flags 3 attempts in 10 minutes to staff via `report.flagged`.

## Consequences
- One list to maintain; some false positives for names that contain a canon name.

## Alternatives considered
- Per-bot lists: drift. AI moderation only: not deterministic.
