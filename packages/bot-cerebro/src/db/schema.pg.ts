import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const members = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    discordUserId: text('discord_user_id').notNull(),
    onboardingStep: text('onboarding_step').notNull(),
    rulesAcceptedAt: text('rules_accepted_at'),
    faction: text('faction'),
    pendingArchetype: text('pending_archetype'),
    /** JSON { main, secondary[] } while picking powers (registration or /mutante poderes). */
    pendingPowers: text('pending_powers'),
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

export const mutants = pgTable(
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
    origin: text('origin').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('mutants_member_unique').on(t.memberId),
    uniqueIndex('mutants_guild_codename_unique').on(t.guildId, t.codenameNormalized),
  ],
);

export const cerebroCanonAttempts = pgTable(
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
export const cerebroMutantPowers = pgTable(
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
