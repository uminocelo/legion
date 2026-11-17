# 0020. Combat is a pure function of seed, combatants and recorded actions

**Status:** Accepted

## Context
Fights must be verifiable by staff and must survive restarts mid-round without changing the outcome.

## Decision
The engine in `bot-sentinel/src/domain/combat/` has no Discord, database or clock. A combat stores its seed, its combatants as they started, and per round the effective actions and an idle flag. Resolving a round replays the whole fight from the seed plus the stored rounds and the new one; the stored state (HP, cooldowns) is only a cache. `logHash` (SHA-256 of canonical JSON) is stored with `combat.resolved`, and `/sentinel replay` recomputes it.

## Consequences
Resolution cost grows with the round count (at most `maxRounds` = 20 by default), which is negligible. Changing a rule changes old replays; a committed golden log catches accidental changes, and intended ones need a new ADR.

## Alternatives considered
Saving the RNG state between rounds: shorter, but the state is opaque and a bug can silently desync. Server-side randomness per action: not replayable.
