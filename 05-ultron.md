# Build prompt: ULTRON v3 (scaled enemies, world events, raids, optional AI flavor text)

**Read and follow the Legion main prompt first:** https://app.notion.com/p/41aa25dbaf35812d879cca9730c99cdf (local copy: `00-main.md`). Everything shared (stack, monorepo layout, conventions, event catalog, DB rules, scheduler, Docker/CI, CLI, role set, trademark rules, ADRs) is defined there. This prompt only adds what is specific to ULTRON.

**Precondition:** core, Cérebro, J.A.R.V.I.S. (v1, and v2 missions if present), H.E.R.B.I.E. and **Sentinel v3** exist and their tests pass. ULTRON never resolves combat itself: it builds encounters and sends `combat.requested` to Sentinel.

## Mission

ULTRON is the villain. It turns missions into fights by spawning **original** enemies scaled to the party, and it keeps the server alive with scheduled world events: a weekly invasion where every faction cooperates, and raid bosses with shared HP. It can optionally use a local or OpenAI-compatible AI to write taunts and announcements, but **only flavor text**: every number and outcome is decided by deterministic code first.

## Version

**v3** (`v0.4.0` release of the image, together with Sentinel v3).

## Scope

**In scope**
- Level-scaled enemy spawner for combat missions (brainstorm idea "Level-scaled enemy spawner").
- Data-driven enemy templates with original names.
- Weekly invasion event (brainstorm idea "Weekly server invasion event"), scheduled with the core scheduler (no Oban/Redis).
- Raid bosses with shared HP (brainstorm idea "Boss raids"), started on a schedule or by staff.
- Rewards for event participants through `xp.grant_requested`.
- Optional adaptive difficulty (brainstorm idea "Adaptive difficulty"), off by default, with a clamped, deterministic formula.
- Optional pluggable AI flavor text (brainstorm idea "LLM taunts and flavor text"), off by default.

**Out of scope**
- Faction wars, server threat meter, multi-wave invasions, web dashboard: v4.
- AI deciding anything (targets, damage, spawns, rewards, schedules): never.
- Canon Marvel villains or characters as enemies.

## Enemy templates

`packages/bot-ultron/content/enemies.yaml`, overridable/extendable by `./data/content/enemies.yaml`. Validated with zod, and every `name` must pass `isCanonName() === false`:

```yaml
- id: drone-vigia
  name: "Drone Vigia"
  tier: minion            # minion | elite | boss
  minLevel: 1
  base: { hp: 60, atk: 8, def: 5, spd: 9, foc: 6 }
  powerCooldownMax: 4
  tauntKeys: [ultron.taunt.drone.1, ultron.taunt.drone.2]
- id: cacador-sintetico
  name: "Caçador Sintético"
  tier: elite
  minLevel: 5
  base: { hp: 120, atk: 12, def: 9, spd: 10, foc: 10 }
  powerCooldownMax: 3
  tauntKeys: [ultron.taunt.cacador.1]
- id: colosso-prime
  name: "Colosso Prime"
  tier: boss
  minLevel: 1
  base: { hp: 0, atk: 16, def: 12, spd: 8, foc: 14 }   # boss HP comes from the event formula
  powerCooldownMax: 3
  tauntKeys: [ultron.taunt.colosso.1]
```

Ship at least 4 minions, 2 elites and 2 bosses, all original (e.g. Drone Vigia, Enxame de Nanites, Unidade Ômega, Sentinela de Sucata… avoid "Sentinel" alone to not confuse it with the bot). Upsert into `ultron_enemy_templates` by `id` with a content hash, like J.A.R.V.I.S. trivia.

## Encounter scaling (pure, `domain/scaling.ts`)

Input: `partyLevel` L, party size n (1–4), difficulty, template list, a seed, optional adaptive multiplier. Output: the enemy combatants.

- **Stat scaling:** each stat = `floor(base * (1 + growth * (L − 1)) * difficultyMultiplier * adaptiveMultiplier)`, with `growth` 0.10, `difficultyMultiplier` `facil` 0.8, `normal` 1.0, `dificil` 1.25. `hp` minimum 1.
- **Composition:** `n` minions, plus 1 more minion on `dificil`, plus 1 elite when `L ≥ 5` and difficulty is not `facil`. Templates are picked with `mulberry32(encounterSeed)` among those with `minLevel ≤ L`, in this order: minions first, then the elite.
- Enemy combatant ids are `enemy:<encounterId>:<index>`, level = L.
- **Adaptive difficulty** (only when `ultron.adaptive.enabled: true`): take the last `windowCombats` (default 50) resolved combats requested by ULTRON in `party` mode. `winRate` = player wins / total (draws count as half). `adaptiveMultiplier = 1 + clamp((winRate − target) * 0.5, −maxAdjust, +maxAdjust)` with `target` 0.65 and `maxAdjust` 0.15. Below `minSample` (default 10) combats, the multiplier is 1. The multiplier used is stored on the encounter so it can be audited.
- Same inputs → same enemies (tested).

