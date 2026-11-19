import { z } from 'zod';
import { BOT_IDS } from '../config/schema.js';

const id = z.string().min(1);
const botId = z.enum(BOT_IDS);
const isoDate = z.string().datetime({ offset: true });
const rank = z.enum(['recruta', 'agente', 'veterano']);

export const combatantSchema = z.object({
  id,
  side: z.enum(['players', 'enemies']),
  kind: z.enum(['player', 'enemy', 'dummy']),
  refId: id,
  name: z.string().min(1).max(100),
  archetype: z.string().nullable(),
  level: z.number().int().min(1),
  stats: z.object({
    hp: z.number().int(),
    atk: z.number().int(),
    def: z.number().int(),
    spd: z.number().int(),
    foc: z.number().int(),
  }),
  powerCooldown: z.number().int().min(0),
});
export type Combatant = z.infer<typeof combatantSchema>;

/** Every event and its payload (main prompt §6.2). Add events here first, then in docs/EVENTS.md. */
export const eventCatalog = {
  'member.joined': z.object({ discordUserId: id, accountCreatedAt: isoDate, isRejoin: z.boolean() }),
  'player.created': z.object({
    memberId: id,
    discordUserId: id,
    mutantId: id,
    codename: z.string().min(1),
    archetype: z.string().min(1),
    faction: z.string().min(1),
    originType: z.string().min(1),
  }),
  'player.rejoined': z.object({ memberId: id, discordUserId: id }),
  /** A hero switched team (staff move or recruitment arc). Not emitted at registration. */
  'player.faction_changed': z.object({
    memberId: id,
    discordUserId: id,
    from: z.string().min(1).nullable(),
    to: z.string().min(1),
    reason: z.enum(['onboarding', 'arc', 'staff']),
    sourceKey: z.string().min(1).max(200),
  }),
  /**
   * J.A.R.V.I.S. asks Cérebro to put a hero on a team at a `success` ending of a recruitment campaign
   * (ADR 0032, D12). Cérebro decides; `sourceKey` = `arc:<runId>:<memberId>` makes it idempotent.
   */
  'faction.join_requested': z.object({
    memberId: id,
    faction: z.string().min(1),
    sourceKey: z.string().min(1).max(200),
  }),
  /** Cérebro refused a join request. `availableAt` (ISO) tells when a `cooldown` ends. */
  'player.faction_change_refused': z.object({
    memberId: id,
    faction: z.string().min(1),
    sourceKey: z.string().min(1).max(200),
    code: z.enum(['cooldown', 'origin', 'disabled', 'same']),
    availableAt: z.string().datetime().optional(),
  }),
  'player.optins_changed': z.object({ memberId: id, optIns: z.array(z.string()) }),
  'command.executed': z.object({
    discordUserId: id,
    memberId: id.nullable(),
    bot: botId,
    command: z.string().min(1),
    subcommand: z.string().nullable(),
  }),
  'xp.grant_requested': z.object({
    memberId: id,
    amount: z.number().int().min(1).max(1000),
    reason: z.string().min(1),
    sourceEventId: id,
  }),
  'xp.awarded': z.object({
    memberId: id,
    amount: z.number().int(),
    reason: z.string().min(1),
    totalXp: z.number().int(),
    level: z.number().int().min(1),
    sourceKey: id,
  }),
  'level.changed': z.object({ memberId: id, from: z.number().int().min(1), to: z.number().int().min(1) }),
  'rank.changed': z.object({ memberId: id, discordUserId: id, from: rank, to: rank }),
  'trivia.answered': z.object({
    memberId: id,
    attemptId: id,
    questionId: id,
    correct: z.boolean(),
    msToAnswer: z.number().int().min(0),
  }),
  'streak.updated': z.object({
    memberId: id,
    streak: z.number().int().min(0),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  'quest.completed': z.object({
    memberId: id,
    questId: id,
    step: z.number().int().min(0),
    chainCompleted: z.boolean(),
  }),
  'mission.started': z.object({
    missionId: id,
    missionType: z.enum(['text', 'combat']),
    memberIds: z.array(id).min(1),
    partyLevel: z.number().int().min(1),
    difficulty: z.enum(['facil', 'normal', 'dificil']),
    channelId: id,
  }),
  /** `missionId` is the mission's content id (e.g. `primeiro-contato-1`); `runId` the run (v0.9). */
  'mission.completed': z.object({
    missionId: id,
    runId: id,
    memberIds: z.array(id),
    outcome: z.enum(['success', 'failure', 'abandoned']),
  }),
  'combat.requested': z.object({
    combatId: id,
    requestedBy: botId,
    mode: z.enum(['duel', 'party', 'raid_strike', 'training']),
    missionId: id.nullable(),
    raidId: id.nullable(),
    channelId: id,
    participants: z.array(combatantSchema).min(2),
    maxRounds: z.number().int().min(1),
  }),
  'combat.resolved': z.object({
    combatId: id,
    requestedBy: botId,
    mode: z.enum(['duel', 'party', 'raid_strike', 'training']),
    missionId: id.nullable(),
    raidId: id.nullable(),
    seed: z.number().int().min(0).max(4294967295),
    winnerSide: z.enum(['players', 'enemies']).nullable(),
    rounds: z.number().int().min(0),
    damageBySide: z.object({ players: z.number().int().min(0), enemies: z.number().int().min(0) }),
    survivors: z.array(id),
    logHash: z.string().min(1),
  }),
  'world.event': z.object({
    worldEventId: id,
    kind: z.enum(['invasion', 'raid', 'announcement']),
    phase: z.enum(['announced', 'started', 'ended']),
    title: z.string().min(1),
    startsAt: isoDate,
    endsAt: isoDate.nullable(),
    outcome: z.enum(['victory', 'defeat']).nullable(),
    participantMemberIds: z.array(id),
    /** Current wave and total waves (US-19); clearing a wave emits nothing new. */
    wave: z.number().int().min(1).optional(),
    waves: z.number().int().min(1).optional(),
  }),
  /** Faction war closed. J.A.R.V.I.S. pays `winnerMemberIds` once each (US-18, D19, D26). */
  'war.ended': z.object({
    warId: id,
    startsAt: isoDate,
    endsAt: isoDate,
    winners: z.array(z.string().min(1)),
    scores: z.array(
      z.object({
        faction: z.string().min(1),
        points: z.number().int(),
        members: z.number().int().min(0),
      }),
    ),
    winnerMemberIds: z.array(id),
  }),
  'report.flagged': z.object({
    reportId: id,
    reporter: z.union([botId, z.literal('member')]),
    reporterDiscordUserId: id.nullable(),
    subjectDiscordUserId: id,
    reason: z.enum([
      'spam',
      'rate_limit',
      'canon_name_attempts',
      'xp_anomaly',
      'new_account',
      'user_report',
      'other',
    ]),
    severity: z.enum(['low', 'medium', 'high']),
    details: z.string().max(500),
    refs: z.record(z.string(), z.string()),
  }),
} as const;

export type EventType = keyof typeof eventCatalog;
export type EventPayloads = { [K in EventType]: z.infer<(typeof eventCatalog)[K]> };
export type EventSource = (typeof BOT_IDS)[number] | 'core';

export interface LegionEvent<T extends EventType = EventType> {
  id: string;
  type: T;
  version: 1;
  guildId: string;
  occurredAt: string;
  source: EventSource;
  payload: EventPayloads[T];
}

export const EVENT_TYPES = Object.keys(eventCatalog) as EventType[];

export function isEventType(value: string): value is EventType {
  return Object.hasOwn(eventCatalog, value);
}

/** Validates a payload; throws on unknown types or invalid payloads (programming errors). */
export function validatePayload<T extends EventType>(type: T, payload: unknown): EventPayloads[T] {
  if (!isEventType(type)) throw new Error(`Unknown event type "${type}"`);
  const res = eventCatalog[type].safeParse(payload);
  if (!res.success) throw new Error(`Invalid payload for "${type}": ${z.prettifyError(res.error)}`);
  return res.data as EventPayloads[T];
}
