# Legion: main context prompt (read this first)

> **Nota pro Celo (pt-BR):** este é o prompt principal. Em cada sessão nova do seu agente de código, cole **primeiro este prompt inteiro** e depois **um** dos prompts de bot (Cérebro, J.A.R.V.I.S., H.E.R.B.I.E., Sentinel ou ULTRON). O prompt do bot diz o que construir agora; este aqui dá o contexto, a arquitetura e as regras que valem para todos. A ordem de construção é: core + Cérebro → J.A.R.V.I.S. → H.E.R.B.I.E. → Sentinel → ULTRON. Se mudar alguma decisão aqui (stack, eventos, tabelas), atualize este prompt antes de usar os outros.

You are an AI coding agent working on **Legion**, a free, open-source, non-commercial Marvel/X-Men fan RPG that runs as a set of Discord bots on a Brazilian Discord server. This prompt gives you the full project context, the architecture and the shared rules. A second prompt (a "bot prompt") follows it and tells you which bot to build now. When the two disagree, the bot prompt wins for that bot's own scope, and this prompt wins for everything shared (core, events, conventions). If something is still ambiguous, pick the simplest option that keeps the rules below, write it down in an ADR, and continue.

## 1. Vision

Legion turns a Discord server into a small, persistent RPG. Five bots each own one part of the game:

| Bot | Package | Role | Owns | Ships in |
|---|---|---|---|---|
| Cérebro | `packages/bot-cerebro` | Recruiter | Onboarding, rules, factions, mutant creation, server roles | v0 |
| J.A.R.V.I.S. | `packages/bot-jarvis` | Game master | Trivia, XP, levels, ranks, leaderboard, streaks; later missions, inventory, economy | v1 (missions/inventory v2) |
| H.E.R.B.I.E. | `packages/bot-herbie` | Helper | Tutorial quests, `/ajuda`, rules glossary, hints | v2 |
| Sentinel | `packages/bot-sentinel` | Combat and safety | Turn-based combat, cooldowns, anti-cheat, rate limits, moderation helpers | v3 |
| ULTRON | `packages/bot-ultron` | Villain | Enemies scaled to party level, world events, raids, optional AI flavor text | v3 |

Core game loop: **Create** (Cérebro: an original mutant) → **Learn** (H.E.R.B.I.E.: 3 tutorial quests) → **Mission** (J.A.R.V.I.S.: trivia, text missions, combat missions) → **Threat** (ULTRON: scaled enemies, server events) → **Fight** (Sentinel: turn-based combat with seeded dice) → **Reward** (XP, ranks Recruta → Agente → Veterano, gear, credits) → **Factions** (X-Men / Irmandade / Independente, leaderboards, later faction wars) → repeat with daily streaks.

Roadmap: v0 Cérebro · v1 J.A.R.V.I.S. lite · v2 H.E.R.B.I.E. + missions/inventory · v3 Sentinel + ULTRON · v4 World (faction wars, bigger events, optional web dashboard) · v5 Community (seasons, supporter cosmetics, community content packs).

## 2. Self-hostable principles (non-negotiable)

Legion is a **kit that anyone can download and run**. There is no central Legion service.

1. **Each community runs its own instance** with its own Discord application, token and server. The official server is just one instance. One instance serves one guild (`DISCORD_GUILD_ID`), but every table still stores `guildId` so multi-guild support stays possible later.
2. **Getting started takes three steps:** create a Discord app and copy its token (README with screenshots) → fill `.env` (copy `.env.example`, or run `legion init`) → `docker compose up -d`. A non-developer must get it running from the README in about 10 minutes.
3. **No infrastructure by default.** SQLite in `./data` (a Docker volume) is the default database. Postgres is optional. No Redis, no queue server, no cloud service is required.
4. **One config file** (`legion.config.yaml`) controls role names and colors, factions, channels, enabled bots, locale, timezone and per-bot settings. It is validated on boot with readable, localized errors. Secrets live only in `.env`.
5. **Enable only what you want:** `bots: [cerebro]`. Every bot is a module that can be switched off. Cérebro is required whenever any other bot is enabled, because it owns members and roles. Config validation enforces this.
6. **Zero cost.** No paid APIs. Optional AI (flavor text only) must work with a local Ollama and is off by default.
7. **Safe updates.** `docker compose pull && docker compose up -d` updates. DB migrations run automatically on start. Backups are "copy `./data`". Breaking config changes need a CHANGELOG entry and a migration note.
8. **Restart-safe.** Any process can be killed at any moment. No game state lives only in memory.

## 3. Monorepo layout

pnpm workspaces, TypeScript project references, ESM everywhere.

