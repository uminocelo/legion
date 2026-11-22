import {
  bigint,
  index,
  integer,
  primaryKey,
  doublePrecision as real,
  pgTable as table,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ULTRON owns these tables. Numbers and outcomes live here; flavor text never does.

export const ultronEnemyTemplates = table('ultron_enemy_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tier: text('tier').notNull(),
  minLevel: integer('min_level').notNull(),
  /** JSON { hp, atk, def, spd, foc } */
  base: text('base').notNull(),
  powerCooldownMax: integer('power_cooldown_max').notNull(),
  /** JSON string[] */
  tauntKeys: text('taunt_keys').notNull(),
  contentHash: text('content_hash').notNull(),
  active: integer('active').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
  // file | staff (imported in Discord; file reloads never touch it)
  origin: text('origin').notNull().default('file'),
  importedBy: text('imported_by'),
  // Staff turned it off: stays off across reloads.
  disabledBy: text('disabled_by'),
});

export const ultronEncounters = table(
  'ultron_encounters',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    missionId: text('mission_id'),
    combatId: text('combat_id').notNull(),
    seed: bigint('seed', { mode: 'number' }).notNull(),
    partyLevel: integer('party_level').notNull(),
    partySize: integer('party_size').notNull(),
    difficulty: text('difficulty').notNull(),
    adaptiveMultiplier: real('adaptive_multiplier').notNull(),
    /** JSON Combatant[] (enemies as sent to Sentinel) */
    enemies: text('enemies').notNull(),
    /** players | enemies | draw */
    outcome: text('outcome'),
    requestedByUserId: text('requested_by_user_id'),
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at'),
  },
  (t) => [
    uniqueIndex('ultron_encounters_mission_uq').on(t.missionId),
    uniqueIndex('ultron_encounters_combat_uq').on(t.combatId),
  ],
);

export const ultronWorldEvents = table(
  'ultron_world_events',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    kind: text('kind').notNull(),
    templateId: text('template_id').notNull(),
    /** scheduled | announced | active | ended | cancelled */
    status: text('status').notNull(),
    /** 'cron' or the staff member's Discord id */
    scheduledBy: text('scheduled_by').notNull(),
    announceAt: text('announce_at').notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    maxHp: integer('max_hp'),
    hp: integer('hp'),
    bossLevel: integer('boss_level'),
    difficulty: text('difficulty').notNull(),
    /** victory | defeat */
    outcome: text('outcome'),
    channelId: text('channel_id'),
    announceMessageId: text('announce_message_id'),
    messageId: text('message_id'),
    threadId: text('thread_id'),
    resultsMessageId: text('results_message_id'),
    /** Last time the HP embed was edited (throttle). */
    embedEditedAt: text('embed_edited_at'),
    /** v1.0 waves (US-19 uses them; default 1 so existing events stay one wave). */
    waves: integer('waves').notNull().default(1),
    wave: integer('wave').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('ultron_world_events_kind_start_uq').on(t.guildId, t.kind, t.startsAt),
    index('ultron_world_events_status_idx').on(t.status),
  ],
);

export const ultronEventParticipants = table(
  'ultron_event_participants',
  {
    worldEventId: text('world_event_id').notNull(),
    memberId: text('member_id').notNull(),
    faction: text('faction'),
    damage: integer('damage').notNull().default(0),
    strikes: integer('strikes').notNull().default(0),
    knockouts: integer('knockouts').notNull().default(0),
    nextStrikeAt: text('next_strike_at').notNull(),
    joinedAt: text('joined_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.worldEventId, t.memberId] })],
);

export const ultronStrikes = table(
  'ultron_strikes',
  {
    combatId: text('combat_id').primaryKey(),
    worldEventId: text('world_event_id').notNull(),
    memberId: text('member_id').notNull(),
    damage: integer('damage'),
    appliedAt: text('applied_at'),
    /** Wave the strike landed on (US-19). */
    wave: integer('wave').notNull().default(1),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('ultron_strikes_event_idx').on(t.worldEventId)],
);

/** One row per wave of a world event (US-19). */
export const ultronEventWaves = table(
  'ultron_event_waves',
  {
    worldEventId: text('world_event_id').notNull(),
    wave: integer('wave').notNull(),
    maxHp: integer('max_hp').notNull(),
    bossLevel: integer('boss_level').notNull(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    /** cleared | failed */
    outcome: text('outcome'),
  },
  (t) => [primaryKey({ columns: [t.worldEventId, t.wave] })],
);

/** Faction war (US-18). Points stay with the faction stored on each row. */
export const ultronWars = table(
  'ultron_wars',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    /** scheduled | active | ended | cancelled */
    status: text('status').notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    /** JSON string[] of winning faction keys; null until the war ends. */
    winners: text('winners'),
    resultMessageId: text('result_message_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('ultron_wars_start_uq').on(t.guildId, t.startsAt),
    index('ultron_wars_status_idx').on(t.status),
  ],
);

export const ultronWarPoints = table(
  'ultron_war_points',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    warId: text('war_id').notNull(),
    memberId: text('member_id').notNull(),
    /** Faction at the moment the points were scored. */
    faction: text('faction').notNull(),
    /** Active squad at score time (US-36). Stays after the member leaves the squad. */
    squadId: text('squad_id'),
    points: integer('points').notNull(),
    /** mission | strike | participation | staff */
    reason: text('reason').notNull(),
    sourceKey: text('source_key').notNull(),
    createdBy: text('created_by'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('ultron_war_points_source_uq').on(t.sourceKey),
    index('ultron_war_points_faction_idx').on(t.warId, t.faction),
    index('ultron_war_points_member_idx').on(t.warId, t.memberId),
    index('ultron_war_points_squad_idx').on(t.warId, t.squadId),
  ],
);

/** Guild threat meter (US-19). */
export const ultronThreat = table('ultron_threat', {
  guildId: text('guild_id').primaryKey(),
  level: integer('level').notNull().default(0),
  lastTickDay: text('last_tick_day'),
  updatedAt: text('updated_at').notNull(),
});

export const ultronFactionDamage = table(
  'ultron_faction_damage',
  {
    worldEventId: text('world_event_id').notNull(),
    faction: text('faction').notNull(),
    damage: integer('damage').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.worldEventId, t.faction] })],
);

export const ultronFlavorLog = table(
  'ultron_flavor_log',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    provider: text('provider').notNull(),
    ok: integer('ok').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('ultron_flavor_log_created_idx').on(t.createdAt)],
);
