# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Seasons (US-22): `jarvis.season` (off by default; `length` month or 7–90 days; `reset: season_score`; `rewards.top`). `/temporada` shows the season board and the caller's badges. Staff `/jarvis temporada iniciar|encerrar`. Ending writes winners + archive JSON, emits `season.ended` once, and `jarvis.season-rewards` grants place badges idempotently. Lifetime XP is never wiped. Guide [docs/SEASONS.md](docs/SEASONS.md); site pages for J.A.R.V.I.S. and the community playbook.
- Squad content (US-37): optional `squad` on mission/campaign/trivia YAML; rows store `squad_id`. With `squads.enabled`, only members with an active seat see that content. Founders submit via `/esquadrao conteudo enviar`; staff approve or refuse in the mod queue.
- Squad war ranking (US-36): when `squads.enabled`, a score stamps the hero's active squad on the war ledger. `/guerra` shows that squad's points and rank inside the team. Leaving the squad keeps past points on it.

## [1.1.0] - 2026-11-22

Squads: a founder requests a group under a base team, staff approve it, and members join by invite or by code.

### Upgrade notes
- **Squads off by default.** `squads.enabled: false` leaves registration, teams and the invite link as they were. Turning them on is [docs/SQUADS.md](docs/SQUADS.md).
- **Migration** `0004_squads` on Cérebro (squads, squad members, `members.pending_squad_id`). Existing servers get empty tables. It runs on restart.
- **Guild Invites.** With squads on, the process also listens for invite create and delete. This is not a privileged intent in the Developer Portal. Restart after you change `squads.enabled`.
- **Permissions.** With squads on, `legion invite-url` also asks for Manage Server, Create Invite, Create Private Threads and Manage Threads. With squads off, the link does not. `legion doctor` (line **Esquadrões**) names each missing one. Every team except Independente needs `factions[].squadChannelId`, and `channels.welcome` is where the permanent invite is created.
- **The `registered` role is now "Herói Registrado".** On the first start, Cérebro renames your existing "Mutante Registrado" role in place: same role, every member keeps it, channel permissions stay. Nothing to do. To keep the old name, set `name: Mutante Registrado` on the `registered` role in `roles`. If the bot's role sits below it, the rename fails with a warning in the logs and the old name keeps working.

### Added
- Squads (US-35): `/esquadrao criar`, `entrar`, `sair` and `ver`. Staff approve, refuse or archive with `/cerebro esquadrao` or the **Esquadrões** dashboard panel; approve, refuse and staff archive are audited. An approved squad gets a role, a private thread, a permanent invite and a 6-character code. A new member joining by that invite or code joins the base team when they are still registering or Independente. An Irmandade squad refuses any other origin and registration continues. One squad per member. The last free seat is given to one joiner. A deleted invite is recreated the next time the leader or staff opens `/esquadrao ver`. Leaving the server drops the seat; the founder leaving archives the squad and posts in the mod queue. A team change that is not the join itself drops the seat, including the leader's.
- Events `squad.created`, `squad.joined` and `squad.left`. `player.faction_changed` accepts `reason: 'squad'`.

### Changed
- Default role name `registered`: "Mutante Registrado" → "Herói Registrado", since heroes of every origin register. Roles gain `renamedFrom`, so role sync renames instead of creating a duplicate.

## [1.0.0] - 2026-11-21

The world: faction war, multi-wave invasions, the threat meter, and an optional staff dashboard with audited actions.