```
legion/
├─ packages/
│  ├─ core/              # shared runtime: config, db, event bus, scheduler, i18n, logger, discord helpers, game math
│  ├─ bot-cerebro/       # v0
│  ├─ bot-jarvis/        # v1
│  ├─ bot-herbie/        # v2
│  ├─ bot-sentinel/      # v3
│  └─ bot-ultron/        # v3
├─ apps/
│  ├─ runner/            # the process: loads config, opens DB, runs migrations, loads enabled bots, connects to Discord
│  └─ cli/               # `legion` CLI: init, doctor, register-commands
├─ locales/              # optional server-owner overrides (pt-BR.json, en.json), deep-merged over package defaults
├─ data/                 # runtime data (SQLite file). Git-ignored. Docker volume.
├─ docs/                 # ARCHITECTURE.md, SELF_HOSTING.md, CONFIG.md, EVENTS.md, CONTRIBUTING.md, adr/
├─ .github/workflows/    # ci.yml, release.yml
├─ Dockerfile
├─ docker-compose.yml
├─ .env.example
├─ legion.config.example.yaml
├─ biome.json
├─ tsconfig.base.json
├─ pnpm-workspace.yaml
├─ CHANGELOG.md
└─ README.md
```

Each bot package has this shape:

```
packages/bot-<name>/
├─ src/
│  ├─ index.ts           # exports the LegionBot module (see §5.1)
│  ├─ config.ts          # zod schema for the `<name>:` config section
│  ├─ commands/          # slash command definitions + thin handlers
│  ├─ interactions/      # button/select/modal handlers (thin)
│  ├─ domain/            # pure business logic (no discord.js imports)
│  ├─ db/                # this bot's tables + repository functions
│  └─ events.ts          # bus subscriptions
├─ content/              # YAML/JSON game content (questions, quests, enemies), if any
├─ locales/              # pt-BR.json, en.json (keys prefixed with the bot id)
└─ test/
```

**Dependency rule:** bot packages depend on `core` only, never on each other. Bots talk through the event bus. To read another bot's data, they use **read models** registered in core (`ctx.read`, see §5.1), which the owning bot provides at `register` time. `domain/` code must not import `discord.js`.

## 4. Shared stack

| Concern | Choice |
|---|---|
| Runtime | Node 22 LTS, TypeScript 5 with `strict: true`, `noUncheckedIndexedAccess: true`, ESM (`"type": "module"`) |
| Package manager | pnpm (workspaces). Use `tsx` for dev, `tsc -b` for build |
| Discord | discord.js v14: slash commands, buttons, select menus, modals, embeds |
| Database | Drizzle ORM. SQLite by default through `@libsql/client` with a `file:` URL (async API and async transactions, same shape as Postgres). Postgres optional through `pg` when `DATABASE_URL` starts with `postgres://` |
| Validation | zod for env, config, modal input, content files and event payloads |
| Logging | pino. Pretty in dev (`pino-pretty`), JSON in Docker. Redact tokens |
| i18n | JSON locale files, `pt-BR` default, `en` second |
| Tests | Vitest. `fast-check` for property tests (combat, scaling, scheduler) |
| Lint/format | Biome |
| Scheduling | DB-backed scheduler in core (§8) with `cron-parser` for recurring jobs |
| IDs | ULIDs (`ulid` package) as text primary keys |
| Container | Multi-stage Dockerfile on `node:22-bookworm-slim`, non-root user |
| CI | GitHub Actions; image on GHCR `ghcr.io/uminocelo/legion`, multi-arch amd64 + arm64 |

Do not add other runtime dependencies without a reason written in the PR description or an ADR. No Redis, no message broker, no ORM other than Drizzle.

## 5. Conventions

### 5.1 Bot module contract (in `core`)

```ts
export type BotId = 'cerebro' | 'jarvis' | 'herbie' | 'sentinel' | 'ultron';

export interface LegionBot<C = unknown> {
  id: BotId;
  version: string;                       // semver of the bot package
  configSchema: z.ZodType<C>;            // validates config[id]; must have defaults for every key
  intents: GatewayIntentBits[];          // runner ORs these together
  permissions: bigint[];                 // used by `legion doctor` and the invite URL generator
  commands: (ctx: BotContext<C>) => SlashCommandDefinition[];
  register: (ctx: BotContext<C>) => void | Promise<void>; // subscribe to events, register jobs, help, profile sections
  onReady?: (ctx: BotContext<C>) => Promise<void>;        // after the Discord client is ready
  doctorChecks?: (ctx: BotContext<C>) => DoctorCheck[];
  shutdown?: () => Promise<void>;
}

export interface BotContext<C> {
  config: LegionConfig;      // whole validated config
  botConfig: C;              // this bot's section
  db: LegionDb;
  bus: EventBus;
  scheduler: Scheduler;
  i18n: I18n;
  log: Logger;               // child logger with { bot: id }
  gateway: DiscordGateway;   // all Discord side effects go through this
  roles: RoleService;        // managed-role helper with the TikTok guard (§12)
  help: HelpRegistry;        // bots register /ajuda entries (rendered by H.E.R.B.I.E.)
  profile: ProfileRegistry;  // bots add sections to /perfil (rendered by Cérebro)
  rateLimiter: RateLimiter;  // simple in-core default; Sentinel replaces it in v3
  clock: Clock;              // now(); fake in tests
  random: RandomSource;      // seed(): new uint32 seed (crypto); create(seed): mulberry32 PRNG; fake in tests
  read: ReadModels;          // read-only queries into other bots' data
  provide: <K extends keyof Providers>(key: K, impl: Providers[K]) => void; // e.g. Sentinel provides the RateLimiter, H.E.R.B.I.E. the LocaleResolver
}

// Read models: the owning bot registers the implementation; readers get null when that bot is disabled.
export interface ReadModels {
  members: {                                   // provided by Cérebro
    getById(memberId: string): Promise<MemberView | null>;
    getByDiscordId(discordUserId: string): Promise<MemberView | null>;
    listRegistered(opts?: { faction?: string }): Promise<MemberView[]>;
  };
  mutants: { getByMemberId(memberId: string): Promise<MutantView | null> };              // Cérebro
  progress: { get(memberId: string): Promise<ProgressView | null> };                     // J.A.R.V.I.S. (null if disabled)
}
// MemberView = { id, discordUserId, onboardingStep, faction, rank, optIns, leftAt }
// MutantView = { id, memberId, codename, archetype, power, origin }
// ProgressView = { xp, level, rank, currentStreak, bestStreak }
```

