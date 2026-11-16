# 0005. DB-backed scheduler instead of Redis

**Status:** Accepted

## Context
Bots need delayed jobs (retries, reminders) and recurring jobs (daily resets) that survive restarts.

## Decision
`core_jobs` stores jobs. The scheduler polls (`scheduler.pollIntervalMs`, default 5s), claims due jobs with a conditional UPDATE and a lock expiry, retries with backoff up to `maxAttempts`, and supports dedupe keys and cron recurring jobs registered with `ensureRecurring` (idempotent).

## Consequences
- Second-level precision is enough for a game; no sub-second timers.
- Works the same on SQLite and Postgres; expired locks are recovered after a crash.

## Alternatives considered
- BullMQ/Redis: robust but another service.
- In-memory timers: lost on restart.
