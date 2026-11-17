# 0012. The XP ledger is the source of truth

**Status:** Accepted

## Context
XP comes from trivia, staff adjustments, streak bonuses and grants from other bots. Events can be replayed and buttons clicked twice; totals must never drift or double.

## Decision
Every XP change is a row in `jarvis_xp_ledger` with a unique `source_key` (`trivia:<attemptId>`, `streak:<member>:<day>`, `grant:<eventId>:<reason>`, `admin:<interactionId>`). `jarvis_progress` is a cache updated in the same transaction (`xp = xp + n`). A duplicate key inserts nothing and changes nothing. `/jarvis recalcular` rebuilds progress from the ledger with the same pure rules (property-tested).

## Consequences
- Idempotency without locks; a full audit trail of why anyone has their XP.
- Rule changes (e.g. level curve) apply by recalculating, not by migrating totals.

## Alternatives considered
- Only a running total: cheap but cannot be audited, repaired or deduplicated.