A bot may only **write** its own tables. Read models are typed views, never raw table access.

The runner builds one `BotContext` per enabled bot, calls `register` for all of them, connects to Discord, then calls `onReady`.

### 5.2 DiscordGateway

All Discord side effects go through a `DiscordGateway` interface in `core` (send message, edit message, reply/defer/follow-up to an interaction, show modal, add/remove member role, create/edit role, fetch roles, fetch member, set channel permission overwrites, create thread, timeout member, send DM). The real implementation wraps discord.js. Tests use `FakeDiscordGateway`, which records calls and lets tests simulate members, roles and channels. Domain logic returns plain results ("assign roles X, Y; remove Z; reply with key K"), and a thin adapter turns them into gateway calls. Keep the gateway small; add methods only when a bot needs them.

Design it so a **webhook persona layer** can be added later: every outgoing message carries a `persona: BotId`. In v0–v3 a single bot account posts everything, and the persona only picks the embed author name, color and footer. Later, the gateway can post through per-persona webhooks with no change to bot code.

### 5.3 Slash commands and custom ids

- Command names are Brazilian Portuguese, lowercase, with `name_localizations` and `description_localizations` for `en-US`. Each bot owns its top-level command names; collisions fail at startup.
- Commands are registered per guild. The runner auto-registers on start when the command JSON hash changed (stored in `core_kv`), and `legion register-commands` does it on demand.
- Component custom ids follow `<bot>:v<n>:<action>[:<arg>...]`, max 100 chars, for example `cerebro:v1:faction`, `jarvis:v1:trivia:01J9...:2`. The router dispatches by bot prefix. An unknown version or action gets the ephemeral reply `core.errors.expired_component` ("Este botão expirou. Use o comando de novo."). Bump `v<n>` whenever the args format changes.
- Every interaction that does DB work must `deferReply`/`deferUpdate` within 3 seconds when it might be slow.
- Use `allowedMentions` explicitly. Never ping `@everyone`/`@here`, and only mention the user being addressed.

### 5.4 Error boundaries

The core interaction router and event bus wrap every handler. On an error: log it with `{ bot, interactionId | eventId, userId, err }`, reply ephemerally with `core.errors.generic` ("Algo deu errado, tente novamente.") when an interaction is pending, and keep the process alive. Unhandled rejections are logged, never fatal. Only fatal boot errors (invalid config, DB unreachable, invalid token) exit the process with a clear message. Docker restarts the container (`restart: unless-stopped`).

### 5.5 Idempotency

Clicking an old button, double-clicking, receiving an event twice or restarting mid-flow must never duplicate records or rewards. Use unique constraints, state machines stored in the DB, and idempotency keys (`sourceEventId`, attempt ids) for anything that grants XP, items or roles.

### 5.6 Database conventions

- **The DB is the source of truth.** Bots never hold game state only in memory. Caches are allowed only if they can be rebuilt from the DB.
- Column types stay in the portable subset: `text`, `integer`, `real`. Primary keys are ULID text. Timestamps are ISO-8601 UTC text (`2026-11-16T20:00:00.000Z`). Booleans are integer 0/1. JSON is text, parsed with zod on read. Enums are text validated with zod. No Postgres-only types.
- Tables are declared twice, once per dialect (`schema.sqlite.ts` with `sqliteTable`, `schema.pg.ts` with `pgTable`), with identical names, columns and indexes. A test asserts the two match. drizzle-kit generates two migration folders (`drizzle/sqlite`, `drizzle/pg`). Repository functions are written once against a `LegionDb` facade that exposes only the shared query-builder subset (select, insert, update, delete, `returning`, `onConflictDoNothing/DoUpdate`, `transaction`).
- Table names: core tables start with `core_`; each bot's tables start with its id (`jarvis_xp_ledger`). The two identity tables owned by Cérebro are `members` and `mutants`.
- **One writer per table.** Only the owning bot writes its tables. Other bots read through read models (`ctx.read`) or ask the owner through an event.
- CI runs the test suite on SQLite and on Postgres (a service container).

