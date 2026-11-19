# Build prompt: Cérebro v0 (core skeleton + onboarding + roles)

**Read and follow the Legion main prompt first:** https://app.notion.com/p/41aa25dbaf35812d879cca9730c99cdf (local copy: `00-main.md`). Everything shared (stack, monorepo layout, conventions, event catalog, DB rules, scheduler, Docker/CI, CLI, role set, trademark rules, ADRs) is defined there. This prompt only adds what is specific to this step.

## Mission

Cérebro is the recruiter. It detects new members, walks them through the rules, a faction choice and the creation of an **original** mutant, and gives them the right roles so the server unlocks. Cérebro also owns the server's role set and keeps it in sync.

Because Cérebro is built first, this step also builds the **monorepo skeleton, `packages/core`, `apps/runner` and `apps/cli`**, the Docker image and CI. When this step is done, a server owner can self-host Legion with only Cérebro enabled.

## Version

**v0.** First public release: `v0.1.0`. No missions, XP, combat, tutorial or AI in this step.

## Scope

**In scope**
- Monorepo skeleton, `core`, `runner`, `cli`, Docker, CI and release workflow (part A below).
- Idempotent role sync from `legion.config.yaml` (part B).
- `/cerebro setup` to sync roles and, when asked, set channel visibility (part B).
- Onboarding flow: join → welcome → rules → faction → mutant → registration → opt-ins (part C).
- **v0.9 update ([ADR 0031](docs/adr/0031-hero-origins.md)):** the faction step became an **origin** step (`origin_chosen`); new heroes start on `cerebro.teams.startFaction`; powers are filtered by origin; `/heroi` replaces `/mutante` (the alias was removed in US-18). Teams (US-26): nine default factions with optional `origins`, every change audited in `cerebro_faction_changes`, a team no longer in `factions` shown (and roled) as Independente, and `/cerebro equipe mover` for staff ([docs/UNIVERSE.md](docs/UNIVERSE.md#equipes)). The sections below describe v0.
- Rejoin restore.
- `/perfil`, `/cerebro preferencias`, `/cerebro setup`.
- Handling `rank.changed` (swap rank roles), so J.A.R.V.I.S. v1 can plug in later without touching Cérebro.
- Emitting `member.joined`, `player.created`, `player.rejoined`, `player.optins_changed`, and `report.flagged` for repeated canon-name attempts.
- README, `docs/SELF_HOSTING.md`, `docs/ARCHITECTURE.md`, `docs/CONFIG.md`, `docs/EVENTS.md`, ADRs 0001–0008 from the main prompt plus Cérebro's own ADRs.

**Out of scope (leave a TODO or an issue)**
- Changing faction (admins do it by hand for now; later `/faccao trocar` with a cooldown).
- Webhook personas and multi-token mode.
- Character card images (brainstorm idea "Character card image"), faction quiz (brainstorm idea "Faction quiz": 5 questions that suggest a faction). Both are v1+ ideas.
- Any automatic change to channel permission overwrites on startup.

## Part A: core, runner and CLI skeleton

Build these in `packages/core/src/` (each with tests):

| Module | What it contains |
|---|---|
| `config/` | zod schema for the shared config (§5.7 of the main prompt), YAML loader (`yaml` package), env schema, localized readable error formatter, merge of bot config schemas, the rule "cerebro required if any bot enabled" |
| `db/` | `createDb(url)` for `file:` (libsql) and `postgres://` (pg), `LegionDb` facade, migration runner (runs `drizzle/sqlite` or `drizzle/pg` on boot), core tables (`core_event_log`, `core_event_consumption`, `core_scheduled_jobs`, `core_kv`), schema parity test helper |
| `events/` | `catalog.ts` with **every** event and zod payload from the main prompt §6.2 (even those no bot emits yet), `EventBus` interface, in-process implementation with the outbox, consumption tracking, startup replay and retry |
| `scheduler/` | the DB-backed scheduler from §8 |
| `i18n/` | loader for package locale files + `./locales` overrides, `t()`, plural support, `LocaleResolver` hook, parity test helper |
| `log/` | pino setup with redaction and child loggers |
| `discord/` | `DiscordGateway` interface, discord.js implementation, `FakeDiscordGateway` for tests, interaction router (commands by name, components by `<bot>:v<n>:` prefix), error boundary, `command.executed` emission, command registration with hash check, `allowedMentions` defaults, persona embed helper (author/color/footer per `BotId`) |
| `roles/` | `RoleService`: resolve roles by `key`, plan + apply sync, assign/remove helpers, the TikTok guard, hierarchy check |
| `registries/` | `HelpRegistry` (entries: `bot`, `command`, `descriptionKey`, `adminOnly`), `ProfileRegistry` (bots return embed fields for a member), `ReadModels` + `provide()` (main prompt §5.1) |
| `ratelimit/` | `RateLimiter` interface + simple in-memory default (`consume(key, limit, windowMs)`), replaced by Sentinel in v3 |
| `game/` | `random.ts` (mulberry32, `d(n)`), `stats.ts` (archetype table + growth from the main prompt), `canon.ts` + `../data/canon-names.txt` |
| `time/` | `Clock` (real + fake), helpers for "local day" in `config.timezone` |
| `bot.ts` | `LegionBot` and `BotContext` types |
| `health.ts` | tiny `node:http` server for `GET /healthz` |

`apps/runner/src/main.ts` boot sequence: load env + config (exit with readable errors) → logger → DB + migrations → event bus → scheduler → load enabled bots (`import('@legion/bot-<id>')`) → validate each bot's config → `register()` → create the discord.js client with the union of intents → login → on ready: register commands if the hash changed, replay pending events, start scheduler polling, call `onReady()` → health server ready. On `SIGTERM`/`SIGINT`: stop polling, let running handlers finish (max 10 s), destroy the client, close the DB.

`apps/cli`: `legion init`, `legion doctor`, `legion register-commands`, `legion invite-url` as described in the main prompt §10. Cérebro adds its own doctor checks (below).

Also create: root `package.json` scripts (`dev`, `build`, `test`, `typecheck`, `lint`, `legion`), `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.env.example`, `legion.config.example.yaml` (commented in Portuguese), `Dockerfile`, `docker-compose.yml` (with the `postgres` profile), `.github/workflows/ci.yml` and `release.yml`, `CHANGELOG.md`, `CONTRIBUTING.md`, `.gitignore` (`data/`, `.env`, `node_modules`, `dist`).

## Part B: role sync and channel visibility

**Gateway intents:** `Guilds` and `GuildMembers` (privileged; README and `doctor` explain how to enable "Server Members Intent" in the Developer Portal). Message content is not needed.

**Bot permissions (invite URL):** Manage Roles, Manage Channels (only for `/cerebro setup`), View Channels, Send Messages, Embed Links, Use Application Commands.

**Role sync** (runs on ready and from `/cerebro setup`):
1. Fetch the guild's roles.
2. Build a plan from `config.roles`, matching by exact name: `create` for missing roles (all groups, including manual ones, except `tiktok_sub`), `updateColor` only for roles with `managedBy: cerebro` whose color differs. Never plan a delete or a rename.
3. Apply the plan and log each change. Store the result and time in `core_kv` (`cerebro.lastRoleSync`).
4. Check the hierarchy: if Cérebro's top role sits below any role it must assign, log a clear warning listing the roles and how to fix it (drag the bot role above them in Server Settings → Roles).
5. A second run with no config change must be a no-op (empty plan).

The plan is a pure function `planRoleSync(existingRoles, configRoles) → RoleSyncPlan`, tested without Discord.

**Channel visibility:** `Sinal Detectado` members see only the welcome and rules channels; `Mutante Registrado` unlocks the rest. Cérebro never changes channel overwrites on startup. `/cerebro setup` does it on request:
- Options: `aplicar` (boolean, default `false` = dry run) and `canais` (boolean, default `false`; when true, also plan channel overwrites).
- With `canais: true`, the plan is: `@everyone` deny View Channel on every channel except `channels.welcome` and `channels.rules`; `Mutante Registrado` allow View Channel on the community channels (every channel not in `cerebro.setup.excludeChannelIds`, by default staff channels are excluded when they already deny `@everyone`).
- The command replies ephemerally with the full list of what it would change (dry run) or what it changed (`aplicar: true`).
- Restricted to members holding `staff_owner` or `staff_council` (and the guild owner). Others get `cerebro.errors.not_staff`.

## Part C: onboarding flow

Keep every user-facing string in `packages/bot-cerebro/locales/pt-BR.json` and `en.json`.

1. **Join** (`GuildMemberAdd`): emit `member.joined`. If the member is not registered, assign `signal` (Sinal Detectado) and set/keep `members.onboardingStep = 'signal'`. If the member is already registered (a rejoin), restore `registered`, their faction role, their rank role and their opt-in roles, emit `player.rejoined`, and post a short "bem-vindo de volta" message in the welcome channel. Ignore bots joining.
2. **Welcome:** post in `channels.welcome` mentioning the member, with a "Cérebro detectou um novo sinal mutante…" embed (persona Cérebro) and an **Iniciar registro** button (`cerebro:v1:start`). Also keep one **persistent** welcome message with the same button (posted or refreshed by `/cerebro setup`, message id stored in `core_kv`) so members who missed the ping can start any time. Every later step is an **ephemeral** reply visible only to that member. (Brainstorm idea "Mutant detection welcome ritual".)
3. **Rules:** show a short rules summary (locale key, editable by the owner) with a link to `channels.rules` and an **Aceito as regras** button (`cerebro:v1:rules`). Store `rulesAcceptedAt`, step → `rules_accepted`.
4. **Faction:** a select menu (`cerebro:v1:faction`) with X-Men / Irmandade / Independente from `config.factions`, each with its one-line description. Exactly one. Step → `faction_chosen`. Picking again before registration just overwrites the choice.
5. **Archetype + mutant:** first a select (`cerebro:v1:archetype`) with Telepata, Elemental, Metamorfo, Velocista, Tanque, Tecnopata (one-line description each), then a modal (`cerebro:v1:mutant`) with (brainstorm ideas "Power roll with archetypes" and "Origin story modal"):
   - `codinome`: 2–32 chars, letters, numbers, spaces, `-` and `'`; unique per guild, case- and accent-insensitive
   - `poder`: short text, max 100
   - `origem`: paragraph, max 300

   Validate with zod. Reject canon names with `isCanonName` (main prompt §13) and show a friendly PT-BR error asking for an original name, with a button to reopen the modal. After 3 canon-name rejections by the same member within 10 minutes, emit `report.flagged` with `reason: 'canon_name_attempts'`, `severity: 'low'`. If the codename is taken, say so and reopen. Store the archetype choice on the member row (`pendingArchetype`) so the modal step survives a restart.
6. **Registration:** in **one DB transaction**: insert the mutant, set step → `registered`, `faction`, `rank = 'recruta'`, and emit `player.created` (outbox). After commit: assign `registered` + the faction role + `rank_recruta`, remove `signal`. If a role call fails, log it, keep the DB state, and let a retry job (`cerebro.reconcile-member`, via the scheduler, 3 attempts) re-apply the member's expected roles. Post a public **"Mutante registrado!"** embed in `channels.registry` (or the welcome channel if unset) with codename, archetype and faction.
7. **Opt-ins:** right after registration, and any time through `/cerebro preferencias`, show toggle buttons (`cerebro:v1:optin:<roleKey>`) for `live_ping` (Aviso de Live) and the Rivals roles `rivals_vanguard`, `rivals_duelist`, `rivals_strategist`. Any combination is allowed; each click toggles the role and updates `members.optIns`; the message re-renders with the current state (✅/⬜). Emit `player.optins_changed`.

**Idempotency and resumability:** an old button, a double click or a restart mid-flow never duplicates records or leaves a member with two factions. The member's step lives in the DB. Each button handler first loads the member and checks the step: if the click belongs to an earlier step, show the current step instead; if the member is already registered, show the profile and the opt-ins. Faction roles are applied as "set exactly one": remove every other faction role first.

**Onboarding state machine** (pure module `domain/onboarding.ts`):

```
signal ──accept_rules──▶ rules_accepted ──choose_faction──▶ faction_chosen ──submit_mutant──▶ registered
  ▲                              │                                   │ (choose_faction again: stays)
  └── (rejoin of unregistered member keeps its current step)         └── (start/accept_rules again: no-op)
```

Invalid jumps (e.g. `submit_mutant` from `signal`) return an error result that the handler maps to "continue from where you left off".

## Commands

| Command | Who | What |
|---|---|---|
| `/perfil [membro]` | everyone | Mutant card embed: codinome, arquétipo, poder, origem, facção, rank, plus sections from `ProfileRegistry` (J.A.R.V.I.S. adds XP later). The reply is always ephemeral, with a **Compartilhar** button (`cerebro:v1:share`) that posts the card publicly in the current channel. Unregistered target → `cerebro.profile.not_registered`. |
| `/cerebro preferencias` | registered members | Reopens the opt-in toggles. |
| `/cerebro setup [aplicar] [canais]` | staff | Role sync, persistent welcome message, optional channel overwrites (dry run by default). |
| `/cerebro status` | staff | Counts per step, last role sync, hierarchy warnings. |

Register help entries for `/perfil` and `/cerebro preferencias` in `HelpRegistry`.

## Data model (owned by Cérebro)

`members`
- `id` (ULID PK), `guildId`, `discordUserId` (unique together with `guildId`)
- `onboardingStep` text: `signal` | `rules_accepted` | `faction_chosen` | `registered`
- `rulesAcceptedAt` (nullable), `faction` (nullable: `xmen` | `brotherhood` | `independent`), `pendingArchetype` (nullable)
- `rank` text default `recruta`: `recruta` | `agente` | `veterano`
- `optIns` JSON text (array of role keys), default `[]`
- `leftAt` (nullable, set on `GuildMemberRemove`), `createdAt`, `updatedAt`

`mutants`
- `id` (ULID PK), `memberId` (FK, unique: one mutant per member in v0), `guildId`
- `codename`, `codenameNormalized` (unique together with `guildId`), `power`, `archetype`, `origin`
- `createdAt`, `updatedAt`

`cerebro_canon_attempts`: `id`, `memberId`, `attemptedName`, `createdAt` (for the 3-in-10-minutes flag).

Register the read models `members` and `mutants` in core (`ctx.provide`, see main prompt §5.1) so other bots can read members and mutants without importing this package.

## Events

- **Emits:** `member.joined`, `player.created`, `player.rejoined`, `player.optins_changed`, `report.flagged` (`canon_name_attempts`). Payloads exactly as in the main catalog.
- **Consumes:** `rank.changed` (consumer `cerebro.rank-roles`): update `members.rank`, then set exactly one rank role. Idempotent: if the member already has `to`, do nothing. Ignores unknown members (logs a warning).

## Config keys (`cerebro:` section)

```yaml
cerebro:
  welcomePing: true              # mention new members in the welcome channel
  persistentWelcome: true        # keep a pinned welcome message with the start button
  publicRegistryCard: true       # post "Mutante registrado!" publicly
  codename: { min: 2, max: 32 }
  archetypes: [Telepata, Elemental, Metamorfo, Velocista, Tanque, Tecnopata]
  optInRoles: [live_ping, rivals_vanguard, rivals_duelist, rivals_strategist]
  canonAttemptFlag: { count: 3, windowMinutes: 10 }
  setup:
    excludeChannelIds: []        # channels /cerebro setup never touches
```

Plus the shared `roles`, `factions`, `channels.welcome`, `channels.rules`, `channels.registry`.

## Doctor checks (Cérebro)

- Server Members intent enabled.
- `channels.welcome` and `channels.rules` set, exist, and the bot can view, send and embed there.
- Bot top role above every role with `managedBy: cerebro` (list the ones that are not).
- `Assinante TikTok` exists and is integration-managed (info only; warn if a config tries to manage it).

## Edge cases

- Member leaves mid-onboarding: keep the row; resume where they stopped when they come back.
- Member leaves after registering and returns: rejoin restore (roles from DB), no new mutant.
- Admin removes `Mutante Registrado` by hand: Cérebro does not fight it; `/cerebro status` lists DB-registered members missing the role, and `/cerebro setup aplicar:true` can reconcile them.
- Config renames a role: sync creates the role with the new name (the old one stays); docs explain renaming in Discord first.
- Bot restarted between the DB commit and the role calls: the `cerebro.reconcile-member` job and the startup replay fix it.
- Discord API errors (missing permission, hierarchy): log with a hint, reply ephemerally with `cerebro.errors.role_permission`, never crash.
- Modal submitted after the bot updated (`v1` → `v2` ids): `core.errors.expired_component`.
- Codename normalization: "Fênix  Azul" and "fenix azul" collide; trim and collapse spaces before storing.
- Bots and the guild owner can still use `/cerebro setup` even if they have no staff role.

## Tests (must pass)

- Role sync only creates missing roles, is a no-op on a second run, fixes colors only on Cérebro-managed roles, and **never** touches `Assinante TikTok` (guard throws in tests).
- `RoleService` guard: every path that targets `tiktok_sub` (by key, by name, by integration flag) is refused.
- Onboarding state machine: happy path, invalid jumps rejected, double clicks idempotent, resume after restart.
- Exactly one faction role after any sequence of faction picks.
- Canon-name filter: accents, case, spacing, punctuation and digit variants ("W0lverine", "tempestade", "Jean  Grey").
- Codename uniqueness is case- and accent-insensitive.
- Rejoining member gets `registered`, faction, rank and opt-in roles restored, and no new rows.
- Opt-in toggles add and remove roles and update `optIns`.
- `rank.changed` swaps rank roles and is idempotent.
- Core: config errors are readable; event bus outbox (no dispatch on rollback), replay of unconsumed events, retry; scheduler claim/retry/recurring dedupe; locale parity; DB schema parity (sqlite vs pg).
- CI runs the suite on SQLite and Postgres.

## Cérebro ADRs (in addition to 0001–0008)

- 0009 Onboarding state stored in the DB as a state machine (resumable, idempotent).
- 0010 Roles referenced by config key, not by display name.
- 0011 Canon-name blocklist in core, shared by all bots.

## Definition of done

In a test server:
- A new member joins and sees only the welcome and rules channels.
- They complete registration in under a minute.
- They end with `Mutante Registrado` + exactly one faction + `Recruta`, and `Sinal Detectado` is removed.
- The rest of the server unlocks.
- The opt-in toggles work.
- Restarting the bot changes nothing.
- `pnpm test` is green on SQLite and Postgres.
- `legion doctor` passes, and explains each problem when something is misconfigured.
- Someone else self-hosts it on a clean machine using only `docs/SELF_HOSTING.md` + `docker compose up -d`.
- Tag `v0.1.0` publishes the multi-arch image to `ghcr.io/uminocelo/legion`.