### Upgrade notes
- **Migration** `0002_world_v1` on ULTRON (wars and war points; nothing is paid retroactively). No J.A.R.V.I.S. migration. Restart so it runs.
- **New commands** `/guerra` and `/ultron guerra iniciar`, `encerrar` and `pontos`. Restart (or `legion register-commands`) so Discord shows them.
- **`/mutante` is removed.** Use `/heroi`. Register the commands again so Discord drops the old name.
- **Migration** none for waves and the threat meter: `0002_world_v1` already holds their columns and tables. Events started before the upgrade read as one wave.
- **Waves and threat on by default.** Invasions get 1–3 waves from the threat meter (`ultron.invasion.waves: threat`). `ultron.invasion.waves: 1` keeps the old one-wave invasions; `ultron.threat.enabled: false` turns the meter off.
- **Migration** `0001_dashboard` on core (dashboard sessions and the audit log; empty tables). Runs on restart.
- **Staff dashboard, off by default.** To use it: set `dashboard.enabled: true`, put Cérebro's OAuth2 client secret in `DASHBOARD_CLIENT_SECRET`, add `<publicUrl>/callback` as a redirect in the Developer Portal and uncomment `127.0.0.1:8081:8081` in `docker-compose.yml` ([docs/DASHBOARD.md](docs/DASHBOARD.md)).
- **Migration** `0007_price_override` on J.A.R.V.I.S. (one nullable column; every price stays as it was).
- **War on by default.** Missions, strikes and world-event participation score for the hero's faction. `ultron.war.enabled: false` stops new wars and scoring. `jarvis.economy.war.winner` (default 50) is what each scoring member of a winning faction receives. Economy off: the war still runs and posts, and nobody is paid.

### Added
- Faction war (US-18): one war per server, points stored with the faction at that moment, `/guerra` scoreboard, staff start, end and audited adjustments, a result post, and `war.ended`. A tie pays every tied faction. Independente never scores. ADR 0033.
- Multi-wave invasions (US-19): an invasion runs 1–5 waves in the same message. Each wave has `invasion.waveHpGrowth` (+25%) more HP and a boss one level higher. The switch happens once even with strikes in flight, and late strikes land on the new wave. A time-out mid-way is a defeat with the cleared waves recorded. The results list each wave (time, top striker). `world.event` carries `wave` and `waves`. Raids stay one wave.
- Threat meter (US-19): 0–100 per server. Quiet days raise it (`threat.idleRise`, 10) and days with `threat.activeActions` (3) finished missions and strikes lower it (`activeFall`, 5). It ticks once a day at 00:10 and catches up at most 7 missed days. It sets the next invasion: below 34 → 1 wave, normal; 34–66 → 2 waves, normal; 67+ → 3 waves, difícil. `/ameaca` gains the **Ameaça** field (bar, level, what it means), shown even with no event.
- Staff dashboard (US-20): a web page in the same container (port 8081). Discord login (`scope=identify`), so only the owner, Administrators and the staff roles get in, re-checked within 60 s. Panels: members per faction and level band; J.A.R.V.I.S. economy, top balances and purchases; ULTRON events, war and history, threat; the audit log. Bots add panels with `ctx.dashboard.panel`. `legion doctor` checks the secret, the port and `publicUrl`. ADR 0034.
- Dashboard actions (US-21): give and remove credits, give an item, change an item price, schedule, start or cancel an event, start or end the war, set the threat. Each one uses the same rules and messages as its slash command. Forms are CSRF-protected and run once (a resend changes nothing). Every run is in `/audit` with who, what and the result (`ok: false` for refusals). A price change is stored as `price_override`: it survives item imports and is used by `/loja`, buying and the panels; an empty price goes back to the file price. Bots add actions with `ctx.dashboard.action`.
- `jarvis.war-credits` pays the winners once (`war:<warId>:<memberId>`).
- `legion playtest-report` gains a **Guerra** section (points by faction and reason, staff adjustments; included in `--json`) and flags an unknown faction or a repeated source key.
- `legion doctor` shows whether a war is active, scheduled or off.

### Changed
- The dashboard answers 502 when Discord cannot be reached during the login or the staff check.
- `/mutante` no longer exists. `/heroi` is the only command for the sheet, powers and origin.

## [0.10.0] - 2026-11-19

J.A.R.V.I.S. v2: credits, items and gear, the shop and the item editor. No real money anywhere: credits and items are earned by playing or given by staff.

