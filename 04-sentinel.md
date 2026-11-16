# Build prompt: Sentinel v3 (deterministic combat, cooldowns, anti-cheat, moderation helpers)

**Read and follow the Legion main prompt first:** https://app.notion.com/p/41aa25dbaf35812d879cca9730c99cdf (local copy: `00-main.md`). Everything shared (stack, monorepo layout, conventions, event catalog, DB rules, scheduler, Docker/CI, CLI, role set, trademark rules, ADRs) is defined there. This prompt only adds what is specific to Sentinel.

**Precondition:** core, Cérebro v0, J.A.R.V.I.S. v1 (+ v2 missions if present) and H.E.R.B.I.E. v2 exist and their tests pass. Sentinel is built **before** ULTRON, because ULTRON sends it `combat.requested`.

## Mission

Sentinel is the referee and the guard. It resolves turn-based combat with **seeded dice, so every fight can be replayed and checked**, enforces cooldowns and rate limits for all bots, spots suspicious activity, and gives staff a simple report queue with moderation buttons.

## Version

**v3** (`v0.4.0` release of the image, together with ULTRON v3).

## Scope

**In scope**
- Pure, deterministic combat engine (brainstorm idea "Turn-based combat engine": stats, cooldowns, dice; property-tested, with fast-check instead of StreamData).
- Combat sessions driven by `combat.requested`, with per-round action buttons in a thread, timeouts and restart recovery.
- Combat log embeds and replay verification (brainstorm idea "Combat log embeds").
- `/treino` training fight against a dummy, so combat can be tested without missions or ULTRON.
- DB-backed `RateLimiter` for every bot, plus anti-cheat signals (brainstorm idea "Anti-cheat and rate limits").
- Report and moderation queue (brainstorm idea "Report and moderation queue") fed by `report.flagged`, `/denunciar` and a message context menu.

**Out of scope**
- Server-wide threat meter (brainstorm idea "Threat level indicator"): v4.
- PvP duels between members: v4 (the engine supports `duel`, but no command starts one yet).
- Automatic bans or kicks. Sentinel never punishes on its own; it only flags and gives staff buttons.
- Reading message content (no Message Content intent).

## Combat engine (pure, `domain/combat/`)

No Discord, no DB, no clock inside the engine. Inputs: combatants, the seed, and the actions chosen per round. Output: the new state and a log.

**Setup**
- `seed`: a uint32 created once per combat with `ctx.random.seed()` and stored. All dice come from `mulberry32(seed)` in `core/game/random.ts`, consumed in the exact order below.
- Combatants come from the `combat.requested` payload. Player stats are computed by the requester with `core/game/stats.ts` (`computePlayerStats(archetype, level)` plus later gear bonuses). Sentinel validates them with zod and refuses obviously invalid stats (any stat ≤ 0, hp above 5000).
- Every combatant has `hp` (current), `maxHp`, `atk`, `def`, `spd`, `foc`, `powerCooldownMax` (default 3) and `powerCooldown` (current, starts at 0).

**Actions:** `attack`, `power` (only when `powerCooldown == 0`), `defend`.

**One round (`resolveRound(state, playerActions, rng)`):**
1. **Enemy decisions**, in combatant `id` order (ascending): if power is ready and `d(100) ≤ 40` → `power`; else if `hp < 30% of maxHp` and `d(100) ≤ 30` → `defend`; else `attack`. (Two `d(100)` rolls at most per enemy, only when needed, in this order.)
2. **Missing player actions** default to `attack`. A `power` choice while on cooldown becomes `attack`.
3. All `defend` actions take effect at the start of the round.
4. **Turn order:** `spd` descending, then `id` ascending. Downed combatants skip their turn.
5. For each actor that chose `attack` or `power`:
   - **Target:** the living opponent with the lowest current `hp`, ties by lowest `id`. If none, the combat ends.
   - **Hit roll:** `r = d(20)`. Natural 1 always misses; natural 20 always hits and is a critical. Otherwise hit if `r + floor(actor.spd / 3) ≥ 8 + floor(target.spd / 4)`.
   - **Damage (only on hit):** attack `max(1, atk + d(6) − floor(target.def / 2))`; power `max(1, floor(foc * 1.5) + d(8) − floor(target.def / 3))`. Critical doubles it. A defending target takes `max(1, floor(damage / 2))`.
   - Using `power` sets `powerCooldown = powerCooldownMax`.
   - `hp ≤ 0` → downed (`hp = 0`).
