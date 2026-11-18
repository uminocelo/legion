# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- CLI (`legion doctor`, `register-commands`): waits Discord's `retry_after` and retries when rate limited (HTTP 429) instead of reporting ❌.

## [0.7.1] - 2026-11-17

### Changed
- `.env`: the main app is now `CEREBRO_TOKEN` and `CEREBRO_CLIENT_ID`. Without them, `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` still work as the main app; the log and `legion doctor` warn until you rename them. Set together with `CEREBRO_*`, `DISCORD_*` keeps its old meaning: the shared app for bots without their own. `legion init` writes the new names.

## [0.7.0] - 2026-11-17

Includes the work planned for 0.5.0 (missions) and 0.6.0 (staff content), which were not released on their own.

### Added
- J.A.R.V.I.S. missions: `/missao lista | iniciar | abandonar`. Branching stories in a thread with button choices, solo or in a party of up to 4 (lobby with join/leave/start, majority vote, leader breaks ties). Daily, weekly and story missions with XP through the ledger (`reason: mission`), limits and timeouts in `jarvis.missions`, and restart recovery.
- Mission fights: a combat scene sends `mission.started` (`missionType: combat`, `missionId = <runId>:<sceneId>`) so ULTRON spawns the enemies and Sentinel runs the fight in the mission thread; the story continues on the win or lose branch. Fight missions are hidden when ULTRON or Sentinel is off.
- 4 original missions (pt-BR and en); server missions in `data/content/missions/*.yaml` (`docs/MISSIONS.md`).
- `channels.missions`; `legion doctor` checks mission files, the missions channel and whether fights can run.
- H.E.R.B.I.E.: the "first mission" tutorial step is on by default; `/regras` glossary entry for missions.
- Staff trivia from Discord: `/jarvis trivia nova` (form with question, choices, answer, explanation and source), `lista | editar | desativar | ativar | exportar`. Live at once, or approved by a second staff member with `jarvis.trivia.review: second_staff`. Edits keep history; file reloads never touch staff questions; disabled questions stay off.
- Trivia sources may be a reference such as "Shang-Chi #4 (2021)", shown in the footer; extra categories via `jarvis.trivia.categories`.
- Imports from attachments: `/jarvis missao importar` and `/ultron inimigo importar` validate a `.yaml` (Discord CDN only, 64 KB), show a preview and publish live on **Publicar**. Plus `lista | desativar | ativar` for missions and enemies. Imported content wins over files with the same id and survives restarts and reloads.
- Cérebro mutant sheet: registration picks 1 main power and up to 2 secondary ones from a catalog of 32 generic powers in 6 types (`content/powers.yaml`, server override in `data/content/powers.yaml`). The main power type sets the archetype (`cerebro.powers.typeToArchetype`); powers have no numeric effect. `cerebro.powers.enabled: false` brings back the archetype menu. `docs/POWERS.md`.
- `/mutante poderes`: mutants registered before the catalog pick their powers once; the archetype stays unless `cerebro.powers.allowArchetypeChange`.
- `/perfil` and **Compartilhar** attach the sheet as a PNG card (codename, faction color, archetype, powers, level, rank, stats). Rendered with resvg (WebAssembly) and bundled OFL fonts, no native dependencies; `cerebro.profileCard: false` turns it off.
- H.E.R.B.I.E. `/herbie guia publicar [canal]`: posts the "how to play" guide (registration, powers, progress, trivia, missions, combat, events; sections of disabled bots are skipped) and pins it; publishing again edits the same messages. Server copy in `data/content/guide.<locale>.yaml`. Glossary: new "Poderes" entry; combat, events and report entries no longer say "future version".
- `legion doctor`: `<bot>.staff-commands` warns when staff roles without Administrator cannot use the staff commands; guide in `docs/SELF_HOSTING.md`. New `docs/STAFF.md`.

### Changed
- H.E.R.B.I.E. asks for Pin Messages (to pin the guide).
- The registration form's power field is now "Descreva seu poder" (the free-text description next to the catalog powers).
- J.A.R.V.I.S. asks for Create Public Threads and Send Messages in Threads (mission threads).
- Sentinel keeps a fight in the channel quietly when that channel is already a thread.

