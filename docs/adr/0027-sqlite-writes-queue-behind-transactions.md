# 0027. SQLite: plain writes queue behind open transactions

**Status:** Accepted (extends 0002)

## Context
libSQL 0.18 runs SQLite synchronously from a connection pool. When a plain write waited for the lock of an open transaction, SQLite's busy wait blocked the event loop, so the transaction could not finish: consumers of the same event stalled 5–10 s. With a zero busy timeout the write failed fast, but the failed statement stayed open on its pooled connection and the next transaction there could not commit.

## Decision
The SQLite client is created with `timeout: 0`. Transactions stay serialized in-process (0002), and every statement that may write (and every batch) waits in the same queue, so the process never makes SQLite wait on itself. Reads run at once (WAL). A write waits at most 5 s, so a stray plain write inside a transaction fails instead of hanging. Busy errors from other processes are retried asynchronously.

## Consequences
No busy waits on the event loop; writes are ordered. A write issued with the plain handle inside a transaction callback is a bug and fails after 5 s.

## Alternatives considered
A pool of one connection: libSQL rejects plain statements while a transaction holds it. Retrying whole transactions: the leftover statement keeps failing the commit.