### 5.7 Config and env

`.env` holds secrets only:

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DATABASE_URL=            # optional; default file:./data/legion.db
LOG_LEVEL=info
HEALTH_PORT=8080
AI_BASE_URL=             # optional, ULTRON flavor text only
AI_API_KEY=              # optional
AI_MODEL=                # optional
```

`legion.config.yaml` holds everything else. Top-level shape (each bot prompt defines its own section):

```yaml
locale: pt-BR                 # pt-BR | en
timezone: America/Sao_Paulo   # used for dailies, streaks, schedules
bots: [cerebro]               # enabled bots; cerebro required if any other is enabled
channels:
  welcome: "123"              # Discord channel ids (strings)
  rules: "123"
  registry: "123"             # optional, public "Mutante registrado!" cards
  tutorial: "123"             # optional, H.E.R.B.I.E. fallback when DMs are closed
  trivia: "123"               # optional
  events: "123"               # optional, ULTRON world events
  modQueue: "123"             # optional, Sentinel report queue
  combat: "123"               # optional, Sentinel combat threads
roles: [...]                  # role set, see §12
factions: [...]               # see §12
cerebro: {...}
jarvis: {...}
herbie: {...}
sentinel: {...}
ultron: {...}
```

Every key has a default in the zod schema, so a minimal config works. Validation errors list the YAML path, the problem and an example, in the configured locale, for example: `legion.config.yaml → roles[3].color: use uma cor hex como "#3498DB"`. Ship `legion.config.example.yaml` with comments in Portuguese and `docs/CONFIG.md` describing every key.

### 5.8 i18n

- All user-facing text lives in locale files: `packages/<pkg>/locales/pt-BR.json` and `en.json`. Keys are prefixed by package: `core.errors.generic`, `cerebro.welcome.title`.
- Interpolation uses `{name}`. Plurals use `{count}` with `_one`/`_other` key suffixes.
- Server owners can override any key by putting `locales/pt-BR.json` or `locales/en.json` in the instance folder (deep-merged at boot).
- Resolution order: member preference (when H.E.R.B.I.E. provides a `LocaleResolver`) → `config.locale` → `pt-BR` → the key itself, plus a warning log.
- A test asserts that every `pt-BR` key exists in `en` and that the placeholders match.
- Code, comments, logs and docs are in English. User-facing text and the example config comments are in Portuguese.

### 5.9 Logging

pino with child loggers bound to `{ bot }` and, per request, `{ interactionId, userId }` or `{ eventId, eventType }`. Levels: `info` for lifecycle and state changes, `warn` for recoverable problems (missing permission, closed DMs), `error` for handler failures. Redact `DISCORD_TOKEN`, `AI_API_KEY` and `DATABASE_URL` passwords.

### 5.10 Testing

- Vitest across the monorepo. `pnpm test` runs everything. Domain logic gets unit tests. Discord flows get integration tests with `FakeDiscordGateway`, a real SQLite DB in a temp file, the real event bus, a fake clock and a seeded random source.
- Determinism: inject `Clock` and `RandomSource` everywhere. No `Date.now()` or `Math.random()` outside core.
- Each bot prompt lists required tests. They must pass before a task is done.

### 5.11 Game rules are deterministic

Game mechanics (XP, ranks, combat, scaling, rewards) are pure functions of stored state, config and a seeded PRNG. Results can be replayed from the DB. AI, if enabled, only writes flavor text and never changes a number, an outcome or a permission.

## 6. Typed event bus

`core` provides a typed, in-process event bus. Bots never call each other directly.

### 6.1 Envelope and delivery

```ts
interface LegionEvent<T extends EventType = EventType> {
  id: string;            // ULID
  type: T;
  version: 1;            // payload schema version per type
  guildId: string;
  occurredAt: string;    // ISO-8601 UTC
  source: BotId | 'core';
  payload: EventPayloads[T];
}
```

- `bus.emit(tx, type, payload)` validates the payload with its zod schema and writes the event to `core_event_log` **inside the caller's DB transaction**. After the transaction commits, the bus dispatches the event to subscribers (outbox pattern). An event is never dispatched for a rolled-back change.
- `bus.on(type, consumerId, handler)` subscribes. `consumerId` is stable, such as `herbie.tutorial-start`. Handlers run asynchronously, each inside an error boundary.
- After a handler succeeds, the bus records `(consumerId, eventId)` in `core_event_consumption`. On startup, the runner replays every logged event that a current subscriber hasn't consumed, oldest first (default lookback 7 days, configurable). Delivery is therefore **at-least-once**, so **every handler must be idempotent**.
- A failing handler is retried up to 5 times with backoff (1s, 5s, 30s, 2m, 10m) by the scheduler, then marked failed in `core_event_consumption` with the error, and logged.
- Unknown event types and invalid payloads are rejected at `emit` time (a programming error, so throw).
- Keep the bus behind an interface so a Redis pub/sub transport can be added later for an optional multi-token mode. Don't build that now.

### 6.2 Event catalog (v1 payloads)

All ids are strings. `memberId` is the `members.id` ULID; `discordUserId` is the Discord snowflake. Every payload type is a zod schema in `packages/core/src/events/catalog.ts`, and `docs/EVENTS.md` documents it. A bot may only emit the events listed for it here. To add an event, update this catalog (and this prompt) first.

| Event | Emitted by | Consumed by | Payload |
|---|---|---|---|
| `member.joined` | Cérebro | Sentinel (account-age check, v3) | `{ discordUserId, accountCreatedAt, isRejoin: boolean }` |
| `player.created` | Cérebro | H.E.R.B.I.E. (start tutorial), J.A.R.V.I.S. (create progress row) | `{ memberId, discordUserId, mutantId, codename, archetype, faction }` |
| `player.rejoined` | Cérebro | J.A.R.V.I.S. (optional welcome back) | `{ memberId, discordUserId }` |
| `player.optins_changed` | Cérebro | (none yet) | `{ memberId, optIns: string[] }` |
| `command.executed` | core router | H.E.R.B.I.E. (tutorial triggers) | `{ discordUserId, memberId: string \| null, bot: BotId, command: string, subcommand: string \| null }` |
| `xp.grant_requested` | any bot | J.A.R.V.I.S. | `{ memberId, amount: number (1–1000), reason: string, sourceEventId: string }` (idempotency key = `sourceEventId` + `reason`) |
| `xp.awarded` | J.A.R.V.I.S. | H.E.R.B.I.E. (hints), Sentinel (anomaly check) | `{ memberId, amount, reason, totalXp, level, sourceKey }` |
| `level.changed` | J.A.R.V.I.S. | H.E.R.B.I.E. | `{ memberId, from: number, to: number }` |
| `rank.changed` | J.A.R.V.I.S. | Cérebro (swap rank roles, update `members.rank`) | `{ memberId, discordUserId, from: 'recruta' \| 'agente' \| 'veterano', to: same }` |
| `trivia.answered` | J.A.R.V.I.S. | H.E.R.B.I.E. (tutorial step) | `{ memberId, attemptId, questionId, correct: boolean, msToAnswer: number }` |
| `streak.updated` | J.A.R.V.I.S. | H.E.R.B.I.E. | `{ memberId, streak: number, day: 'YYYY-MM-DD' }` |
| `quest.completed` | H.E.R.B.I.E. | (J.A.R.V.I.S. gets XP through `xp.grant_requested`) | `{ memberId, questId, step: number, chainCompleted: boolean }` |
| `mission.started` | J.A.R.V.I.S. (v2) | ULTRON (spawn enemies for combat missions) | `{ missionId, missionType: 'text' \| 'combat', memberIds: string[], partyLevel: number, difficulty: 'facil' \| 'normal' \| 'dificil', channelId }` |
| `mission.completed` | J.A.R.V.I.S. (v2) | H.E.R.B.I.E. (tutorial step), ULTRON (stats) | `{ missionId, memberIds: string[], outcome: 'success' \| 'failure' \| 'abandoned' }` |
| `combat.requested` | J.A.R.V.I.S., ULTRON, Sentinel (`/treino`) | Sentinel | `{ combatId, requestedBy: BotId, mode: 'duel' \| 'party' \| 'raid_strike' \| 'training', missionId: string \| null, raidId: string \| null, channelId, participants: Combatant[], maxRounds: number }` |
| `combat.resolved` | Sentinel | J.A.R.V.I.S. (rewards), ULTRON (raid HP, difficulty stats) | `{ combatId, requestedBy, mode, missionId, raidId, seed: number, winnerSide: 'players' \| 'enemies' \| null, rounds: number, damageBySide: { players: number, enemies: number }, survivors: string[], logHash: string }` |
| `world.event` | ULTRON | everyone | `{ worldEventId, kind: 'invasion' \| 'raid' \| 'announcement', phase: 'announced' \| 'started' \| 'ended', title, startsAt, endsAt: string \| null, outcome: 'victory' \| 'defeat' \| null, participantMemberIds: string[] }` |
| `report.flagged` | any bot | Sentinel | `{ reportId, reporter: BotId \| 'member', reporterDiscordUserId: string \| null, subjectDiscordUserId, reason: 'spam' \| 'rate_limit' \| 'canon_name_attempts' \| 'xp_anomaly' \| 'new_account' \| 'user_report' \| 'other', severity: 'low' \| 'medium' \| 'high', details: string (max 500), refs: Record<string, string> }` |

`Combatant` = `{ id, side: 'players' \| 'enemies', kind: 'player' \| 'enemy' \| 'dummy', refId (memberId or enemy instance id), name, archetype: string \| null, level, stats: { hp, atk, def, spd, foc }, powerCooldown: number }`.

Shared game math lives in `packages/core/src/game/` (stats, level curve helpers, PRNG) so every bot computes the same numbers. Base stats per archetype (level 1), plus per-level growth `hp +8, atk +1, def +1, foc +1, spd +1 every 2 levels`:

| Archetype | hp | atk | def | spd | foc |
|---|---|---|---|---|---|
| Telepata | 90 | 8 | 6 | 10 | 14 |
| Elemental | 95 | 12 | 6 | 9 | 10 |
| Metamorfo | 105 | 9 | 9 | 9 | 8 |
| Velocista | 85 | 10 | 5 | 15 | 8 |
| Tanque | 130 | 8 | 13 | 6 | 6 |
| Tecnopata | 95 | 9 | 8 | 9 | 12 |

The PRNG is `mulberry32(seed: uint32)` in `core/game/random.ts`, with `d(n) = 1 + floor(rng() * n)`. Gameplay code never uses `Math.random()`.

## 7. Core tables

| Table | Purpose |
|---|---|
| `core_event_log` | `id`, `type`, `version`, `guildId`, `source`, `payload` (JSON), `occurredAt` |
| `core_event_consumption` | `consumerId`, `eventId` (unique together), `status` (`done` \| `failed`), `attempts`, `lastError`, `updatedAt` |
| `core_scheduled_jobs` | see §8 |
| `core_kv` | `key` (PK), `value` (JSON), `updatedAt`: command hash, last role sync, schema notes |

## 8. DB-backed scheduler (no Redis)

- Table `core_scheduled_jobs`: `id`, `name` (e.g. `jarvis.streak-rollover`), `runAt`, `payload` (JSON), `status` (`pending` \| `running` \| `done` \| `failed` \| `cancelled`), `attempts`, `maxAttempts` (default 5), `lockedUntil`, `lastError`, `dedupeKey` (unique, nullable), timestamps.
- API: `scheduler.define(name, handler)`, `scheduler.enqueue(name, payload, { runAt, dedupeKey })`, `scheduler.cancel(dedupeKey)`, `scheduler.every(name, cron, handler)` for recurring jobs (cron evaluated in `config.timezone`; the next run is enqueued with `dedupeKey = name:<isoRunAt>` so restarts never double-schedule).
- The runner polls every 5 seconds (configurable), claims due jobs atomically (`UPDATE … SET status='running', lockedUntil=now+5m WHERE id=? AND status='pending'`; on Postgres use `FOR UPDATE SKIP LOCKED`), runs them inside an error boundary, and retries with backoff. Jobs whose `lockedUntil` passed (crash mid-run) go back to `pending`.
- Jobs must be idempotent. Missed runs during downtime run once on startup (no catch-up storm: recurring jobs run at most once per missed window).
- The event bus retry uses this scheduler.

## 9. Docker, CI and releases

- **Dockerfile:** multi-stage. Stage 1 installs with `pnpm fetch` + `pnpm install --frozen-lockfile --offline` and builds. Stage 2 is `node:22-bookworm-slim`, copies only `dist` and production deps (`pnpm deploy --prod`), runs as the non-root `node` user, `WORKDIR /app`, `VOLUME /app/data`, `EXPOSE 8080`, `HEALTHCHECK` hitting `GET /healthz` (200 when the DB answers and the Discord client is ready). Entrypoint runs the runner; the `legion` CLI is on `PATH`.
- **docker-compose.yml:** service `legion` with `image: ghcr.io/uminocelo/legion:latest` (and a `build: .` override for contributors), `env_file: .env`, volumes `./data:/app/data`, `./legion.config.yaml:/app/legion.config.yaml:ro`, `./locales:/app/locales:ro`, `restart: unless-stopped`. Profile `postgres` adds a `postgres:16-alpine` service with a volume and sets `DATABASE_URL`. No Redis service until multi-token mode exists.
- `docker compose up -d` must work from a fresh clone with only `.env` filled in and the example config copied.
- **CI (`ci.yml`)** on PRs and `main`: install, Biome check, `tsc -b`, `pnpm test` on SQLite, `pnpm test` again against a Postgres service container, `docker build`.
- **Release (`release.yml`)** on tags `v*`: build and push the multi-arch image (amd64 + arm64 with QEMU/Buildx) to `ghcr.io/uminocelo/legion:<version>` and `:latest`, and create a GitHub Release with the CHANGELOG section.
- Semver for the image. One image contains every bot; `bots:` in the config chooses which run.

## 10. The `legion` CLI (`apps/cli`)

Built with a small arg parser (`commander` or `citty`) and `@clack/prompts` for the interactive parts. Output is localized (pt-BR default). It ships inside the Docker image and runs from a clone with `pnpm legion <cmd>`.

- `legion init`: asks for the token, client id and guild id (with links to where to find them), the locale and which bots to enable, then writes `.env` and `legion.config.yaml` from the examples. It never overwrites existing files without confirmation. Docker-only users: `docker run --rm -it -v "$PWD:/out" ghcr.io/uminocelo/legion legion init --out /out`.
- `legion doctor`: runs every check and prints ✅/⚠️/❌ with a one-line fix for each:
  - `.env` present, token valid (log in via REST), client id matches the token's application
  - the bot is in the guild; privileged intents needed by enabled bots are enabled (Server Members for Cérebro)
  - config valid; channel ids exist and the bot can view, send and embed there
  - the bot's top role sits above every role it manages (§12), with the exact roles listed when not
  - DB reachable and migrations up to date
  - each enabled bot's `doctorChecks`
  - exit code 0 when no ❌, 1 otherwise. `--json` for machine output.
  - In Docker: `docker compose run --rm legion legion doctor`.
- `legion register-commands`: registers the guild slash commands of all enabled bots now and prints the list.
- `legion invite-url`: prints the OAuth2 invite URL with scopes `bot applications.commands` and the union of the enabled bots' permissions.

## 11. Personas and accounts

v0–v3 use **one bot account** (the Discord app the server owner creates). Each bot posts with its own embed author, color and footer (its persona). Later, an optional webhook persona layer and a "multi-token mode" (each bot its own Discord account and process, bus over Redis) may be added as opt-in profiles. Don't build either now, but keep the `persona` field and the `EventBus`/`DiscordGateway` interfaces so they can be added without touching bot logic.

## 12. Server role set

Defined in `legion.config.yaml` under `roles` (fields: `key`, `name`, `color` hex or null, `group`, `managedBy`, `hoist`, `mentionable`). Server owners may rename roles; code refers to roles by `key`, never by display name. Defaults (names in Portuguese because the official server is Brazilian):

| key | Group | Default name | Color | Managed by |
|---|---|---|---|---|
| `staff_owner` | Staff | Professor X | #F1C40F | manual (create if missing, never assign) |
| `staff_council` | Staff | Conselho da Legião | #9B59B6 | manual (create if missing, never assign) |
| `staff_bots` | Staff | Sentinela | #95A5A6 | manual (for Legion bots; create if missing, never assign) |
| `signal` | Onboarding | Sinal Detectado | none | Cérebro |
| `registered` | Onboarding | Mutante Registrado | #5DADE2 | Cérebro |
| `faction_xmen` | Faction (exactly one) | X-Men | #3498DB | Cérebro |
| `faction_brotherhood` | Faction (exactly one) | Irmandade | #E74C3C | Cérebro |
| `faction_independent` | Faction (exactly one) | Independente | #2ECC71 | Cérebro |
| `rank_recruta` | Rank | Recruta | default | Cérebro (assigned at registration) |
| `rank_agente` | Rank | Agente | default | Cérebro, on `rank.changed` from J.A.R.V.I.S. |
| `rank_veterano` | Rank | Veterano | default | Cérebro, on `rank.changed` from J.A.R.V.I.S. |
| `tiktok_sub` | Community | Assinante TikTok | — | **TikTok integration. NEVER create, edit, assign or remove** |
| `supporter` | Community | Apoiador | default | manual (create if missing, cosmetic only, never auto-assign) |
| `live_ping` | Community | Aviso de Live | default | Cérebro (opt-in toggle) |
| `rivals_vanguard` | Rivals (optional) | Vanguarda | default | Cérebro (self-pick toggle) |
| `rivals_duelist` | Rivals (optional) | Duelista | default | Cérebro (self-pick toggle) |
| `rivals_strategist` | Rivals (optional) | Estrategista | default | Cérebro (self-pick toggle) |

Factions (config `factions`): `xmen` → `faction_xmen`, `brotherhood` → `faction_brotherhood`, `independent` → `faction_independent`, each with a display name and a one-line description in the locale files.

Rules for every bot:
- Only `RoleService` in core touches roles. It refuses (throws in tests, logs and skips in production) any operation on the `tiktok_sub` role, matched by key **and** by the name "Assinante TikTok" and by Discord's `managed`/integration flag. A test covers this guard.
- Discord only lets a bot assign roles below its own top role. The README, `/cerebro setup` and `legion doctor` must all explain dragging the bot's role above every managed role.
- Bots never delete roles and never rename roles they don't manage.

## 13. Trademark and original-characters rules

- Legion, Cérebro, H.E.R.B.I.E., J.A.R.V.I.S., ULTRON, Sentinel, X-Men and every other Marvel name belong to Marvel/Disney. This is a **free, non-commercial fan project** funded only by donations and sponsors (GitHub Sponsors, Ko-fi, Apoia.se, PIX). Supporter perks are cosmetic only; nothing gameplay-related is ever sold. README and docs must include this trademark note.
- **No canon characters as player or enemy identities.** Player mutants, enemies, bosses, missions and AI flavor text use original names. Keep a shared blocklist at `packages/core/data/canon-names.txt` (one name per line, PT and EN variants: Wolverine, Tempestade, Storm, Magneto, Jean Grey, Ciclope, Cyclops, Vampira, Rogue, Gambit, Noturno, Nightcrawler, Deadpool, Fera, Beast, Homem de Gelo, Iceman, Colossus, Mística, Mystique, Professor X, Charles Xavier, Apocalipse, Apocalypse, Fênix, Phoenix, Kitty Pryde, Lince Negra, Psylocke, Cable, Bishop, Jubileu, Jubilee, Dentes de Sabre, Sabretooth, Juggernaut, Fanático, …). `core/game/canon.ts` exposes `isCanonName(text)`, which normalizes accents, case, spaces, punctuation and leetspeak-ish digits (0→o, 1→i, 3→e, 4→a, 5→s) and checks exact and contained matches. Use it for codenames, community content and AI output.
- If the project ever goes commercial, rebrand first: Legion → Paragon Nexus/Mythos, Cérebro → Beacon/Seeker, H.E.R.B.I.E. → Pip/Byte, J.A.R.V.I.S. → Atlas/Warden, ULTRON → Nemesis/Omnis, Sentinel → Aegis/Bastion. Keep bot display names in config/locales so a rebrand is a config change.
- License: open source (MIT or AGPL; the owner decides before the first public release). Put a `LICENSE` placeholder note in the README until then.

## 14. Docs and ADRs

- `README.md`: what Legion is, screenshots placeholder, 3-step quick start, creating the Discord app, intents, invite URL (`legion invite-url`), moving the bot role up, env vars, config, `docker compose up -d`, `legion doctor`, updating, backups (copy `./data`), enabling more bots, trademark note, donations.
- `docs/SELF_HOSTING.md`: step-by-step for a non-developer (Windows/macOS/Linux with Docker Desktop, and a Raspberry Pi).
- `docs/ARCHITECTURE.md`: Mermaid diagrams of the monorepo layout, the runner boot sequence, the event flow between bots, and each bot's state machine.
- `docs/EVENTS.md`: the catalog from §6.2 kept in sync with `catalog.ts`.
- `docs/CONFIG.md`: every config key with default and example.
- `docs/adr/NNNN-title.md`, one decision per file, format: Status, Context, Decision, Consequences, Alternatives considered. The first ADRs (written with core + Cérebro): 0001 Node/TypeScript over Elixir (ecosystem, contributors; trade-off: no OTP supervision, so error boundaries + Docker restarts + DB-backed idempotent flows), 0002 self-hostable with SQLite default and optional Postgres, 0003 single process and one bot account with personas, 0004 in-process typed event bus with DB outbox, 0005 DB-backed scheduler instead of Redis, 0006 idempotent role sync and the TikTok role guard, 0007 no automatic channel overwrites, 0008 deterministic game rules and optional AI for flavor text only. Each bot prompt lists its own ADRs.
- `CHANGELOG.md` in Keep a Changelog format. `CONTRIBUTING.md` with setup, tests, commit style (Conventional Commits) and how to add an event or a locale key.

## 15. Build order

1. **core + runner + cli + Cérebro (v0)** — the bot prompt for Cérebro includes the core skeleton.
2. **J.A.R.V.I.S. v1** — trivia, XP, ranks, leaderboard, streaks.
3. **H.E.R.B.I.E. v2** — tutorial quests, `/ajuda`, `/regras`, hints. (J.A.R.V.I.S. missions and inventory are the v2 phase of the J.A.R.V.I.S. prompt.)
4. **Sentinel v3** — combat engine, cooldowns, anti-cheat, moderation helpers.
5. **ULTRON v3** — scaled enemies, world events, raids, optional AI flavor text.

Each step leaves `main` releasable: tests green, docs updated, CHANGELOG entry, `docker compose up -d` working with only the bots built so far enabled. Never break an earlier bot's tests.

## 16. Working rules for you (the agent)

- Work in small, reviewable commits (Conventional Commits). Run `pnpm biome check`, `pnpm -r typecheck` and `pnpm test` before saying a task is done.
- Don't invent new events, tables owned by other bots or shared config keys. If you need one, add it here first (catalog, docs, ADR), then implement.
- Don't add paid services, telemetry or network calls other than Discord (and the optional AI endpoint, only in ULTRON, only when enabled).
- Never commit secrets. `.env` is git-ignored; `.env.example` is committed.
- When you finish a bot, update README, docs, CHANGELOG and the example config, and list anything left as TODO in the PR description.

## 17. How to use with the bot prompts

1. Paste this main prompt first, in full.
2. Paste exactly **one** bot prompt after it (Cérebro, J.A.R.V.I.S., H.E.R.B.I.E., Sentinel or ULTRON).
3. Build that bot's scope, following both prompts. The bot prompt defines the bot's features, commands, tables, events and definition of done; this prompt defines everything shared.
4. Start a fresh session for the next bot, pasting this prompt again plus the next bot prompt. Follow the build order in §15.
