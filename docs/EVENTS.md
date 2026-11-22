# Eventos

Catálogo dos eventos do bus (versão 1 de cada payload). A fonte da verdade é `packages/core/src/events/catalog.ts`; um teste falha se algum evento do catálogo não estiver nesta página.

Envelope: `{ id (ULID), type, version: 1, guildId, occurredAt (ISO UTC), source: BotId | 'core', payload }`.

Entrega: gravado na transação de quem emite (outbox), entregue após o commit, *at-least-once* — todo consumidor precisa ser idempotente. Falhas: 1 tentativa + 5 re-tentativas (1s, 5s, 30s, 2m, 10m), depois `failed`. Eventos não consumidos dos últimos `events.replayLookbackDays` dias são reprocessados no boot.

`memberId` é o ULID de `members.id`; `discordUserId` é o snowflake do Discord.

| Event | Emitted by | Consumed by | Payload |
|---|---|---|---|
| `member.joined` | Cérebro | Sentinel (account-age check, v3) | `{ discordUserId, accountCreatedAt, isRejoin: boolean }` |
| `player.created` | Cérebro | H.E.R.B.I.E. (start tutorial), J.A.R.V.I.S. (create progress row) | `{ memberId, discordUserId, mutantId, codename, archetype, faction, originType }` (`originType` since v0.9) |
| `player.rejoined` | Cérebro | J.A.R.V.I.S. (optional welcome back) | `{ memberId, discordUserId }` |
| `faction.join_requested` | J.A.R.V.I.S. | Cérebro (`cerebro.faction-join`) | `{ memberId, faction, sourceKey }` (v0.9; one per member at a `success` ending of a recruitment campaign with `reward.joinFaction`; `sourceKey: arc:<runId>:<memberId>`) |
| `player.faction_changed` | Cérebro | J.A.R.V.I.S. (`jarvis.faction-result`: posts in the mission thread for `reason: 'arc'`) | `{ memberId, discordUserId, from: string \| null, to, reason: 'onboarding' \| 'arc' \| 'staff' \| 'squad', sourceKey }` (v0.9; emitted by `/cerebro equipe mover` with `reason: 'staff'` and by an accepted join request with `reason: 'arc'`; registration only writes the audit row. v1.1 adds `reason: 'squad'` when a member joins a squad's base team, `sourceKey: squad:<squadId>:<memberId>`) |
| `squad.created` | Cérebro | (none yet) | `{ squadId, name, baseFaction, founderDiscordId }` (v1.1; written when `/esquadrao criar` stores a request, before staff approve) |
| `squad.joined` | Cérebro | (none yet) | `{ squadId, discordUserId, via: 'link' \| 'code' \| 'founder' }` (v1.1) |
| `squad.left` | Cérebro | (none yet) | `{ squadId, discordUserId, reason: 'left' \| 'team_switch' \| 'archived' \| 'left_server' }` (v1.1) |
| `player.faction_change_refused` | Cérebro | J.A.R.V.I.S. (`jarvis.faction-result`: posts the reason in the thread) | `{ memberId, faction, sourceKey, code: 'cooldown' \| 'origin' \| 'disabled' \| 'same', availableAt? }` (v0.9; `availableAt` is when a `cooldown` ends) |
| `player.optins_changed` | Cérebro | (none yet) | `{ memberId, optIns: string[] }` |
| `command.executed` | core router | H.E.R.B.I.E. (tutorial triggers) | `{ discordUserId, memberId: string \| null, bot: BotId, command: string, subcommand: string \| null }` |
| `xp.grant_requested` | any bot | J.A.R.V.I.S. | `{ memberId, amount: number (1–1000), reason: string, sourceEventId: string }` (idempotency key = `sourceEventId` + `reason`) |
| `xp.awarded` | J.A.R.V.I.S. | H.E.R.B.I.E. (hints), Sentinel (anomaly check) | `{ memberId, amount, reason, totalXp, level, sourceKey }` |
| `level.changed` | J.A.R.V.I.S. | H.E.R.B.I.E. | `{ memberId, from: number, to: number }` |
| `rank.changed` | J.A.R.V.I.S. | Cérebro (swap rank roles, update `members.rank`) | `{ memberId, discordUserId, from: 'recruta' \| 'agente' \| 'veterano', to: same }` |
| `trivia.answered` | J.A.R.V.I.S. | H.E.R.B.I.E. (tutorial step) | `{ memberId, attemptId, questionId, correct: boolean, msToAnswer: number }` |
| `streak.updated` | J.A.R.V.I.S. | H.E.R.B.I.E. | `{ memberId, streak: number, day: 'YYYY-MM-DD' }` |
| `quest.completed` | H.E.R.B.I.E. | (J.A.R.V.I.S. gets XP through `xp.grant_requested`) | `{ memberId, questId, step: number, chainCompleted: boolean }` |
| `mission.started` | J.A.R.V.I.S. (v2) | ULTRON (spawn enemies for combat missions) | `{ missionId, missionType: 'text' \| 'combat', memberIds: string[], partyLevel: number, difficulty: 'facil' \| 'normal' \| 'dificil', channelId }` |
| `mission.completed` | J.A.R.V.I.S. (v2) | H.E.R.B.I.E. (tutorial steps, e.g. `where: { missionId: primeiro-contato-1, outcome: success }`), ULTRON (pontos da guerra: sucesso e falha; abandono não pontua) | `{ missionId, runId, memberIds: string[], outcome: 'success' \| 'failure' \| 'abandoned' }` (since v0.9 `missionId` is the mission's id from its file and `runId` the run; before, `missionId` held the run id) |
| `combat.requested` | J.A.R.V.I.S., ULTRON, Sentinel (`/treino`) | Sentinel | `{ combatId, requestedBy: BotId, mode: 'duel' \| 'party' \| 'raid_strike' \| 'training', missionId: string \| null, raidId: string \| null, channelId, participants: Combatant[], maxRounds: number }` |
| `combat.resolved` | Sentinel | J.A.R.V.I.S. (rewards), ULTRON (raid HP, difficulty stats) | `{ combatId, requestedBy, mode, missionId, raidId, seed: number, winnerSide: 'players' \| 'enemies' \| null, rounds: number, damageBySide: { players: number, enemies: number }, survivors: string[], logHash: string }` |
| `world.event` | ULTRON | everyone | `{ worldEventId, kind: 'invasion' \| 'raid' \| 'announcement', phase: 'announced' \| 'started' \| 'ended', title, startsAt, endsAt: string \| null, outcome: 'victory' \| 'defeat' \| null, participantMemberIds: string[] }` |
| `war.ended` | ULTRON | J.A.R.V.I.S. (`jarvis.war-credits`) | `{ warId, startsAt, endsAt, winners: string[], scores: { faction, points, members }[], winnerMemberIds: string[] }` (empate: toda facção empatada no topo ganha; ninguém pontuou: `winners` vazio) |
| `report.flagged` | any bot | Sentinel | `{ reportId, reporter: BotId \| 'member', reporterDiscordUserId: string \| null, subjectDiscordUserId, reason: 'spam' \| 'rate_limit' \| 'canon_name_attempts' \| 'xp_anomaly' \| 'new_account' \| 'user_report' \| 'other', severity: 'low' \| 'medium' \| 'high', details: string (max 500), refs: Record<string, string> }` |

`Combatant` = `{ id, side: 'players' \| 'enemies', kind: 'player' \| 'enemy' \| 'dummy', refId (memberId or enemy instance id), name, archetype: string \| null, level, stats: { hp, atk, def, spd, foc }, powerCooldown: number }`.

## Como adicionar um evento

1. Proponha no `00-main.md` §6.2 (quem emite, quem consome, payload).
2. Adicione o schema zod em `packages/core/src/events/catalog.ts`.
3. Adicione a linha nesta página.
4. Só então emita/consuma no bot. Consumidores usam um `consumerId` estável (`bot.acao`).
