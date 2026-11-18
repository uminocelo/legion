# 0009. Onboarding state stored in the DB as a state machine

**Status:** Accepted. Updated by [ADR 0031](0031-hero-origins.md): the faction step became an origin step (`origin_chosen`) in v0.9.

## Context
Members click old buttons, double-click, leave mid-flow, and the bot restarts.

## Decision
`members.onboarding_step` (`joined → rules_accepted → faction_chosen → registered`) is the only source of truth. A pure `transition()` decides each action: repeats are no-ops, out-of-order actions show the current step's screen. The chosen archetype is stored before the modal opens so a restart can reopen it. Registration runs in one transaction that re-reads the member, inserts the mutant and emits `player.created`; roles are applied after commit and reconciled by a retry job if Discord fails.

## Consequences
- Resumable, idempotent onboarding; no double registration.
- Discord can't prefill modals, so a member who hits a validation error retypes the sheet.

## Alternatives considered
- In-memory sessions: lost on restart.