## Mission combat flow

1. On `mission.started` with `missionType: 'combat'` (consumer `ultron.spawner`), idempotent by `missionId`:
   - Build the player combatants: for each `memberId`, read the mutant (`ctx.read.mutants`) and progress (`ctx.read.progress`, default level 1), and compute stats with `core/game/stats.ts`.
   - Create the encounter with a new seed (`ctx.random.seed()`), compute enemies, store everything.
   - Emit `combat.requested` with `requestedBy: 'ultron'`, `mode: 'party'` (or `'duel'` for a single player), the mission id, the mission's `channelId`, all combatants and `maxRounds` from config.
   - Post a short ULTRON taunt (flavor text, see below) in the mission channel.
2. On `combat.resolved` where `requestedBy === 'ultron'` and `missionId` is set (consumer `ultron.encounter-result`): store the outcome on the encounter (used by adaptive difficulty). J.A.R.V.I.S. handles mission rewards; ULTRON doesn't grant XP for missions.

## World events

Two kinds share one "shared HP threat" mechanic:

| | Invasion (`invasion`) | Raid (`raid`) |
|---|---|---|
| Theme | A swarm hits the whole server; every faction cooperates | One boss in a thread; opt-in |
| Schedule | Recurring, `ultron.invasion.cron` (default `0 20 * * 6`, Saturday 20:00 local) | Staff command, or optional `ultron.raids.cron` (off by default) |
| Duration | `ultron.invasion.durationMinutes` (60) | `ultron.raids.durationMinutes` (45) |
| Enemy | A minion swarm (display name from the event template) | A `boss` template |
| Results | Totals plus damage per faction | Totals plus top contributors |

**Lifecycle** (state in `ultron_world_events.status`: `scheduled` → `announced` → `active` → `ended`, or `cancelled`):
1. **Scheduled:** the recurring job creates the next event row (dedupe by kind + start time) and a job for the announcement.
2. **Announced** (`announceMinutesBefore`, default 60): post an announcement embed in `channels.events` and emit `world.event` (`phase: 'announced'`). H.E.R.B.I.E. posts an explanation if enabled. Optional role ping: `ultron.events.pingRoleKey` (default `null`; never `@everyone`).
3. **Active** at `startsAt`: fix the shared HP once: `maxHp = hpPerParticipant * expectedParticipants * difficultyMultiplier` (defaults 300, 8, `normal`). With adaptive difficulty enabled, `expectedParticipants` = the rounded average participants of the last 3 ended events of that kind (min 3). The boss's other stats use the template scaled to `bossLevel` (config number, or `auto` = median level of the last event's participants, default 5). Post the event embed with an HP bar, time left and a **Participar / Atacar** button (`ultron:v1:strike:<worldEventId>`). For raids, create a thread for it. Emit `world.event` (`phase: 'started'`).
4. **Strikes:** a registered member clicks Atacar. If they're on cooldown, reply ephemerally with the time left. Otherwise, in one transaction, upsert them as a participant, set `nextStrikeAt = now + strikeCooldownMinutes` (default 10), create a strike row with a new `combatId`, and emit `combat.requested` with `mode: 'raid_strike'`, `raidId = worldEventId`, the player combatant and a boss snapshot combatant. Reply ephemerally "Ataque enviado!".
5. **Applying results** (consumer `ultron.raid-result` on `combat.resolved` with a `raidId`): idempotent by `combatId` (the strike row). In one transaction subtract `damageBySide.players` from the event `hp` (minimum 0), add to the participant's and the faction's damage. If the player isn't in `survivors`, double their next cooldown (they were knocked out). Edit the event embed at most every 10 seconds (throttled, last write wins). If `hp` reaches 0, end with `victory`.
6. **Ended** (HP 0, or the `endsAt` job finds `hp > 0` → `defeat`): set the status, post results (outcome, total damage, top 5 contributors, damage per faction for invasions), and emit `world.event` (`phase: 'ended'`, `outcome`, `participantMemberIds`). Then emit one `xp.grant_requested` per participant with `sourceEventId = worldEventId`, `reason: 'world_event'`: victory `victoryXp` (50) + contribution bonus `floor(bonusXpMax * participantDamage / topDamage)` (bonus max 50); defeat `participationXp` (15). Strikes that resolve after the end are recorded but don't change the outcome.
7. **Cancel:** `/ultron evento cancelar` sets `cancelled`, removes pending jobs (`scheduler.cancel`), edits the messages and emits `world.event` (`phase: 'ended'`, `outcome: null`).