6. **End of round:** every `powerCooldown > 0` decreases by 1 (including the one just set, so with max 3, power is ready again 3 rounds later).
7. **End of combat:** checked after every action. When one side has no living combatants, the other side wins and the round stops there. When `round == maxRounds` (default 20), the side with the higher sum of `hp / maxHp` wins; equal → `winnerSide: null` (draw).

**Log:** one entry per action (`round`, `actorId`, `action`, `targetId`, `roll`, `hit`, `crit`, `damage`, `targetHpAfter`), plus round markers. `logHash` = SHA-256 of the canonical JSON of the log (sorted keys). `replayCombat(seed, combatants, actionsByRound)` must reproduce the same log and `logHash`.

## Combat sessions (Discord side)

1. **Start** (consumer `sentinel.combat-start` on `combat.requested`): idempotent by `combatId`. Validate, create the seed, store the combat and combatants, then:
   - `training`, `duel`, `party`: create a thread in `payload.channelId` (fallback `channels.combat`) named `⚔️ Combate #<short id>`, post the participants and the round 1 prompt.
   - `raid_strike`: resolve immediately in one round with the player action "power if ready, else attack", no buttons, then emit `combat.resolved`.
2. **Round prompt:** an embed (persona Sentinel) with HP bars for both sides and, for players, buttons `sentinel:v1:act:<combatId>:<round>:attack|power|defend` (power disabled while on cooldown). Only participants can click; others get `sentinel.errors.not_participant`. A choice can be changed until the round resolves. The round resolves when every living player has chosen, or after `sentinel.combat.roundTimeoutSeconds` (default 45) via a scheduler job with `dedupeKey = sentinel.round:<combatId>:<round>`.
3. **Resolve:** in one transaction, store the round's actions and result, update combatants, and if the combat ended set the status and emit `combat.resolved` (payload as in the main catalog, including `seed` and `logHash`). Then post the round summary (max 8 lines) and the next prompt, or the final result.
4. **Final log embed:** winner, rounds, damage by side, MVP (most damage), and a **Ver log completo** button (`sentinel:v1:log:<combatId>:<page>`), paginated 15 lines per page.
5. **Recovery:** on startup, every `active` combat whose round has no pending timeout job gets one. A round button clicked after a restart still works, because everything is in the DB.
6. **Abandon:** if no player acts for 3 rounds in a row, the combat ends with `winnerSide: 'enemies'` and the log notes "abandonado".

## /treino

`/treino`: a training fight against "Drone de Treino" (original name), `mode: 'training'`, `requestedBy: 'sentinel'`. The dummy's stats are the Tanque archetype at the member's level (from `ctx.read.progress`, default level 1) with `atk` reduced by 30%. No XP or rewards. Cooldown per member: `sentinel.training.cooldownSeconds` (default 300). One active combat per member at a time (any mode except `raid_strike`).

## Rate limits and anti-cheat

- Sentinel provides a **DB-backed `RateLimiter`** to core (`ctx.provide('rateLimiter', …)`), replacing the in-memory default for every bot. Fixed windows stored in `sentinel_rate_buckets`. The core router asks it before every command and component handler, using the policies below. Over the limit → ephemeral `sentinel.errors.slow_down` ("Calma, mutante! Tente de novo em {seconds}s.").
- **Violations:** each rejected request is a violation. `violationsToFlag` violations (default 5) in 10 minutes → `report.flagged` with `reason: 'rate_limit'`, `severity: 'medium'`, at most once per member per hour.
- **XP anomaly** (consumer `sentinel.xp-watch` on `xp.awarded`): if a member's XP in the last hour exceeds `xpAnomalyPerHour` (default 600), flag `xp_anomaly` (`medium`), at most once per member per hour.
- **New accounts** (consumer `sentinel.join-watch` on `member.joined`): `accountCreatedAt` younger than `newAccountDays` (default 7) → flag `new_account` (`low`). This is a signal, not a block.
- **Combat integrity:** stored seeds and `logHash` let staff run `/sentinel replay <combatId>`, which recomputes the fight and reports ✅ match or ❌ mismatch.

