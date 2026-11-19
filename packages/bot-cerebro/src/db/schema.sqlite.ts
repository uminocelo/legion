import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    discordUserId: text('discord_user_id').notNull(),
    onboardingStep: text('onboarding_step').notNull(),
    rulesAcceptedAt: text('rules_accepted_at'),
    faction: text('faction'),
    pendingArchetype: text('pending_archetype'),
    /** Origin key picked during registration, until the hero is saved. */
    pendingOrigin: text('pending_origin'),
    /** JSON { main, secondary[] } while picking powers (registration or /heroi poderes). */
    pendingPowers: text('pending_powers'),
    /** Last team switch (arc or staff); null = never switched. Registration is not a switch. */
    factionChangedAt: text('faction_changed_at'),
    rank: text('rank').notNull().default('recruta'),
    optIns: text('opt_ins').notNull().default('[]'),
    leftAt: text('left_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('members_guild_user_unique').on(t.guildId, t.discordUserId),
    index('members_guild_step_idx').on(t.guildId, t.onboardingStep),
  ],
);

export const mutants = sqliteTable(
  'mutants',
  {
    id: text('id').primaryKey(),
    // References members.id; no DB-level FK so Postgres schemas stay portable (search_path).
    memberId: text('member_id').notNull(),
    guildId: text('guild_id').notNull(),
    codename: text('codename').notNull(),
    codenameNormalized: text('codename_normalized').notNull(),
    power: text('power').notNull(),
    archetype: text('archetype').notNull(),
    /** Free-text backstory, shown as "História". */
    origin: text('origin').notNull(),
    /** Origin category (`cerebro.origins` key). */
    originType: text('origin_type').notNull().default('mutante'),
    /** 1 = may change origin once with `/heroi origem` (heroes created before v0.9). */
    originRechoice: integer('origin_rechoice').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('mutants_member_unique').on(t.memberId),
    uniqueIndex('mutants_guild_codename_unique').on(t.guildId, t.codenameNormalized),
  ],
);

export const cerebroCanonAttempts = sqliteTable(
  'cerebro_canon_attempts',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id').notNull(),
    attemptedName: text('attempted_name').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('cerebro_canon_attempts_member_idx').on(t.memberId, t.createdAt)],
);

/** Catalog powers of a mutant (US-11). One main, up to two secondary; no numeric effect. */
export const cerebroMutantPowers = sqliteTable(
  'cerebro_mutant_powers',
  {
    id: text('id').primaryKey(),
    mutantId: text('mutant_id').notNull(),
    powerId: text('power_id').notNull(),
    // main | secondary
    slot: text('slot').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('cerebro_mutant_powers_unique').on(t.mutantId, t.powerId)],
);

/**
 * Every faction change, append-only (US-26). `source_key` makes a change idempotent
 * (`onboarding:<memberId>`, `staff:<interactionId>`, later `arc:<runId>`). Wars (v1.0) read past
 * membership from here.
 */
export const cerebroFactionChanges = sqliteTable(
  'cerebro_faction_changes',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    memberId: text('member_id').notNull(),
    fromFaction: text('from_faction'),
    toFaction: text('to_faction').notNull(),
    // onboarding | arc | staff
    reason: text('reason').notNull(),
    sourceKey: text('source_key').notNull(),
    /** Staff Discord id for `staff`, else null. */
    byDiscordUserId: text('by_discord_user_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('cerebro_faction_changes_source_unique').on(t.guildId, t.sourceKey),
    index('cerebro_faction_changes_member_idx').on(t.memberId, t.createdAt),
  ],
);
