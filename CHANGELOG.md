# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `legion content validate <file|folder> [--type] [--categories] [--json]`: checks trivia, mission, campaign (single files and import files), enemy and power files with the bots' own rules, without the database. Missions and campaigns are checked together and next to the shipped content (chapters, `requires`, cycles, `joinFaction`). In a folder, files of another type are skipped with a note. Exit 0 (valid), 1 (errors) or 2 (unknown type).

## [0.9.0] - 2026-11-18

### Upgrade notes
- **New team roles.** Cérebro creates the six new team roles (Vingadores, S.H.I.E.L.D., Guardiões, Defensores, Thunderbolts, Filhos da Meia-Noite) on the first start. Drag the bot's role above them in Server Settings → Roles; `legion doctor` and `/cerebro status` list any role above it. `/cerebro setup` (dry run by default) shows what else would change.
- **One-time origin change.** Heroes registered before v0.9 become Mutante with everything kept and may pick another origin once with `/heroi origem`. H.E.R.B.I.E. posts one announcement in the server; no DMs are sent.
- **`/mutante` is deprecated.** It keeps working as an alias of `/heroi` until v1.0. Run `legion register-commands` (or restart) so the new commands appear.
- **Custom trivia categories.** Servers that set their own `jarvis.trivia.categories` must add `vingadores`, `quarteto`, `cosmico` and `mistico` to get the new questions.
- **Tutorial.** Members of the old `boas-vindas` tutorial move to `primeiro-contato` once, at startup, with no message. A server `tutorial.yaml` with `chain: boas-vindas` is left as is.
- Migrations run on their own at startup, on SQLite and Postgres: Cérebro `0002_hero_origins` and `0003_faction_changes`, J.A.R.V.I.S. `0004_campaigns`. Back up `data/` first, as for every upgrade.

### Added
- Hero origins: registration now asks for an origin (Mutante, Inumano, Ciência, Tecnologia, Místico, Cósmico, Treinado) instead of a faction, then offers only the powers of that origin. Origins do not change stats. Every new hero starts Independente (`cerebro.teams.startFaction`). Config: `cerebro.origins`, `cerebro.teams` (ADR 0031, `docs/UNIVERSE.md`).
- 14 new powers: skills for Treinado and gadgets for Tecnologia. Power files accept `origins: [...]` (no key = every origin); `legion doctor` shows ❌ for an origin with no powers, which is also hidden from registration.
- `/heroi` (`ficha`, `poderes`, `origem`). `/mutante` keeps working as an alias until v1.0.
- `/heroi origem`: heroes registered before origins become Mutante with everything kept and may change origin once. H.E.R.B.I.E. posts one announcement per server (no DMs) and `/perfil` and `/heroi` remind the hero while the change is open.
- Nine teams as factions: Independente, X-Men, Irmandade (Mutante and Inumano only), Vingadores, S.H.I.E.L.D., Guardiões, Defensores, Thunderbolts and Filhos da Meia-Noite, each with a role, emoji and description. The six new roles are created on the next start. Factions accept `origins: [...]`; `cerebro.teams.switchCooldownDays` (30) is read by the recruitment arcs. Servers with their own `factions` or `roles` keep them; `legion doctor` lists the new teams (ℹ️), fails when `startFaction` is not a team, and warns about heroes on a team that was turned off (they show and get the role as Independente).
- `/cerebro equipe mover membro equipe motivo` (staff): moves a hero to any enabled team, ignoring the origin rule and the cooldown, swaps the role and records who did it and why. Every team change is stored in `cerebro_faction_changes`; registration writes the first row. New event `player.faction_changed`.
- `legion doctor` has an ℹ️ status for tips that need no action.
- Campaigns: missions grouped into chapters that unlock in order. Campaign files in `content/campaigns/` (server files override by id); missions gain `campaign: { id, chapter }`, `requires` (missions, level, origins, current team) and `reward.joinFaction` (see below). Locked missions are hidden from `/missao iniciar`, a typed id says what is missing, and in a party the lobby lists who is missing what and the leader cannot start. Progress is derived from runs ended in success (ADR 0032, `docs/MISSIONS.md`).
- Recruitment arcs join the team: finishing the last chapter of a recruitment campaign with success asks Cérebro (`faction.join_requested`), which checks the team, the origin rule and `cerebro.teams.switchCooldownDays` since the last switch (the first team after registration does not wait), swaps the role, records the change and emits `player.faction_changed`; a refusal emits `player.faction_change_refused` and the mission thread shows the reason and the date. Arcs of a team that does not take the hero's origin stay locked.
- Tutorial arc: H.E.R.B.I.E.'s tutorial is now the **Primeiro contato** campaign (`primeiro-contato`, three chapters: choices, an optional group, a first fight), with profile and trivia steps in between and a final message about teams and `/campanha`. Without J.A.R.V.I.S. it falls back to `/cerebro preferencias` and `/heroi poderes`; without ULTRON or Sentinel the fight step is left out. Members of the old `boas-vindas` tutorial are moved once at startup with no message (finished stays finished). `docs/TUTORIAL.md`.
- Eight recruitment arcs, one per team, each 3 chapters ending in a fight, pt-BR and en: X-Men "Aula na Mansão X" (`aula-na-mansao`), Irmandade "O chamado da Irmandade" (`convite-no-metro`, Mutante and Inumano only), Vingadores "Teste dos Vingadores" (`armadura-roubada`), S.H.I.E.L.D. "Agente em teste" (`agente-em-teste`), Guardiões "Carona na Milano" (`carona-espacial`), Defensores "Noites em Hell's Kitchen" (`noites-no-bairro`), Thunderbolts "Segunda chance" (`segunda-chance`) and Filhos da Meia-Noite "Depois da meia-noite" (`depois-da-meia-noite`). Each opens at level 3; canon team members appear in the story and every enemy is one of ULTRON's original machines. Every shipped campaign is played to the end in CI.
- "Visita ao Edifício Baxter" (`visita-ao-baxter`): a story campaign with the Fantastic Four, 4 chapters with 2 fights, parties of up to 3, open to every team.
- Four trivia categories with 22 sourced pt-BR questions each: `vingadores`, `quarteto`, `cosmico` and `mistico` (118 shipped questions in all). They are in the default `jarvis.trivia.categories`.
- `/campanha [campanha]`: campaigns with progress and the next chapter, or one campaign's chapters (done, available, locked with the reason).
- `/jarvis campanha importar`: one YAML with a campaign and its missions; preview, then Publicar writes everything or nothing. Shipped ids are refused. Database: `jarvis_campaigns` and `jarvis_missions.campaign_id`, `chapter`, `requires` (migration `0004`, both dialects).

