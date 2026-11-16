# 0004. In-process typed event bus with a DB outbox

**Status:** Accepted

## Context
Bots must not call each other, and a crash must not lose or duplicate side effects across bots.

## Decision
`bus.emit(tx, type, payload)` validates with zod and inserts into `core_event_log` inside the caller's transaction; `bus.transaction(fn)` dispatches the collected events only after commit. Consumers have stable ids; success is recorded in `core_event_consumption`. Failures are retried by the scheduler (`core.event-retry`, 1s/5s/30s/2m/10m), then marked `failed`. On boot, unconsumed events from the last 7 days are replayed. Consumption status is `done`, `pending` (awaiting retry) or `failed`.

## Consequences
- At-least-once delivery: every handler is idempotent.
- No event for a rolled-back change.
- Emitting with a transaction from another bus throws (programming error).

## Alternatives considered
- Plain EventEmitter: loses events on crash.
- Redis/NATS: an extra service for every owner.