All timings come from scheduler jobs with dedupe keys (`ultron.announce:<id>`, `ultron.start:<id>`, `ultron.end:<id>`), so restarts never double-fire and missed jobs run once on startup.

## Optional AI flavor text

- Interface in this package: `FlavorTextProvider.generate(kind, context): Promise<string | null>`, with `kind` in `enemy_taunt` | `event_announcement` | `event_victory` | `event_defeat`.
- Providers (config `ultron.ai.provider`):
  - `none` (default): pick a line from the locale files with the seeded PRNG.
  - `openai-compatible`: POST `{AI_BASE_URL}/chat/completions` (works with Ollama at `http://ollama:11434/v1` and with any OpenAI-compatible API), `model = AI_MODEL`, optional `Authorization: Bearer AI_API_KEY`, `max_tokens` 80, `temperature` 0.9, timeout `ultron.ai.timeoutMs` (4000).
- **Order matters:** mechanics are computed and stored first, then text is requested. The context sent to the model contains only already-decided facts (enemy names, event title, numbers to mention) and the locale. The system prompt tells the model it is an original villain AI in a fan game, to write one short sentence in the configured language, and to never name real Marvel characters, real people, or anything violent beyond cartoon level.
- **Output filter:** strip mentions (`@`, `<@…>`, `<#…>`, `<@&…>`), URLs and newlines; trim to 200 chars; reject if `isCanonName` matches or the text is empty → fall back to the static line. Messages are always sent with `allowedMentions: { parse: [] }`.
- Budget: at most `ultron.ai.maxCallsPerHour` (30). Errors, timeouts and budget hits silently fall back to static text and are logged at `warn` (once per minute).
- Docker: document an optional `ollama` compose profile in `docs/SELF_HOSTING.md` (not started by default).

## Commands

| Command | Who | What |
|---|---|---|
| `/ameaca` | everyone | Current or next world event: kind, status, HP bar, time left, your damage and cooldown. |
| `/ultron evento agendar <tipo> <quando>` | staff | Schedule an invasion or raid (`quando` as `AAAA-MM-DD HH:mm` in the server timezone, or `+30m`). |
| `/ultron evento iniciar <tipo>` | staff | Start one now (skips the announcement wait, still announces). |
| `/ultron evento cancelar` | staff | Cancel the scheduled or active event. |
| `/ultron spawn <dificuldade> [membros]` | staff | Test encounter: spawn enemies for up to 4 members and send `combat.requested` without a mission. |
| `/ultron status` | staff | Next scheduled events, last results, adaptive multiplier and sample size, AI provider status. |

Register `/ameaca` in `HelpRegistry` and a glossary hint for H.E.R.B.I.E. (`evento mundial`, `raid`).

## Data model (owned by ULTRON)

- `ultron_enemy_templates`: `id` (PK), `name`, `tier`, `minLevel`, `base` (JSON), `powerCooldownMax`, `tauntKeys` (JSON), `contentHash`, `active`, `updatedAt`.
- `ultron_encounters`: `id`, `guildId`, `missionId` (unique, nullable for `/ultron spawn`), `combatId`, `seed`, `partyLevel`, `partySize`, `difficulty`, `adaptiveMultiplier`, `enemies` (JSON), `outcome` (nullable), `createdAt`, `resolvedAt`.
- `ultron_world_events`: `id`, `guildId`, `kind`, `templateId`, `status`, `scheduledBy` (`cron` | staff user id), `announceAt`, `startsAt`, `endsAt`, `maxHp`, `hp`, `bossLevel`, `difficulty`, `outcome`, `channelId`, `messageId`, `threadId`, `createdAt`, `updatedAt`. Unique `(guildId, kind, startsAt)`.
- `ultron_event_participants`: `worldEventId`, `memberId` (unique together), `faction`, `damage`, `strikes`, `knockouts`, `nextStrikeAt`, `joinedAt`.
- `ultron_strikes`: `combatId` (PK), `worldEventId`, `memberId`, `damage` (nullable until applied), `appliedAt`.
- `ultron_faction_damage`: `worldEventId`, `faction` (unique together), `damage`.
- `ultron_flavor_log`: `id`, `kind`, `provider`, `ok` (0/1), `latencyMs`, `createdAt` (no prompt or output text stored).

## Events

