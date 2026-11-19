# 0029. Gear bonus: a core read model and a cap on the total

**Status:** Accepted (v0.10, US-15)

## Context
J.A.R.V.I.S. v2 adds items in three slots (traje, acessório, dispositivo). Equipped items give a small stat bonus. Player stats are built in four places owned by three bots: Sentinel training, ULTRON mission encounters and world-event strikes, and the Cérebro sheet. Bots never import each other (ADR 0001), and Sentinel must stay a pure fight engine that knows nothing about items. Three slots that each add +2 could also stack into a bonus that breaks the balance of the shipped enemies.

## Decision
- **Core owns the rule.** `playerStats(archetype, level, bonus, cap)` in `@legion/core` adds the bonus to `computePlayerStats` and clamps each stat of the **total** bonus to `0..cap` (hp `0..cap × 8`). Every caller uses it, so the sheet shows exactly what fights use.
- **J.A.R.V.I.S. provides `gear`** through the read-model registry: `bonusOf(memberId)` (raw sum of the active equipped items, not capped), `equippedOf(memberId)` and `statCap()` (`jarvis.economy.gear.statCap`, default 2). `statCap()` is on the read model because the cap is J.A.R.V.I.S. config and the other bots cannot read it.
- **Without J.A.R.V.I.S.** core's default read model returns a zero bonus, `[]` and the default cap, so fights are exactly as in v0.8.1.
- **The bonus is part of the `combat.requested` snapshot.** Equipping during a fight changes nothing until the next fight, and replays stay deterministic.
- **`statCap: 0`** turns gear into cosmetics on that server: items can still be owned and equipped, they add nothing.
- The item schema also limits each item (0..2 per stat, hp 0..16), so one item alone can reach the cap but no single file can inflate it.

## Consequences
A level-1 hero with full gear gets at most +2 atk/def/spd/foc and +16 hp, about two levels' worth of hp and one or two of the other stats; shipped enemies stay fair. Servers that want stronger gear raise `statCap`; servers that want none set 0. A new place that builds player stats must call `playerStats` with `ctx.read.gear`, or it ignores gear.

## Alternatives considered
Item bonuses inside Sentinel: Sentinel would need items and J.A.R.V.I.S. data, breaking its independence (D2). A per-item cap only: three slots stack to +6 per stat (D5). Passing the bonus through events: every request would need J.A.R.V.I.S. to answer first; a read model is simpler and already used for levels.
