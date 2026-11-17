# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Optional Discord app per bot: `<BOT>_TOKEN` and `<BOT>_CLIENT_ID` (e.g. `JARVIS_TOKEN`). Each app registers and answers only its bots' commands, with only their intents and permissions; Cérebro's app keeps roles and member events. One process, one database.
- `legion init` asks one app or one per bot; `doctor` checks each app; `invite-url` prints one link per app; `register-commands` registers per app and removes moved commands from the shared app.
- ADR 0016.

## [0.2.0] - 2026-11-16

### Added
- J.A.R.V.I.S.: XP ledger (every change is an entry with a unique source key), levels, ranks (Cérebro swaps the roles), daily streaks with bonus, `xp.grant_requested` consumer.
- `/trivia` with 30 sourced pt-BR questions, per-member cooldown, no-repeat window, time limit, speed bonus and daily XP cap; idempotent answers that survive restarts.
- `/ranking` (week/month/all time, faction filter), `/sequencia`, `/perfil` section, staff `/jarvis xp | trivia recarregar | trivia estatisticas | recalcular`.
- Server trivia packs in `./data/content/trivia/*.yaml`, synced by id (removed questions become inactive, never deleted).
- ADRs 0012–0015 (XP ledger, single XP writer, lazy local-day streaks, trivia content as files).

### Fixed
- SQLite: concurrent write transactions no longer fail with `SQLITE_BUSY` (transactions are serialized and busy statements retried).

## [0.1.0] - 2026-11-16

### Added
- Core runtime: config loading with readable errors, SQLite/Postgres via Drizzle with per-package migrations, typed event bus with DB outbox, replay and retries, DB-backed scheduler, interaction router with rate limits and error boundary, `RoleService` with the TikTok role guard, i18n (pt-BR, en), personas, `/healthz`.
- Cérebro: onboarding (welcome → rules → faction → archetype → mutant sheet), canon-name blocklist with staff flag, unique codenames, rejoin restore, opt-in roles, `/perfil`, `/cerebro preferencias`, `/cerebro setup`, `/cerebro status`, `rank.changed` handling.
- Runner with graceful shutdown; `legion` CLI with `init`, `doctor`, `register-commands`, `invite-url`.
- Docker image (amd64, arm64), `docker-compose.yml` with optional Postgres profile, CI and release workflows.
- Docs: README, self-hosting guide, architecture, config, events, ADRs 0001–0011.

[Unreleased]: https://github.com/uminocelo/legion/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/uminocelo/legion/releases/tag/v0.2.0
[0.1.0]: https://github.com/uminocelo/legion/releases/tag/v0.1.0
