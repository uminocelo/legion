# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-16

### Added
- Core runtime: config loading with readable errors, SQLite/Postgres via Drizzle with per-package migrations, typed event bus with DB outbox, replay and retries, DB-backed scheduler, interaction router with rate limits and error boundary, `RoleService` with the TikTok role guard, i18n (pt-BR, en), personas, `/healthz`.
- Cérebro: onboarding (welcome → rules → faction → archetype → mutant sheet), canon-name blocklist with staff flag, unique codenames, rejoin restore, opt-in roles, `/perfil`, `/cerebro preferencias`, `/cerebro setup`, `/cerebro status`, `rank.changed` handling.
- Runner with graceful shutdown; `legion` CLI with `init`, `doctor`, `register-commands`, `invite-url`.
- Docker image (amd64, arm64), `docker-compose.yml` with optional Postgres profile, CI and release workflows.
- Docs: README, self-hosting guide, architecture, config, events, ADRs 0001–0011.

[Unreleased]: https://github.com/uminocelo/legion/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/uminocelo/legion/releases/tag/v0.1.0
