# 0025. World events use a shared-HP threat resolved through `raid_strike` fights in Sentinel

**Status:** Accepted

## Context
Invasions and raids need many members to hit one threat over an hour without ULTRON resolving combat itself, and must survive restarts.

## Decision
The event row holds the shared HP. Each "Atacar" click creates a strike (new combat id) and emits `combat.requested` with `mode: raid_strike` and a boss snapshot (HP capped at 5000). The `ultron.raid-result` consumer applies `damageBySide.players` once per combat id in one transaction (HP floor 0, participant and faction damage, doubled cooldown on knockout). Announce, start and end are scheduler jobs with dedupe keys; every phase is a conditional status change plus the `world.event` emit in one transaction, and each message id is stored so a retried job never posts again.

## Consequences
Restarts at any phase resume once. Strikes that resolve after the end are recorded but do not change the outcome. The HP embed is edited at most every 10 s.

## Alternatives considered
One long multi-player combat: holds a thread for an hour and blocks late joiners. Damage computed by ULTRON: duplicates Sentinel's rules.
