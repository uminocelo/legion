# Build prompt: J.A.R.V.I.S. v1 (trivia, XP, ranks, leaderboard, streaks)

**Read and follow the Legion main prompt first:** https://app.notion.com/p/41aa25dbaf35812d879cca9730c99cdf (local copy: `00-main.md`). Everything shared (stack, monorepo layout, conventions, event catalog, DB rules, scheduler, Docker/CI, CLI, role set, trademark rules, ADRs) is defined there. This prompt only adds what is specific to J.A.R.V.I.S.

**Precondition:** core, runner, CLI and Cérebro v0 already exist and their tests pass. Don't change their behavior; if you must change core, keep it backwards compatible and add tests.

## Mission

J.A.R.V.I.S. is the game master. In v1 it gives players a reason to come back every day: quick trivia, XP, levels, ranks that show up as Discord roles, a leaderboard and daily streaks. It is also the **single owner of XP**: other bots ask it to grant XP through the `xp.grant_requested` event.

## Version

**v1** (`v0.2.0` release of the image). Missions, inventory and economy are the **v2 phase** of this bot, outlined at the end of this prompt; don't build them now.

## Scope

**In scope (v1)**
- `/trivia` with multiple-choice questions from content files (brainstorm idea "/trivia with leaderboard").
- XP ledger, level curve, ranks Recruta → Agente → Veterano by XP thresholds in config.
- Rank changes emitted as `rank.changed`, so Cérebro swaps the rank roles.
- `/ranking` leaderboard (week, month, all time; optional faction filter).
- Daily streaks with a small bonus.
- Profile section in `/perfil` (through `ProfileRegistry`).
- Handling `xp.grant_requested` from any bot (used by H.E.R.B.I.E. in v2).
- Staff tools: XP adjustment, trivia reload, trivia stats.

**Out of scope (v1)**
- Missions, inventory, gear, credits, shop, skill tree (v2 phase, see the end).
- Public timed trivia rounds in a channel ("trivia relâmpago"): later idea, leave an issue.
- Any AI-generated questions.

## Trivia

**Content:** `packages/bot-jarvis/content/trivia/pt-BR.yaml` (and optional `en.yaml`), plus optional server packs in `./data/content/trivia/*.yaml`. Format, validated with zod:

```yaml
- id: xmen-0001            # stable, unique
  category: quadrinhos     # quadrinhos | rivals | geral (configurable list)
  difficulty: facil        # facil | normal | dificil
  question: "Em que ano os X-Men estrearam nos quadrinhos?"
  choices: ["1961", "1963", "1966", "1970"]
  answer: 1                # index into choices
  explanation: "X-Men #1 saiu em 1963."
  source: "https://..."    # where the fact can be checked
```

Ship **30 starter questions in pt-BR** (10 per category). Only use facts you are sure about and fill `source`; the owner reviews them before release. Questions may mention Marvel facts; that is fine for a fan project, but never use copyrighted text or images. On boot (and on `/jarvis trivia recarregar`), upsert questions into `jarvis_trivia_questions` by `id`, using `contentHash` to detect changes; questions removed from files become `active = 0`, never deleted (old attempts keep their reference).

**Flow:**
1. `/trivia [categoria]`. Unregistered members get `jarvis.errors.not_registered` with a pointer to the welcome channel.
2. Rate limit: one attempt every `jarvis.trivia.cooldownSeconds` (default 30). If an attempt is still open, show it again instead of creating a new one.
3. Pick a question: active, matching the category and locale, not seen by this member in the last `jarvis.trivia.noRepeatDays` (default 30); if none, the least recently seen. Selection uses the seeded `RandomSource`.
4. Create `jarvis_trivia_attempts` with a shuffled choice order (seeded, stored) and `expiresAt = now + timeLimitSeconds` (default 20).
5. Reply **ephemerally** with an embed (persona J.A.R.V.I.S.): question, category, difficulty, a "responda em 20s" line, and 4 buttons `jarvis:v1:trivia:<attemptId>:<displayIndex>`.
6. On click: load the attempt. If already answered, show the stored result (idempotent). If `now > expiresAt`, mark `expired` and show "tempo esgotado" with the right answer (0 XP). Otherwise mark `answered`, compute the result, and in one transaction write the attempt, the ledger entry and the progress update, and emit `trivia.answered` (+ `xp.awarded`, `level.changed`, `rank.changed`, `streak.updated` when they apply).
7. Show the result with the explanation, XP gained, level progress bar and a **Próxima pergunta** button (`jarvis:v1:trivia-next`) that behaves like `/trivia` (cooldown still applies).

**Scoring (pure function `scoreTrivia`)**
- Wrong or expired: 0 XP.
- Correct: `base[difficulty]` (`facil` 10, `normal` 15, `dificil` 25) + speed bonus `floor(5 * remainingMs / limitMs)`.
- Daily trivia XP cap per member: `jarvis.trivia.dailyXpCap` (default 300). Above it, answers still count for stats and streaks but give 0 XP and say so.

## XP, levels and ranks

