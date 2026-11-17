# 0013. J.A.R.V.I.S. is the only XP writer

**Status:** Accepted

## Context
Future bots (H.E.R.B.I.E. tutorials, Sentinel, ULTRON events) will reward members. If each wrote XP tables directly, rules (levels, ranks, streaks, caps) would be duplicated and drift.

## Decision
Only J.A.R.V.I.S. writes `jarvis_xp_ledger` and `jarvis_progress`, through `XpService.award`. Other bots emit `xp.grant_requested { memberId, amount, reason }`; the `jarvis.xp-grant` consumer turns it into a ledger entry keyed `grant:<eventId>:<reason>`, so replays are no-ops. Others read progress through the `progress` read model, never the tables.

## Consequences
- One place for XP rules; grants are asynchronous (applied right after the emitter's commit).
- If J.A.R.V.I.S. is disabled, grants stay in the event log and are replayed when it is enabled (within the lookback window).

## Alternatives considered
- A shared XP library writing from every bot: same rules, but no single owner of the tables and harder idempotency.
