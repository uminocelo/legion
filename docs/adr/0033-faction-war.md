# 0033. Faction war

**Status:** Accepted (v1.0, US-18). Builds on [ADR 0025](0025-shared-hp-world-events.md) (ULTRON owns world events) and [ADR 0028](0028-credits-ledger.md) (J.A.R.V.I.S. owns the wallet).

## Context

Missions, raids and invasions already name a hero's faction, but nothing lasts across them. A faction war needs a score that survives a team switch, a public result, and a payout. Two owners of the same points, or ULTRON writing credits, would split the ledger that ADR 0028 keeps in one place.

## Decision

- **D17 — ULTRON owns the war.** It already owns world events and per-faction damage. The calendar, the points ledger, `/guerra`, `/ultron guerra iniciar|encerrar|pontos`, the result post and `war.ended` live in ULTRON. J.A.R.V.I.S. does not score. A new bot was rejected.
- **D18 — The ledger stores the faction at scoring time.** Each row in `ultron_war_points` has `faction`, `points` (not zero), `reason` (`mission`, `strike`, `participation`, `staff`) and a unique `source_key` (`war:mission:<runId>:<memberId>`, `war:strike:<combatId>`, `war:event:<eventId>:<memberId>`, `war:staff:<interactionId>`). A switch leaves old points where they were. The score is not the sum of whoever is on the team today. Independente (`independent`) never scores. A member who left stops scoring and keeps what they already earned.
- **D19 — Winners are paid through `war.ended`.** The end transitions `active → ended` once and emits in the same transaction: `{ warId, startsAt, endsAt, winners, scores, winnerMemberIds }`. The consumer `jarvis.war-credits` pays `jarvis.economy.war.winner` (default 50) once per member (`war:<warId>:<memberId>`), reason `war`. ULTRON never writes the wallet. Economy off or J.A.R.V.I.S. off: the war still runs and posts, and nobody is paid. A member who left is skipped.
- **D26 — A tie pays every tied faction.** The winner is the top total among factions with points above zero, not a per-member average. Every faction on that total wins and is paid. Nobody scored: no winner and no payout.

Staff start pulls a scheduled war forward or opens one immediately. Staff points are −1000..1000, not zero, on the hero's current faction, with `created_by` and a note. `legion doctor` shows the war state. `legion playtest-report` lists points by faction and reason, lists staff adjustments, and flags an unknown faction or a repeated source key.

## Consequences

One war per guild. A month-long war starts on the 1st in the server timezone; a length in days (7–90) starts at the previous end. Restarting during the end closes the war once and posts once. The next war is planned after the result. `/mutante` is removed in this story; `/heroi` is the only sheet command.

## Alternatives considered

J.A.R.V.I.S. or a new bot owning the war: another writer of faction data that ULTRON already has. Summing live `members.faction`: a switch would rewrite history. ULTRON crediting the wallet: a second owner of credits. Tie-breakers or per-member averages: they hide a shared result the war is there to show.