### Changed
- `/missao lista` shows only the next chapter of each campaign (the first one not won yet) and says to use `/campanha` for the rest; the list also stays within Discord's embed limits instead of cutting at 25 missions.
- `mission.completed` now carries `missionId` = the mission's id from its file (e.g. `primeiro-contato-1`) and a new `runId`; before, `missionId` held the run id. Tutorial steps match chapters with `where: { missionId, outcome: success }`.
- The shipped mission `primeiro-contato` is replaced by the chapters `primeiro-contato-1`, `-2` and `-3`; the old one is turned off on the next start, and its past runs stay in the history.
- A lost campaign chapter can be played again until it is won. Standalone story missions are still once only unless `missions.limits.storyRepeatable` is on.
- Player-facing text says "herói" instead of "mutante" in every bot, the guide and the glossary; the sheet and card show the origin, and the free-text "Origem" field is now "História". The default role name "Mutante Registrado" is unchanged (roles are matched by name).
- `player.created` and `MutantView` include `originType`. Database: `mutants.origin_type`, `mutants.origin_rechoice`, `members.pending_origin` (migration `0002_hero_origins`, both dialects); members left at the old faction step continue from the origin step and keep their faction.
- Missions can visit the Marvel universe: titles, scenes and choice labels may name canon heroes, teams, villains and places ("O Capitão América convoca você"). Identities stay original: codenames, powers, enemies, items and AI text are still checked (ADR 0030, `docs/UNIVERSE.md`).
- The canon-name list now covers the wider Marvel universe (Avengers, Fantastic Four, Guardians, Defenders, Thunderbolts, Midnight Sons, S.H.I.E.L.D., Inhumans, major villains and team names). Entries starting with `=` only match the whole name, so common words still work in longer names ("Estrela Nova").

## [0.8.1] - 2026-11-18

### Added
- `legion playtest-report --since <90m|3h|2d|data>`: read-only summary of a session from the database (registrations, missions with their members and XP, XP by reason, fights, staff content) with checks: XP paid once and equally, ledger = progress, daily/weekly limits, fights with the right party. Exits 1 when something does not match; `--json`.
- `docs/PLAYTEST.md`: script for a live test session with friends.

## [0.8.0] - 2026-11-18

### Added
- `/jarvis trivia importar arquivo:`: up to 50 questions from a `.yaml` (the `/jarvis trivia exportar` format), with a preview and Publicar/Cancelar. All or nothing; the same `id` updates a staff question; `jarvis.trivia.review: second_staff` sends imported questions to review.
- Website: a page for each bot (commands generated from the bots' own definitions; CI fails when stale) and a "Personalizar" guide with downloadable examples.
- Website editors for missions, trivia and enemies: they check drafts with the bots' own rules (including the filter for existing character names), keep drafts in the browser, open existing files, and offer Download, Copy and the import command. Nothing is sent anywhere.

### Changed
- Errors in content files and imports (missions, trivia, enemies) are now in Portuguese, like the rest of the staff messages.

## [0.7.2] - 2026-11-17

### Added
- `TUTORIAL.md`: step-by-step guide for server owners, with a check after each step.
- `website/`: static project page (no build, no external requests).

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

[Unreleased]: https://github.com/uminocelo/legion/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/uminocelo/legion/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/uminocelo/legion/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/uminocelo/legion/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/uminocelo/legion/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/uminocelo/legion/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/uminocelo/legion/compare/v0.4.0...v0.7.0
[0.4.0]: https://github.com/uminocelo/legion/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/uminocelo/legion/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/uminocelo/legion/releases/tag/v0.2.0
[0.1.0]: https://github.com/uminocelo/legion/releases/tag/v0.1.0
