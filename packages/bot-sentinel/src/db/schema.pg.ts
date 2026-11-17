import { bigint, index, integer, primaryKey, pgTable as table, text } from 'drizzle-orm/pg-core';

// Combat: everything needed to replay a fight lives here (seed + combatants at start + inputs per round).

export const sentinelCombats = table(
  'sentinel_combats',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    requestedBy: text('requested_by').notNull(),
    mode: text('mode').notNull(),
    missionId: text('mission_id'),
    raidId: text('raid_id'),
    channelId: text('channel_id').notNull(),
    threadId: text('thread_id'),
    /** Message with the current round prompt (edited when the round resolves). */
    promptMessageId: text('prompt_message_id'),
    seed: bigint('seed', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('active'),
    round: integer('round').notNull().default(0),
    maxRounds: integer('max_rounds').notNull(),
    winnerSide: text('winner_side'),
    logHash: text('log_hash'),
    createdAt: text('created_at').notNull(),
    finishedAt: text('finished_at'),
  },
  (t) => [index('sentinel_combats_status_idx').on(t.status)],
);

export const sentinelCombatants = table(
  'sentinel_combatants',
  {
    id: text('id').notNull(),
    combatId: text('combat_id').notNull(),
    side: text('side').notNull(),
    kind: text('kind').notNull(),
    /** Member id for players; requester's id for enemies. */
    refId: text('ref_id').notNull(),
    name: text('name').notNull(),
    archetype: text('archetype'),
    level: integer('level').notNull(),
    maxHp: integer('max_hp').notNull(),
    hp: integer('hp').notNull(),
    atk: integer('atk').notNull(),
    def: integer('def').notNull(),
    spd: integer('spd').notNull(),
    foc: integer('foc').notNull(),
    powerCooldownMax: integer('power_cooldown_max').notNull(),
    powerCooldown: integer('power_cooldown').notNull(),
    /** Cooldown at the start of the fight (replay input). */
    startPowerCooldown: integer('start_power_cooldown').notNull(),
    downedAtRound: integer('downed_at_round'),
  },
  (t) => [primaryKey({ columns: [t.combatId, t.id] }), index('sentinel_combatants_ref_idx').on(t.refId)],
);

export const sentinelCombatRounds = table(
  'sentinel_combat_rounds',
  {
    combatId: text('combat_id').notNull(),
    round: integer('round').notNull(),
    /** JSON combatantId → effective action. */
    actions: text('actions').notNull(),
    /** 1 when no player chose anything (counts toward abandonment). */
    idle: integer('idle').notNull().default(0),
    log: text('log').notNull(),
    resolvedAt: text('resolved_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.combatId, t.round] })],
);

export const sentinelPendingActions = table(
  'sentinel_pending_actions',
  {
    combatId: text('combat_id').notNull(),
    round: integer('round').notNull(),
    combatantId: text('combatant_id').notNull(),
    action: text('action').notNull(),
    chosenAt: text('chosen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.combatId, t.round, t.combatantId] })],
);
