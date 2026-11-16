# Build prompt: H.E.R.B.I.E. v2 (tutorial quests, /ajuda, rules glossary, hints)

**Read and follow the Legion main prompt first:** https://app.notion.com/p/41aa25dbaf35812d879cca9730c99cdf (local copy: `00-main.md`). Everything shared (stack, monorepo layout, conventions, event catalog, DB rules, scheduler, Docker/CI, CLI, role set, trademark rules, ADRs) is defined there. This prompt only adds what is specific to H.E.R.B.I.E.

**Precondition:** core, Cérebro v0 and J.A.R.V.I.S. v1 exist and their tests pass. H.E.R.B.I.E. must also work when J.A.R.V.I.S. is disabled (tutorial steps that depend on it are skipped, and XP rewards are simply not granted).

## Mission

H.E.R.B.I.E. is the friendly helper. It welcomes new mutants into the game with a short tutorial quest chain, answers "how does this work?" with `/ajuda` and `/regras`, and posts optional tips. Its tone is cheerful and short (a helpful little robot), always in Brazilian Portuguese by default.

## Version

**v2** (`v0.3.0` release of the image). It ships together with the v2 phase of J.A.R.V.I.S. (missions, inventory), but it must not depend on missions existing: the mission step has a fallback.

## Scope

**In scope**
- 3-step tutorial quest chain started by `player.created` (brainstorm idea "3-step tutorial quest chain": profile, first trivia, first mission).
- Data-driven quests in YAML with event-based completion triggers.
- Context-aware `/ajuda` (brainstorm idea "Context-aware /help"): adapts to the member's tutorial step, level and enabled bots.
- `/regras [termo]` rules glossary with autocomplete (brainstorm idea "Rules glossary command").
- Optional daily tip posted by a scheduled job (brainstorm idea "Daily tip of the day"), off by default.
- Per-member language preference `/idioma` (brainstorm idea "PT-BR / EN language toggle"), implemented as a `LocaleResolver` for core i18n.
- Backfill: members registered before H.E.R.B.I.E. was enabled can start the tutorial with `/tutorial`.
- Explaining `world.event` announcements in plain words when ULTRON is enabled (v3; just subscribe and render if the event arrives).

**Out of scope**
- AI-generated help answers.
- Free-text question answering, FAQ search over messages (no Message Content intent).
- Moderation (Sentinel).

## Tutorial quest chain

**Content:** `packages/bot-herbie/content/tutorial.yaml`, overridable by `./data/content/tutorial.yaml`. Validated with zod:

```yaml
chain: boas-vindas
steps:
  - id: perfil
    titleKey: herbie.quest.perfil.title
    bodyKey: herbie.quest.perfil.body          # "Use /perfil para ver seu mutante"
    trigger: { event: command.executed, where: { command: perfil } }
    rewardXp: 20
  - id: primeira-trivia
    titleKey: herbie.quest.trivia.title
    bodyKey: herbie.quest.trivia.body
    requiresBot: jarvis
    trigger: { event: trivia.answered }        # any answer counts, right or wrong
    rewardXp: 30
  - id: primeira-missao
    titleKey: herbie.quest.missao.title
    bodyKey: herbie.quest.missao.body
    requiresBot: jarvis
    requiresFeature: missions                  # J.A.R.V.I.S. v2 missions enabled
    trigger: { event: mission.completed }
    fallback:                                  # used when missions are not available
      id: preferencias
      titleKey: herbie.quest.preferencias.title
      bodyKey: herbie.quest.preferencias.body  # "Use /cerebro preferencias"
      trigger: { event: command.executed, where: { command: cerebro, subcommand: preferencias } }
    rewardXp: 50
completionRewardXp: 50
```

Rules:
- `requiresFeature: missions` is satisfied when `jarvis` is enabled and `jarvis.missions.enabled` is `true` in the config (the J.A.R.V.I.S. v2 phase adds that key; treat a missing key as `false`).
- Supported trigger events: `command.executed`, `trivia.answered`, `mission.completed`, `level.changed`, `streak.updated`. `where` matches payload fields exactly. The trigger must refer to the member (`memberId`, or `memberIds` containing it, or `discordUserId`).
- Steps are done in order. Only the current step's trigger counts. A step whose `requiresBot` is disabled is skipped (or replaced by its `fallback`).
- Completing a step: in one transaction update `herbie_tutorial_progress`, emit `quest.completed`, and emit `xp.grant_requested` with `reason: 'tutorial'`, `amount: rewardXp`, `sourceEventId` = the triggering event id. After the last step, also grant `completionRewardXp` (`sourceEventId` = `tutorial:<memberId>:complete`) and set `chainCompleted: true`.
- Consumers are idempotent: the same trigger event never completes a step twice (unique `(memberId, stepId)`).

