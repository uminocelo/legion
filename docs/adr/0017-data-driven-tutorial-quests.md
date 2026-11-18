# 0017. Tutorial quests are data-driven with event triggers

**Status:** Accepted

## Context
The tutorial must adapt to which bots are enabled (no trivia step without J.A.R.V.I.S., no mission step before missions exist) and server owners should be able to change it without code.

## Decision
The chain lives in `tutorial.yaml` (overridable in `./data/content/`), validated with zod. Each step names a catalog event and exact `where` fields; a pure engine resolves `requiresBot`/`requiresFeature` into the step or its `fallback`, and only the current step's trigger counts. Completing a step is one transaction: `herbie_tutorial_steps_done` (unique per member and step), progress, `quest.completed`, and `xp.grant_requested` keyed by the triggering event id. The current step is derived from the steps done, so edits to the file re-route members on their next trigger. An invalid file keeps the previous chain.

## Update (v0.9)
The bundled chain is now `primeiro-contato`, which follows the tutorial campaign of the same name. Two features (`missions`, `mission-combat`) and two optional chain texts (`intro`, `completion`, each with `requiresBot` and a fallback) were added. Progress of the old `boas-vindas` chain is renamed once at startup, keeping status and steps. See `docs/TUTORIAL.md`.

## Consequences
- New steps need no code if their event exists in the catalog.
- Doing a later step early does not count; the step text tells members what to do.

## Alternatives considered
- Hard-coded steps: simple, but every change is a release. A rules engine with conditions: more power than the tutorial needs.