## [0.4.0] - 2026-11-17

### Added
- Sentinel: deterministic turn-based combat (mulberry32 seed, fixed dice order, SHA-256 log hash, `replayCombat`), combat sessions from `combat.requested` in threads with round buttons, timeouts, abandonment, `raid_strike` and restart recovery; `/treino`, `/combate status | log`, `/sentinel replay`. Rules in `docs/COMBAT.md`.
- DB-backed rate limiter for every bot with staff bypass, violations and `rate_limit` flags; XP anomaly and new-account flags.
- Reports: `/denunciar`, the "Denunciar mensagem" context menu, grouping, a staff-only moderation queue (resolve, ignore, warn by DM, timeouts, history) with every action logged; `/sentinel denuncias | historico`.
- Core: rate limiters can set per-interaction limits and a bypass (`RateLimiter.policyFor`).
- ADRs 0020–0023.
- `legion doctor` and startup check that each app's bot role has every permission its bots ask for in the invite link, and say how to fix it.
- ULTRON: original enemy templates (validated, canon names refused, server overrides), pure level scaling with optional clamped adaptive difficulty, encounters for combat missions (`mission.started`) and `/ultron spawn`, outcomes stored per encounter.
- World events: weekly invasion and raids with shared HP worn down by `raid_strike` fights in Sentinel, announce/start/end jobs that survive restarts without double posts, throttled HP embed, results with top damage and damage per faction, XP per participant through J.A.R.V.I.S.; `/ameaca`, `/ultron evento agendar | iniciar | cancelar`, `/ultron status`. Docs in `docs/WORLD_EVENTS.md`.
- Optional AI flavor text (`ultron.ai.provider: openai-compatible`, Ollama compose profile `ai`): only after mechanics are decided, filtered, budgeted, timed out to static lines; no network calls with the default `none`.
- Config validation: ULTRON requires Sentinel. ADRs 0024–0027.
- `/sentinel replay` and `/combate log` accept the short combat id (`#ABC123`) and autocomplete recent combats; timeouts explain a missing permission, an admin target or the role order before trying.

### Fixed
- SQLite: a transaction in one event consumer no longer stalls the other consumers of the same event for 5–10 s (libSQL busy waits blocked the event loop); plain writes now queue behind open transactions.
- `xp.grant_requested` grants are unique per member, so one source event can pay several members.

## [0.3.0] - 2026-11-17

### Added
- Optional Discord app per bot: `<BOT>_TOKEN` and `<BOT>_CLIENT_ID` (e.g. `JARVIS_TOKEN`). Each app registers and answers only its bots' commands, with only their intents and permissions; Cérebro's app keeps roles and member events. One process, one database.
- `legion init` asks one app or one per bot; `doctor` checks each app; `invite-url` prints one link per app; `register-commands` registers per app and removes moved commands from the shared app.
- ADR 0016.
- H.E.R.B.I.E.: 3-step tutorial started on registration (DM first, channel fallback on closed DMs), XP per step through J.A.R.V.I.S. and a completion bonus, `/tutorial` (backfill, restart, skip), data-driven steps with fallbacks.
- `/ajuda` (state-aware, filtered by enabled bots and staff), `/regras` glossary with accent-insensitive autocomplete (pt-BR and en), `/idioma` with a core `LocaleResolver`, optional daily tips, world-event explanations, staff `/herbie status | dica-agora`, doctor checks.
- Bots can declare extra channels for `legion doctor` (checked with the permissions of the app hosting the bot).
- Buttons on messages sent by DM now work (handled as a member without roles).
- ADRs 0017–0019.

### Fixed
- Event replay on startup no longer feeds a newly enabled bot events from before it was first started.

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

[Unreleased]: https://github.com/uminocelo/legion/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/uminocelo/legion/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/uminocelo/legion/compare/v0.4.0...v0.7.0
[0.4.0]: https://github.com/uminocelo/legion/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/uminocelo/legion/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/uminocelo/legion/releases/tag/v0.2.0
[0.1.0]: https://github.com/uminocelo/legion/releases/tag/v0.1.0