## Reports and moderation

1. **Intake:**
   - `report.flagged` from any bot (consumer `sentinel.reports`).
   - `/denunciar <membro> <motivo> [detalhes]` by members (`reporter: 'member'`), limited to 3 per hour per member; can't report yourself or bots.
   - Message context menu **"Denunciar mensagem"**: opens a modal for the reason; the report stores the message link and author (from the interaction payload, no Message Content intent needed).
2. **Grouping:** an open report with the same subject and reason in the last hour is updated (`count + 1`, details appended) instead of creating a new one.
3. **Queue:** each new report posts an embed in `channels.modQueue`: subject (mention + id + account age), reason, severity, count, source, details, links. Buttons (`sentinel:v1:mod:<reportId>:<action>`): **Resolver**, **Ignorar**, **Aviso** (DM with a locale template; falls back to noting "DM fechada"), **Timeout 10 min**, **Timeout 1 h**, **Histórico**. Only `staff_owner` / `staff_council` can use them. Timeouts need the Moderate Members permission (doctor checks it when moderation is enabled).
4. **Logging:** every action goes to `sentinel_moderation_actions` with the staff member, the action and the time, and edits the queue message to show the status. Nothing is automatic.

## Commands

| Command | Who | What |
|---|---|---|
| `/treino` | registered | Training fight. |
| `/combate status` | registered | Your active combat (link to the thread, round, HP). |
| `/combate log <id>` | everyone | Paginated log of a finished combat. |
| `/denunciar <membro> <motivo> [detalhes]` | everyone | Report a member. |
| Context menu "Denunciar mensagem" | everyone | Report a message. |
| `/sentinel replay <combatId>` | staff | Verify determinism. |
| `/sentinel denuncias [status]` | staff | List reports (open by default). |
| `/sentinel historico <membro>` | staff | Reports and actions for a member. |

## Data model (owned by Sentinel)

- `sentinel_combats`: `id` (the `combatId` from the event), `guildId`, `requestedBy`, `mode`, `missionId`, `raidId`, `channelId`, `threadId`, `seed` (integer), `status` (`active` | `finished` | `abandoned`), `round`, `maxRounds`, `winnerSide`, `logHash`, `createdAt`, `finishedAt`.
- `sentinel_combatants`: `id`, `combatId`, `side`, `kind`, `refId`, `name`, `archetype`, `level`, `maxHp`, `hp`, `atk`, `def`, `spd`, `foc`, `powerCooldownMax`, `powerCooldown`, `downedAtRound`.
- `sentinel_combat_rounds`: `combatId`, `round` (unique together), `actions` (JSON: combatantId → action), `log` (JSON), `resolvedAt`.
- `sentinel_pending_actions`: `combatId`, `round`, `combatantId` (unique together), `action`, `chosenAt`.
- `sentinel_rate_buckets`: `key` (e.g. `cmd:<userId>`), `windowStart`, `count` (unique `key, windowStart`). Old windows are pruned by a daily job.
- `sentinel_violations`: `id`, `discordUserId`, `policy`, `createdAt`.
- `sentinel_reports`: `id` (the `reportId`), `guildId`, `subjectDiscordUserId`, `reporter`, `reporterDiscordUserId`, `reason`, `severity`, `details`, `refs` (JSON), `count`, `status` (`open` | `resolved` | `ignored`), `queueMessageId`, `createdAt`, `updatedAt`.
- `sentinel_moderation_actions`: `id`, `reportId`, `staffDiscordUserId`, `action`, `note`, `createdAt`.
- `sentinel_flags_sent`: `subjectDiscordUserId`, `reason`, `hourBucket` (unique together) for the once-per-hour rule.

