# 0023. DB-backed rate limiter shared by all bots

**Status:** Accepted

## Context
Limits must hold across restarts and apply to every bot the same way; staff must never be blocked.

## Decision
Sentinel provides `rateLimiter` to core. Fixed windows live in `sentinel_rate_buckets` (atomic upsert per key and window start). The router asks the limiter's `policyFor(interaction)` for the limits and a staff bypass, then consumes `cmd:<user>` (per minute) or `cmp:<user>` (per 10 s). Every rejection is a violation; enough violations in 10 minutes raise a `rate_limit` flag. A daily job prunes old windows. Without Sentinel, core keeps its in-memory limiter.

## Consequences
One extra small write per interaction. Limits are per member across all bots, not per bot.

## Alternatives considered
In-memory only: resets on restart. Per-bot limiters: inconsistent and harder to reason about.