- **Ledger first:** every XP change is a row in `jarvis_xp_ledger` with a unique `sourceKey` (e.g. `trivia:<attemptId>`, `grant:<sourceEventId>:<reason>`, `streak:<memberId>:<day>`, `admin:<interactionId>`). Inserting a duplicate `sourceKey` is a no-op. `jarvis_progress.xp` is the sum of the ledger and can be rebuilt (`/jarvis recalcular` staff command, plus a test).
- **Level curve** (config): `level = min(maxLevel, floor(sqrt(xp / levelFactor)) + 1)`, default `levelFactor: 50`, `maxLevel: 50`. So level 2 at 50 XP, level 3 at 200, level 5 at 800, level 10 at 4050.
- **Ranks** from config thresholds (default `recruta: 0`, `agente: 500`, `veterano: 2000`). Rank is derived from total XP. When it changes, emit `rank.changed` (Cérebro swaps the roles and updates `members.rank`). Ranks go down only through a staff XP adjustment.
- `xp.awarded` is emitted for every positive ledger entry; `level.changed` when the level changes.

## Daily streaks

- A member's **active day** is a calendar day in `config.timezone` on which they earned XP from any reason except `streak_bonus` and `admin_adjust`.
- On the first such award of a day: if `lastActiveDay` is yesterday, `currentStreak + 1`; if it is today, nothing; otherwise `currentStreak = 1`. Update `bestStreak`. Grant a streak bonus of `min(currentStreak, streakBonusCap) * streakBonusPerDay` XP (defaults 7 and 5) with `sourceKey = streak:<memberId>:<day>`. Emit `streak.updated`.
- No nightly job is needed: a streak is shown as current only if `lastActiveDay` is today or yesterday; otherwise it displays as 0.

## Leaderboard

`/ranking [periodo] [faccao]`
- `periodo`: `semana` (Monday 00:00 local to now, default), `mes`, `total`.
- `faccao`: optional filter.
- Public embed with the top 10 (codename, faction emoji, XP in period, level) plus a line with the caller's position, and a footer with faction totals for the period. Computed from the ledger with a SQL `SUM … GROUP BY` and an index on `(guildId, createdAt)`.
- `/ranking` has a per-channel cooldown of 15 seconds to avoid spam.

## Commands

| Command | Who | What |
|---|---|---|
| `/trivia [categoria]` | registered | Ephemeral question (above). |
| `/ranking [periodo] [faccao]` | everyone | Leaderboard. |
| `/sequencia` | registered | Ephemeral: current and best streak, today's status, bonus for tomorrow. |
| `/jarvis xp <membro> <quantidade> <motivo>` | staff | Add or remove XP (−1000..1000), ledger reason `admin_adjust`. Logged. |
| `/jarvis trivia recarregar` | staff | Reload content files; reply with added/updated/deactivated counts and validation errors. |
| `/jarvis trivia estatisticas` | staff | Questions per category, accuracy per question (lowest 5), attempts today. |
| `/jarvis recalcular <membro>` | staff | Rebuild progress from the ledger. |

Provide the `progress` read model (`ctx.provide`), so other bots can read level, XP, rank and streak. Register `/trivia`, `/ranking` and `/sequencia` in `HelpRegistry`. Add a `ProfileRegistry` section: level, XP with a progress bar to the next level, rank, current/best streak.

## Data model (owned by J.A.R.V.I.S.)

- `jarvis_progress`: `memberId` (PK), `guildId`, `xp` (integer), `level`, `rank`, `currentStreak`, `bestStreak`, `lastActiveDay` (`YYYY-MM-DD`, nullable), `triviaXpToday`, `triviaXpDay`, `updatedAt`.
- `jarvis_xp_ledger`: `id`, `guildId`, `memberId`, `amount` (integer, may be negative for admin), `reason` (`trivia` | `streak_bonus` | `grant` | `admin_adjust` | later `mission`), `note` (nullable: the grant's own reason such as `tutorial` or `world_event`, or the admin's text), `sourceKey` (unique), `day` (local `YYYY-MM-DD`), `createdAt`. Index `(guildId, createdAt)`, `(memberId)`.
- `jarvis_trivia_questions`: `id` (content id, PK), `locale`, `category`, `difficulty`, `question`, `choices` (JSON), `answerIndex`, `explanation`, `source`, `contentHash`, `active`, `updatedAt`.
- `jarvis_trivia_attempts`: `id`, `guildId`, `memberId`, `questionId`, `choiceOrder` (JSON array of original indexes), `status` (`open` | `answered` | `expired`), `chosenIndex` (nullable, original index), `correct` (0/1, nullable), `msToAnswer` (nullable), `xpAwarded`, `createdAt`, `expiresAt`, `answeredAt`. Index `(memberId, createdAt)`.

## Events

- **Consumes:**
  - `player.created` (consumer `jarvis.progress-init`): create the `jarvis_progress` row (idempotent upsert).
  - `xp.grant_requested` (consumer `jarvis.xp-grant`): validate amount (1–1000) and that the member exists, then write a ledger entry with `sourceKey = grant:<sourceEventId>:<reason>`. Duplicate → no-op.
