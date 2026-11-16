# Contributing to Legion

## Setup

- Node 22+ (`.nvmrc`), pnpm 10 (`npm i -g pnpm@10`).
- `pnpm install && pnpm build`
- Run locally: copy `.env.example` → `.env` and `legion.config.example.yaml` → `legion.config.yaml`, then `pnpm dev`.
- CLI from a clone: `pnpm legion doctor`.

## Checks (CI runs all of them)

```bash
pnpm lint        # Biome
pnpm typecheck   # tsc -b
pnpm test        # Vitest on SQLite (in memory)
TEST_DATABASE_URL=postgres://user@localhost:5432/legion_test pnpm test   # same suite on Postgres
docker build .
```

Every test gets an isolated database (a fresh SQLite file, or its own Postgres schema). Use `createTestContext` from `@legion/core` with the `FakeDiscordGateway` and `FakeClock` to drive whole flows; never call Discord in tests.

## Commits and PRs

[Conventional Commits](https://www.conventionalcommits.org/): `feat(cerebro): …`, `fix(core): …`, `docs: …`, `test: …`, `chore: …`. One logical change per PR, with tests. New runtime dependencies need a reason in the PR description or an ADR.

## Database changes

Edit both `schema.sqlite.ts` and `schema.pg.ts` (the parity test fails otherwise), then from the package folder:

```bash
pnpm db:generate --name=short_description
```

Migrations are append-only. No DB-level foreign keys (see ADR 0002).

## Adding an event

Events are a shared contract. Update the catalog in `00-main.md` §6.2 first, then `packages/core/src/events/catalog.ts` and `docs/EVENTS.md` (a test checks they match). Handlers must be idempotent (delivery is at-least-once).

## Adding a locale key

Add the key to `locales/pt-BR.json` **and** `locales/en.json` of the package, with the same `{placeholders}` — the parity test fails otherwise. User-facing text never lives in code.

## Architecture decisions

Write an ADR in `docs/adr/NNNN-title.md` (Status, Context, Decision, Consequences, Alternatives considered) for anything that changes a shared rule.