**Flow**
1. On `player.created` (consumer `herbie.tutorial-start`): create the progress row (idempotent) and send the intro message: "Oi! Eu sou o H.E.R.B.I.E. 🤖…" with the first step, a **Ver missões do tutorial** button (`herbie:v1:tutorial`) and a **Pular tutorial** button (`herbie:v1:skip`, asks to confirm).
2. **Delivery:** `herbie.delivery: dm` (default) tries a DM first. If the DM fails (Discord error 50007, DMs closed), post in `channels.tutorial` (or the welcome channel) mentioning the member, and remember `deliveryFallback = 1` for this member so later messages go straight to the channel.
3. When a step completes, send a short congrats message with the XP gained and the next step.
4. `/tutorial` shows the checklist (✅ done, ▶️ current, ⬜ next) ephemerally, and starts the chain for registered members who don't have one yet (backfill).
5. Skipped chains can be restarted with `/tutorial reiniciar` (no XP is granted again for already completed steps).

## /ajuda (context-aware help)

`/ajuda [topico]`, ephemeral, persona H.E.R.B.I.E.
- Without `topico`: a short "what to do now" section based on the member's state, in this order: not registered → how to register (link to welcome channel); tutorial in progress → the current step; otherwise → suggestions based on enabled bots (e.g. "Faça sua /trivia diária", "Sua sequência está em 4 dias"). Then a list of commands from `HelpRegistry`, grouped by bot, filtered to enabled bots and hiding admin-only entries from non-staff.
- With `topico` (autocomplete from glossary terms and command names): show that entry.
- Buttons: **Tutorial** (`herbie:v1:tutorial`), **Glossário** (`herbie:v1:glossary:0`, paginated).

## /regras (rules glossary)

`/regras [termo]` with autocomplete (max 25 suggestions, accent-insensitive prefix + contains match).
- Content: `packages/bot-herbie/content/glossary.pt-BR.yaml` (+ `en`), overridable in `./data/content/`. Entries: `id`, `term`, `aliases`, `summary` (max 300 chars), `details` (max 1500), `related` (ids), `bot` (which bot the term belongs to; hidden if that bot is disabled).
- Ship entries for at least: facções, arquétipos, codinome, mutante original (no canon characters), XP, nível, rank, sequência, trivia, cooldown, tutorial, and (marked for future bots) combate, poder, defesa, velocidade, foco, evento mundial, raid, denúncia.
- Without `termo`: the server rules summary (same locale key Cérebro uses) plus a link to `channels.rules`.

## Tips (optional)

- `herbie.tips.enabled: false` by default. When enabled, a recurring scheduler job `herbie.daily-tip` (cron `herbie.tips.cron`, default `0 12 * * *` in `config.timezone`) posts one tip in `herbie.tips.channelId`.
- Tips come from `content/tips.pt-BR.yaml`, filtered by enabled bots, rotated without repeats until all were used (state in `herbie_tip_log`).

## Language preference

- `/idioma <pt-BR|en>` stores the member's locale in `herbie_preferences`.
- H.E.R.B.I.E. provides a `LocaleResolver` to core i18n (`ctx.provide('localeResolver', …)`) so every bot's ephemeral replies to that member use their language. Public messages keep `config.locale`.

## World event explanations (only if ULTRON is enabled)

On `world.event` with `phase: 'announced'`, post a short explanation in `channels.events` ("O que é uma invasão? Como participar?") right after ULTRON's announcement, if `herbie.explainWorldEvents: true` (default true). Deduplicate by `worldEventId`.

## Commands

| Command | Who | What |
|---|---|---|
| `/ajuda [topico]` | everyone | Context-aware help (above). |
| `/regras [termo]` | everyone | Glossary or rules summary. |
| `/tutorial [reiniciar]` | registered | Checklist, backfill start, restart. |
| `/idioma <idioma>` | everyone | Language preference. |
| `/herbie dica-agora` | staff | Post the next tip now (to test). |
| `/herbie status` | staff | Tutorial funnel: started, per step, completed, skipped; DM fallback count. |