- **Consumes:** `mission.started` (spawner), `combat.resolved` (encounter results and raid strikes), `mission.completed` (stats only, optional).
- **Emits:** `combat.requested` (`party`/`duel` for missions, `raid_strike` for events), `world.event` (`announced`, `started`, `ended`), `xp.grant_requested` (`reason: 'world_event'`). Payloads exactly as in the main catalog.

## Config keys (`ultron:` section)

```yaml
ultron:
  combat:
    maxRounds: 20
  scaling:
    growth: 0.10
    difficultyMultiplier: { facil: 0.8, normal: 1.0, dificil: 1.25 }
  adaptive:
    enabled: false
    windowCombats: 50
    minSample: 10
    target: 0.65
    maxAdjust: 0.15
  events:
    pingRoleKey: null
    announceMinutesBefore: 60
    strikeCooldownMinutes: 10
    hpPerParticipant: 300
    expectedParticipants: 8
    bossLevel: auto            # auto | number
    rewards: { victoryXp: 50, bonusXpMax: 50, participationXp: 15 }
  invasion:
    enabled: true
    cron: "0 20 * * 6"
    durationMinutes: 60
    templateId: enxame-de-nanites
  raids:
    cron: null                 # e.g. "0 21 * * 3"; null = staff only
    durationMinutes: 45
    templateIds: [colosso-prime]
  ai:
    provider: none             # none | openai-compatible
    timeoutMs: 4000
    maxCallsPerHour: 30
```

Plus `channels.events` (required when invasions or raids are enabled) and the optional `AI_*` env vars. Doctor checks: events channel exists with send, embed and create-thread permissions; if `provider: openai-compatible`, `AI_BASE_URL` and `AI_MODEL` are set and a 1-token test call answers within the timeout (warning only).

## Edge cases

- `mission.started` delivered twice: one encounter (unique `missionId`).
- A member strikes after the event ended: reply "o evento já terminou"; no combat is requested.
- Sentinel disabled: config validation fails when ULTRON is enabled without Sentinel, with a clear message.
- J.A.R.V.I.S. disabled: participants get no XP (the events still work); the results embed hides XP lines.
- Two events overlapping (staff schedules a raid during an invasion): allowed for different kinds; the same kind can't overlap (reply with an error).
- Bot down during `startsAt` or `endsAt`: the missed job runs once on startup; an event whose `endsAt` already passed while it was down ends immediately with its current HP.
- Embed edit rate limits: throttle edits, never fail a strike because an edit failed.
- AI returns a canon name, a mention, a link or garbage: filtered, falls back to static text.
- Server owner adds an enemy template with a canon name: content validation rejects it with a readable error and keeps the previous content.

## Tests (must pass)

- Scaling (pure): stat formula, difficulty multipliers, composition rules, `minLevel` filtering, same seed → same enemies; property test (fast-check) that stats are positive integers and monotonic in level.
- Adaptive multiplier: below `minSample` = 1, clamp bounds, draws count half.
- Mission flow with fakes: `mission.started` → exactly one `combat.requested` with correct combatants; `combat.resolved` stored on the encounter.
- World event lifecycle with a fake clock: schedule → announce → start → strikes → victory; and → timeout → defeat; cancel removes jobs; restart at each phase resumes correctly without double posts.
- Strike application is idempotent by `combatId`; HP never goes below 0; knockout doubles the cooldown; faction damage sums.
- Rewards: one `xp.grant_requested` per participant with the right amounts; replays don't duplicate.
- AI provider: timeout → fallback; output filter strips mentions/links and rejects canon names; budget limit; `provider: none` never makes network calls (assert with a mocked `fetch`).
- Enemy content validation, including the canon-name check.

## ULTRON ADRs

- 0022 Encounters are deterministic from a stored seed and stored multipliers.
- 0023 World events use a shared-HP threat resolved through `raid_strike` combats in Sentinel.
- 0024 AI is optional, OpenAI-compatible, off by default, and limited to flavor text after mechanics are decided.

## Definition of done

- A combat mission (or `/ultron spawn`) spawns enemies scaled to the party, Sentinel resolves the fight, and the outcome is stored.
- The weekly invasion is announced, runs with shared HP, ends with victory or defeat on time, and posts results with damage per faction; participants get XP once.
- A staff-started raid works the same way in its own thread.
- Restarting the bot at any phase loses nothing and posts nothing twice.
- With `ai.provider: none` (default) there are no network calls; with a local Ollama, taunts appear and never change any number.
- `pnpm test` green on SQLite and Postgres, docs (`docs/WORLD_EVENTS.md`, AI section in `SELF_HOSTING.md`), example config and CHANGELOG updated, release `v0.4.0` together with Sentinel.
