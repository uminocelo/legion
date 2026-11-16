# 0002. Self-hostable, SQLite by default, optional Postgres

**Status:** Accepted

## Context
Server owners are often not developers and run Legion on a home PC or a Raspberry Pi. Some want a managed Postgres.

## Decision
SQLite (libSQL, WAL) is the default (`file:./data/legion.db`). `DATABASE_URL=postgres://…` switches to Postgres. Every table is defined twice (sqlite and pg Drizzle schemas) and a parity test keeps them identical; each package ships migrations for both dialects, tracked in its own `__migrations_<package>` table. Columns are snake_case. No DB-level foreign keys: drizzle-kit pins Postgres FKs to the `public` schema, which breaks non-default schemas (used for test isolation); integrity is enforced by unique indexes and code.

## Consequences
- Backups are "copy ./data".
- No `FOR UPDATE SKIP LOCKED`; the scheduler claims jobs with a conditional UPDATE that works on both (single process anyway).
- The test suite runs twice in CI.

## Alternatives considered
- Postgres only: an extra service for every owner.
- SQLite only: blocks owners who want hosted DBs.