## Data model (owned by H.E.R.B.I.E.)

- `herbie_tutorial_progress`: `memberId` (PK), `guildId`, `chainId`, `currentStepId` (nullable when done), `status` (`active` | `completed` | `skipped`), `deliveryFallback` (0/1), `startedAt`, `completedAt`, `updatedAt`.
- `herbie_tutorial_steps_done`: `memberId`, `stepId` (unique together), `triggerEventId`, `xpGranted`, `completedAt`.
- `herbie_preferences`: `memberId` (PK), `locale`, `updatedAt`.
- `herbie_tip_log`: `id`, `guildId`, `tipId`, `postedAt`, `cycle` (integer).
- `herbie_world_event_posts`: `worldEventId` (PK), `messageId`, `postedAt`.

## Events

- **Consumes:** `player.created` (start chain), `command.executed`, `trivia.answered`, `mission.completed`, `level.changed`, `streak.updated` (triggers), `world.event` (explanations). Each with a stable consumer id (`herbie.tutorial-start`, `herbie.tutorial-trigger`, `herbie.world-explain`).
- **Emits:** `quest.completed`, `xp.grant_requested` (`reason: 'tutorial'`). Payloads exactly as in the main catalog.

## Config keys (`herbie:` section)

```yaml
herbie:
  delivery: dm                 # dm | channel
  tutorial:
    enabled: true
    allowSkip: true
  tips:
    enabled: false
    channelId: null
    cron: "0 12 * * *"
  explainWorldEvents: true
```

Plus `channels.tutorial`. Doctor checks: if `delivery: channel` or tips are enabled, the channels exist and the bot can send and embed there.

## Edge cases

- `player.created` replayed after a restart: the progress row already exists, no second intro message.
- Member completes a later step's action early (e.g. answers trivia before running `/perfil`): it doesn't count; they will need to do it again when that step is current. The step body says what to do.
- J.A.R.V.I.S. disabled: trivia step skipped, no XP messages ("XP" lines are hidden).
- Missions not available: the fallback step is used. If missions become available later, members already past that step are not affected.
- Member left the server: stop sending; resume if they come back.
- DM delivery fails for other reasons (rate limit, unknown user): log and fall back to the channel.
- Server owner edits `tutorial.yaml` while chains are active: members on a removed step move to the next valid step on their next trigger or `/tutorial` call. Validation errors in the file keep the previous version loaded and log the errors.
- Autocomplete must answer within 3 seconds: glossary is loaded in memory at boot (rebuilt from files, so it's a cache, not state).

## Tests (must pass)

- Quest engine (pure): trigger matching (`where`, member id resolution), order enforcement, `requiresBot` skip, `fallback`, completion reward once.
- Idempotency: the same trigger event twice completes a step once; replayed `player.created` sends one intro.
- `xp.grant_requested` emitted with the triggering event id; with J.A.R.V.I.S. enabled in an integration test, XP is granted exactly once.
- Delivery fallback on DM error 50007 (fake gateway).
- `/ajuda` content depends on state (unregistered, mid-tutorial, done) and hides disabled bots and admin entries.
- Glossary autocomplete: accents, aliases, max 25 results.
- Tip rotation without repeats; recurring job dedupe across restarts.
- `LocaleResolver`: a member with `en` gets English ephemeral replies from another bot.
- Content validation errors are readable and keep the previous content.

## H.E.R.B.I.E. ADRs

- 0015 Tutorial quests are data-driven with event triggers.
- 0016 DM first, channel fallback for tutorial delivery.
- 0017 Member language preference via a core `LocaleResolver`.

## Definition of done

- A new member who registers through Cérebro receives the tutorial intro (DM or channel fallback) within a few seconds.
- Doing `/perfil`, a `/trivia` and a mission (or the fallback step) completes the chain, and XP arrives once per step through J.A.R.V.I.S.
- `/ajuda` and `/regras` give useful, state-aware answers in pt-BR, and in English for members who chose `/idioma en`.
- Tips work when enabled and stay off by default.
- Restarts duplicate nothing.
- `pnpm test` green on SQLite and Postgres, docs, example config and CHANGELOG updated, release `v0.3.0`.
