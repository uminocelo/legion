# 0030. Canon names: identities are original, narrative can visit the Marvel universe

**Status:** Accepted (supersedes the mission part of the original-characters rule in `00-main.md §13`)

## Context
Legion grows from an X-Men setting to the wider Marvel universe: adventures with the Avengers, the Fantastic Four, the Guardians and more. Until v0.8 the canon filter also checked mission titles and choice labels, so "Capitão América convoca você" was refused. At the same time the blocklist only knew X-Men names, so "Homem de Ferro" was accepted as a player codename.

## Decision
- **Identities stay original.** The filter (`isCanonName`) runs on player codenames, power names, enemy names (including bosses), item names and AI flavor text. A canon villain is never an enemy; fights use original henchmen *a serviço de* a villain.
- **Narrative is free.** Mission titles, scene text, choice labels, campaign titles and summaries, and trivia can name canon heroes, teams, villains and places (NPCs, quest-givers, settings).
- **Ids are not filtered.** They are not shown to players and arc ids name their team (`recrutamento-vingadores`).
- **The blocklist covers the wider universe** (Avengers, Fantastic Four, Guardians, Defenders, Thunderbolts, Midnight Sons, S.H.I.E.L.D., Inhumans, major villains, team names), PT and EN. Names that are also common words start with `=` and only match the whole name (`=Nova` refuses "Nova", allows "Estrela Nova").
- Bots and website editors share the same filter and list (the editors inline the file at build time).

## Consequences
Staff can write Marvel adventures without workarounds; players and enemies remain original creations, which keeps the fan project's exposure small. Codenames that used to pass may now be refused when they equal or contain a canon name; existing characters are not renamed. A test checks that nothing Legion ships is refused by the larger list.

## Alternatives considered
Keep filtering narrative: blocks the Marvel adventures the community asked for. Allow canon identities: players or enemies "being" Marvel characters, which the project has always avoided. A separate allowlist of NPC names: more upkeep for the same result as not filtering narrative.
