# 0024. Encounters are deterministic from a stored seed and stored multipliers

**Status:** Accepted

## Context
Enemies must be fair, auditable and reproducible, and difficulty may adapt over time.

## Decision
`buildEnemies` is a pure function of party level, party size, difficulty, the active templates, a seed and an adaptive multiplier. Each encounter stores its seed, multiplier and the resulting enemies. Templates are picked with `mulberry32(seed)` from the list sorted by id. The adaptive multiplier is a clamped function of the last resolved party encounters and is off by default.

## Consequences
Same inputs give the same enemies (tested, including fast-check properties). Changing template files changes future encounters only; past ones keep their stored enemies.

## Alternatives considered
Unseeded randomness: not reproducible. Live adaptive tuning per fight: hard to audit.