### Upgrade notes
- **Migrations** `0005_items` and `0006_wallet` run on their own (new empty tables; nothing is paid retroactively, every wallet starts at 0).
- **New commands** `/inventario`, `/carteira` and `/loja`, and new `/jarvis item` and `/jarvis creditos` subcommands: restart (or `legion register-commands`) so Discord shows them.
- **Economy on by default.** Missions, trivia and world events pay credits, and the 12 shipped items are in the shop. `jarvis.economy.enabled: false` turns payouts off and closes the shop; `jarvis.economy.gear.statCap: 0` makes gear cosmetic only.
- **Fights** read gear bonuses: a hero with equipped items starts a fight slightly stronger, capped at +2 per stat and +16 hp by default.

### Added
- Item editor (US-17): `editor-itens.html` builds `itens.yaml` with the bot's own validation (slot, level, pt/en name and description, capped bonus, cosmetic, shop price and order), opens existing files and starts from the shipped items.
- `/jarvis item importar` (preview with new, changed and unchanged items and how many players own each changed one; Publicar; ids of file items refused; every error listed), `/jarvis item exportar` (`itens-staff.yaml`, imports back unchanged), `/jarvis item desativar` (unequips owners and says how many; they keep the item) and `/jarvis item ativar`. Staff items survive restarts.
- Shop (US-16): `/loja [pagina]` lists the active items with `shop.price` (price, slot, level, bonus, owned/level/cosmetic marks, balance), 25 per page. Buying debits and grants in one transaction (`buy:<member>:<item>`); too few credits, an item already owned, an item no longer for sale, a level too low or a changed price are refused with nothing charged. No selling back. 11 of the 12 shipped items are for sale (60–360 credits). `legion doctor` warns when the economy is on and nothing is for sale.
- Credits (US-14): missions (by kind, or the mission's `credits`), correct trivia answers and world events (victory or participation) pay credits once each, next to the XP. `/carteira` shows the balance and the last 10 movements. `jarvis.economy` sets the amounts; `enabled: false` turns payouts off. No real money anywhere.
- `/jarvis creditos dar membro quantidade motivo` (staff): −10000..10000, never below 0, recorded with who and why.
- `legion playtest-report` gains an **Economia** section (credits by reason, staff movements) and flags a wallet that does not match its ledger or is negative.
- The mission editor writes the optional `credits` field. ADR 0028.
- Items and gear (US-15): `/inventario` with three slots (traje, acessório, dispositivo), one select per slot and Desequipar. Equipped items add a small bonus in training, mission and world-event fights and on the `/perfil` sheet; the total is capped by `jarvis.economy.gear.statCap` (default +2 per stat, +16 hp; `0` = cosmetic only). The `/perfil` card lists equipped items.
- 12 shipped items in `packages/bot-jarvis/content/items/`; server items in `data/content/items/*.yaml`. A broken file is skipped and `legion doctor` shows it. Removing an item (or `active: false`) unequips it and keeps it in the inventory.
- `/jarvis item dar membro item [motivo]` (staff): gives an item, once per member, recording who gave it.
- `legion content validate` checks item files.
- Core `gear` read model and `playerStats` (ADR 0029); docs/ECONOMY.md.

## [0.9.1] - 2026-11-18

### Added
- `legion content validate <file|folder> [--type] [--categories] [--json]`: checks trivia, mission, campaign (single files and import files), enemy and power files with the bots' own rules, without the database. Missions and campaigns are checked together and next to the shipped content (chapters, `requires`, cycles, `joinFaction`). In a folder, files of another type are skipped with a note. Exit 0 (valid), 1 (errors) or 2 (unknown type).
- AI skills kit in `skills/`: `legion-mission`, `legion-campaign`, `legion-trivia`, `legion-enemy` and `legion-setup`. Each `SKILL.md` has the format, the canon policy, balance numbers, pt-BR style and examples, and tells the agent to run `legion content validate` before handing a file over. `legion-setup` never reads or prints `.env`. Every example is validated in CI.
- `skills.html` on the site with install steps for Claude Code and other agents, and `legion-skills.zip` built from `skills/` by `site:build`.

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

[Unreleased]: https://github.com/uminocelo/legion/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/uminocelo/legion/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/uminocelo/legion/compare/v0.10.0...v1.0.0
[0.10.0]: https://github.com/uminocelo/legion/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/uminocelo/legion/compare/v0.9.0...v0.9.1
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
