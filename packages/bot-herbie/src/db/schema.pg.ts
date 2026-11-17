import { index, integer, primaryKey, pgTable as table, text } from 'drizzle-orm/pg-core';

// memberId columns point to members.id (owned by Cérebro); no DB-level FK (ADR 0002).

export const herbieTutorialProgress = table(
  'herbie_tutorial_progress',
  {
    memberId: text('member_id').primaryKey(),
    guildId: text('guild_id').notNull(),
    chainId: text('chain_id').notNull(),
    /** Cache of the current step; the source of truth is the steps done + the loaded chain. */
    currentStepId: text('current_step_id'),
    status: text('status').notNull().default('active'),
    deliveryFallback: integer('delivery_fallback').notNull().default(0),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('herbie_tutorial_progress_guild_status_idx').on(t.guildId, t.status)],
);

export const herbieTutorialStepsDone = table(
  'herbie_tutorial_steps_done',
  {
    memberId: text('member_id').notNull(),
    stepId: text('step_id').notNull(),
    triggerEventId: text('trigger_event_id').notNull(),
    xpGranted: integer('xp_granted').notNull().default(0),
    completedAt: text('completed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.stepId] })],
);

export const herbiePreferences = table('herbie_preferences', {
  memberId: text('member_id').primaryKey(),
  locale: text('locale').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const herbieTipLog = table(
  'herbie_tip_log',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    tipId: text('tip_id').notNull(),
    postedAt: text('posted_at').notNull(),
    cycle: integer('cycle').notNull(),
  },
  (t) => [index('herbie_tip_log_guild_cycle_idx').on(t.guildId, t.cycle)],
);

export const herbieWorldEventPosts = table('herbie_world_event_posts', {
  worldEventId: text('world_event_id').primaryKey(),
  messageId: text('message_id'),
  postedAt: text('posted_at').notNull(),
});
