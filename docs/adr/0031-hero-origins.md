# 0031. Hero origins (origins and teams, part 1)

**Status:** Accepted (v0.9). Part 2 (teams, joining by recruitment arcs) comes with US-26 and US-28. Updates the onboarding flow of [ADR 0009](0009-onboarding-state-machine.md).

## Context
Until v0.8 every player was a mutant: registration asked for a faction (X-Men, Irmandade, Independente) and the bots said "mutante" everywhere. Legion now covers the wider Marvel universe, and many players want a hero who is not a mutant: an Inhuman, a scientist, someone in armor, a sorcerer, a cosmic hero or a trained fighter. Teams will be joined through play (recruitment arcs), not picked on day one.

## Decision
- **D10 — Origin is a new column.** `mutants.origin_type` (text, default `mutante`) holds the origin key: `mutante`, `inumano`, `ciencia`, `tecnologia`, `mistico`, `cosmico`, `treinado`. The existing `mutants.origin` keeps the player's free-text backstory and is shown as "História". No data is moved or renamed.
- **Origin is identity, not stats.** Combat stats still come from the archetype (main power type) and the level. The origin only filters which powers can be picked: each power may list `origins`; a power without `origins` is open to every origin. An origin with no powers is hidden from registration and is ❌ in `legion doctor`.
- **Registration:** `signal → rules_accepted → origin_chosen → registered`. The faction step is gone; new heroes start on `cerebro.teams.startFaction` (`independent`). Rows left at the old `faction_chosen` step are moved to `rules_accepted` by the migration (and read that way if one slips through); they keep the faction they chose. The old faction menu still answers with the member's current screen.
- **D11 — Internal names stay.** Tables, types and keys (`mutants`, `MutantView`, `cerebro:v1:mutant`, `mutante.*`) keep their names; only player-facing text says "herói". `/heroi` is the command. `/mutante` was an alias until US-18 removed it ([ADR 0033](0033-faction-war.md)). `MutantView` and `player.created` gain `originType`.
- **D15 — One free origin change.** Heroes that existed before the migration get `origin_rechoice = 1` and become Mutante with everything kept. `/heroi origem` lets them pick once: powers that fit stay, otherwise the power picker opens; cancel keeps everything and the flag; finishing (even on Mutante) clears the flag. H.E.R.B.I.E. posts one announcement per server (recorded in `kv`), and `/perfil` and `/heroi` remind the hero while the flag is set. No DMs.

## Consequences
New players choose who they are before they choose a team. Existing servers upgrade without losing anything; each existing hero gets one fair chance to change origin, then it is final. The default role name "Mutante Registrado" stays because roles are matched by name; servers can rename it in Discord and in `roles` together. Servers with their own power files keep working: untagged powers are open to every origin.

## Alternatives considered
- Reuse `mutants.origin` for the category: it holds free text written by players; we would lose it. (D10)
- Rename tables and types to `heroes`: touches every package and migration for no player gain. (D11)
- Everyone stays Mutante, or free origin changes forever: the first is unfair to players who registered before origins existed; the second makes origin meaningless once teams check it. (D15)
- Keep the faction step and add an origin step: two identity choices on day one, and teams would be picked before playing any recruitment arc.