- **Emits:** `xp.awarded`, `level.changed`, `rank.changed`, `trivia.answered`, `streak.updated`. Payloads exactly as in the main catalog. All are emitted inside the same transaction as the state change.

## Config keys (`jarvis:` section)

```yaml
jarvis:
  trivia:
    categories: [quadrinhos, rivals, geral]
    timeLimitSeconds: 20
    cooldownSeconds: 30
    noRepeatDays: 30
    dailyXpCap: 300
    baseXp: { facil: 10, normal: 15, dificil: 25 }
    speedBonusMax: 5
  levels:
    levelFactor: 50
    maxLevel: 50
  ranks:                       # XP thresholds; keys match the rank_* role keys
    recruta: 0
    agente: 500
    veterano: 2000
  streak:
    bonusPerDay: 5
    bonusCap: 7
  leaderboard:
    size: 10
    channelCooldownSeconds: 15
```

zod rules: thresholds strictly increasing, `recruta` must be 0, all numbers positive integers.

## Edge cases

- Member answers after the bot restarted: the attempt is in the DB, so it still works (or expires correctly).
- Double click on an answer: the second click shows the same stored result; no extra XP.
- Old buttons from a removed question: still resolve, because the attempt stores the question id and choices are kept.
- Admin removes XP below a rank threshold: rank goes down, `rank.changed` emitted.
- Member left the server: progress is kept; they are hidden from `/ranking` while `members.leftAt` is set.
- Day boundary: use `config.timezone` (America/Sao_Paulo by default) for streaks, caps and "semana".
- Empty question pool for a category: friendly message, logged warning.
- `xp.grant_requested` for an unknown member: mark the consumption done and log a warning (don't retry forever).

## Tests (must pass)

- `scoreTrivia`: correct/wrong/expired, speed bonus bounds, daily cap.
- Question selection respects `noRepeatDays` and falls back to least recently seen; same seed → same pick.
- Answer handling is idempotent (double click, replayed event) and survives restart.
- Ledger idempotency by `sourceKey`; progress rebuilt from the ledger equals the incremental value (property test with fast-check over random award sequences).
- Level curve and rank thresholds (boundaries 0, 49, 50, 499, 500, 1999, 2000).
- `rank.changed` emitted exactly once per crossing, including downward admin adjustments.
- Streak rules: consecutive days, gap, same day, timezone boundary at 23:59/00:00 in America/Sao_Paulo.
- Leaderboard period windows and faction filter.
- Content loader: invalid YAML gives readable errors; removed questions become inactive.
- Integration: `/trivia` → answer → Cérebro receives `rank.changed` and swaps roles (using the fake gateway).

## J.A.R.V.I.S. ADRs

- 0012 XP is a ledger with idempotency keys; totals are derived.
- 0013 J.A.R.V.I.S. is the only XP writer; other bots use `xp.grant_requested`.
- 0014 Streaks computed lazily from `lastActiveDay` (no nightly job).

## Definition of done

- A registered member can run `/trivia`, answer, earn XP, and see it in `/perfil` and `/ranking`.
- Crossing 500 XP gives the `Agente` role (and removes `Recruta`) through Cérebro; 2000 gives `Veterano`.
- Streaks count across days in the server timezone, and the bonus is granted once per day.
- Restarting the bot mid-question loses nothing and duplicates nothing.
- Staff tools work and are restricted.
- `pnpm test` green on SQLite and Postgres, docs (`CONFIG.md`, `EVENTS.md`, README section) and CHANGELOG updated, `legion.config.example.yaml` has the `jarvis:` section, release `v0.2.0`.

## Next phases (do not build now)

These are for later prompts; keep the design open for them.

- **v2 missions** (brainstorm "Branching text missions"): missions defined in YAML content (`content/missions/*.yaml`) as small graphs of scenes with button choices; solo or party (max 4) in a thread; daily/weekly/story missions; emits `mission.started` and `mission.completed`; rewards through the ledger (`reason: mission`). Combat missions send `mission.started` with `missionType: 'combat'` so ULTRON (v3) spawns enemies and Sentinel resolves the fight; J.A.R.V.I.S. consumes `combat.resolved` for rewards. Tables: `jarvis_missions`, `jarvis_mission_runs`, `jarvis_mission_choices`.
- **v2 inventory and gear** (brainstorm "Inventory and gear slots"): `/inventario`, equip items in slots (traje, acessório, dispositivo) that add flat bonuses to the core stats; tables `jarvis_items` (content), `jarvis_inventory`, `jarvis_equipment`.
- **Economy:** credits earned from missions and events, a shop for gear and cosmetic items; supporter perks remain cosmetic only and nothing is ever sold for real money inside the game. Table `jarvis_wallet_ledger` (same ledger pattern as XP).
- **Skill tree** (brainstorm "XP curve and skill tree"): level-ups grant points for power upgrades, data-driven per archetype.
- **Community missions** (brainstorm "Community-made missions", v5): servers install YAML content packs; validated with zod and the canon-name filter.
