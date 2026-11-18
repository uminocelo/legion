# 0032. Campaigns and team joins

**Status:** Accepted (v0.9). Campaigns ship with US-27; joining a team at the end of a recruitment arc ships with US-28. Builds on [ADR 0031](0031-hero-origins.md) (origins and teams).

## Context
Missions were loose one-shots: a member picked any mission their level allowed. v0.9 needs stories told in chapters (the tutorial, story arcs) and a way to join a team by playing its recruitment arc instead of picking it on day one. Teams belong to Cérebro (`members.faction`, roles, the audit table from US-26); missions belong to J.A.R.V.I.S.

## Decision
- **Campaigns are metadata files.** `content/campaigns/<id>.yaml` (and `./data/content/campaigns/`, which overrides by id) holds `id`, `kind` (`tutorial | recruitment | story`), `faction` (recruitment only), `title`, `summary`. Missions point to them with `campaign: { id, chapter }`, and say what they need with `requires: { missions, level, origins, factions }`. Stored in `jarvis_campaigns` (mirrors `jarvis_missions`: files or staff imports) and three new `jarvis_missions` columns (`campaign_id`, `chapter`, `requires`).
- **One pure checker** (`checkCampaignContent`, `unmet`) runs in the bot, the import and the website editor: unknown campaign, repeated chapter, unknown mission in `requires`, cycles, `joinFaction` outside a recruitment campaign for that team or naming a disabled team.
- **D13 — Progress is derived from runs.** A chapter is done when the member was in a run of that mission that ended in `success`. No progress table.
- **Requirements in play:** locked missions are hidden from `/missao iniciar` autocomplete; a typed id says what is missing; in a party every member must meet them (they may join, the lobby lists who is missing what, and the leader cannot start). A recruitment arc is hidden from members of its team and from everyone when the team is off.
- **D12 — J.A.R.V.I.S. requests, Cérebro decides.** At a `success` ending of a recruitment campaign with `reward.joinFaction`, J.A.R.V.I.S. emits one `faction.join_requested` per member (`sourceKey: arc:<runId>:<memberId>`) in the same transaction as the XP. Cérebro alone checks enabled team, origin, same team and cooldown, then writes the audit row, `members.faction` and `faction_changed_at` and emits `player.faction_changed`, or emits `player.faction_change_refused` with a code (`availableAt` for `cooldown`). A repeated `sourceKey` is a no-op; a member who left is ignored. J.A.R.V.I.S. never writes teams; it posts the result in the mission thread. A recruitment arc also follows its team's `origins` rule, so it stays locked for other origins.

## Consequences
Stories can be split into chapters and unlocked in order without new state to keep in sync: replays, imports and restarts cannot desync progress. Staff can ship a whole campaign in one file (`/jarvis campanha importar`, all or nothing; shipped ids refused). A file with a `requires` pointing to a mission that does not exist yet still loads, locked, so a server can add chapters later (doctor ⚠️).

## Alternatives considered
- A progress table per member and campaign: a second source of truth that can drift from runs (refunds, recalculation, imports). (D13)
- J.A.R.V.I.S. writing `members.faction` when an arc ends: two owners for teams, roles and audit. (D12)
- Requirements only on the leader: a group could carry a member through a chapter they cannot reach alone.
