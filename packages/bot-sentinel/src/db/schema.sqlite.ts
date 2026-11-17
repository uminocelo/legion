import { index, integer, primaryKey, sqliteTable as table, text } from 'drizzle-orm/sqlite-core';

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
    seed: integer('seed').notNull(),
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

// Safety: rate limits, flags and the moderation queue.

export const sentinelRateBuckets = table(
  'sentinel_rate_buckets',
  {
    key: text('key').notNull(),
    windowStart: text('window_start').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index('sentinel_rate_buckets_window_idx').on(t.windowStart),
  ],
);

export const sentinelViolations = table(
  'sentinel_violations',
  {
    id: text('id').primaryKey(),
    discordUserId: text('discord_user_id').notNull(),
    policy: text('policy').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('sentinel_violations_user_idx').on(t.discordUserId, t.createdAt)],
);

export const sentinelFlagsSent = table(
  'sentinel_flags_sent',
  {
    subjectDiscordUserId: text('subject_discord_user_id').notNull(),
    reason: text('reason').notNull(),
    hourBucket: text('hour_bucket').notNull(),
  },
  (t) => [primaryKey({ columns: [t.subjectDiscordUserId, t.reason, t.hourBucket] })],
);

export const sentinelReports = table(
  'sentinel_reports',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    subjectDiscordUserId: text('subject_discord_user_id').notNull(),
    reporter: text('reporter').notNull(),
    reporterDiscordUserId: text('reporter_discord_user_id'),
    reason: text('reason').notNull(),
    severity: text('severity').notNull(),
    details: text('details').notNull(),
    refs: text('refs').notNull(),
    count: integer('count').notNull().default(1),
    status: text('status').notNull().default('open'),
    queueMessageId: text('queue_message_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('sentinel_reports_subject_idx').on(t.subjectDiscordUserId, t.reason, t.status),
    index('sentinel_reports_status_idx').on(t.status, t.updatedAt),
  ],
);

export const sentinelModerationActions = table(
  'sentinel_moderation_actions',
  {
    id: text('id').primaryKey(),
    reportId: text('report_id').notNull(),
    staffDiscordUserId: text('staff_discord_user_id').notNull(),
    action: text('action').notNull(),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('sentinel_moderation_actions_report_idx').on(t.reportId)],
);