## Events

- **Consumes:** `combat.requested` (start), `report.flagged` (queue), `xp.awarded` (anomaly), `member.joined` (new accounts).
- **Emits:** `combat.resolved`, `combat.requested` (only for `/treino`, so all combats share one path), `report.flagged` (rate-limit, XP anomaly and new-account flags; Sentinel's own consumer then queues them). Payloads exactly as in the main catalog.

## Config keys (`sentinel:` section)

```yaml
sentinel:
  combat:
    maxRounds: 20
    roundTimeoutSeconds: 45
    powerCooldownRounds: 3
    abandonAfterIdleRounds: 3
  training:
    cooldownSeconds: 300
    dummyAtkMultiplier: 0.7
  rateLimits:
    commandsPerMinute: 20
    componentsPer10Seconds: 15
    reportsPerHour: 3
    violationsToFlag: 5
  antiCheat:
    xpAnomalyPerHour: 600
    newAccountDays: 7
  moderation:
    enabled: true
    timeoutOptionsMinutes: [10, 60]
```

Plus `channels.combat` and `channels.modQueue`. Doctor checks: combat channel allows creating public threads; mod queue channel is visible only to staff (warn if `@everyone` can view it); Moderate Members permission when moderation is enabled.

## Edge cases

- Same `combat.requested` delivered twice: one combat (idempotent by `combatId`).
- Player leaves the server mid-combat: they count as idle (default `attack` is still applied, so the fight stays deterministic given the recorded actions).
- A side is wiped out mid-round: the combat ends right after that action and the remaining turns of the round are skipped (and consume no dice).
- Button from a previous round: `sentinel.errors.round_over`.
- Thread creation fails (permissions): post in the channel instead and log a warning.
- Requester sends a combatant with `level` 0 or missing stats: reject, log, emit nothing (the requester's own retry or timeout handles it).
- Rate limiter must never block staff from `/sentinel` commands or the moderation buttons.
- Clock skew is irrelevant to outcomes: only the seed and actions matter.

## Tests (must pass)

- Engine unit tests for every rule above: hit roll thresholds, natural 1/20, damage formulas, defend halving with minimum 1, cooldown timing, turn order and ties, target choice and ties, max-rounds tiebreak and draw.
- **Determinism property test (fast-check):** for random combatants, seeds and action sequences, `replayCombat` reproduces the same log and `logHash`; the engine never produces negative HP, never lets a downed combatant act, and always ends within `maxRounds`.
- **Golden test:** a fixed seed and lineup produce a stored, committed log (catches accidental rule changes; update it only with an ADR).
- Session flow with the fake gateway: start, choices, timeout default, resolution, `combat.resolved` emitted once, restart recovery mid-round.
- `raid_strike` resolves in one round with no buttons.
- Rate limiter windows, violations → one flag per hour, staff bypass.
- XP anomaly and new-account flags.
- Report grouping, staff-only buttons, action logging, DM fallback.

## Sentinel ADRs

- 0018 Combat is a pure function of seed + combatants + recorded actions (replayable).
- 0019 mulberry32 PRNG and a fixed dice-consumption order.
- 0020 Sentinel flags, staff decide (no automatic punishment).
- 0021 DB-backed rate limiter shared by all bots.

## Definition of done

- `/treino` runs a full fight in a thread with buttons, timeouts and a final log, and `/sentinel replay` confirms ✅ for it.
- A `combat.requested` from another bot (tested with a fake requester) produces exactly one `combat.resolved`.
- Restarting the bot mid-round resumes the fight with the same outcome.
- Rate limits apply to every bot's commands, and repeated violations show up in the mod queue.
- `/denunciar` and "Denunciar mensagem" create reports that staff can act on, and every action is logged.
- `pnpm test` green on SQLite and Postgres, docs (combat rules in `docs/COMBAT.md` with the formulas above), example config and CHANGELOG updated.
