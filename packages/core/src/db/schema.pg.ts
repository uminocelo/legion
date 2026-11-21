import { index, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

export const coreEventLog = pgTable(
  'core_event_log',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    version: integer('version').notNull(),
    guildId: text('guild_id').notNull(),
    source: text('source').notNull(),
    payload: text('payload').notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (t) => [index('core_event_log_occurred_at_idx').on(t.occurredAt)],
);

export const coreEventConsumption = pgTable(
  'core_event_consumption',
  {
    consumerId: text('consumer_id').notNull(),
    eventId: text('event_id').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.consumerId, t.eventId] })],
);

export const coreScheduledJobs = pgTable(
  'core_scheduled_jobs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    runAt: text('run_at').notNull(),
    payload: text('payload').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedUntil: text('locked_until'),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key').unique('core_scheduled_jobs_dedupe_key_unique'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('core_scheduled_jobs_due_idx').on(t.status, t.runAt)],
);

export const coreKv = pgTable('core_kv', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Staff dashboard sessions (US-20): only the SHA-256 of the cookie token is stored. */
export const coreDashboardSessions = pgTable(
  'core_dashboard_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    discordUserId: text('discord_user_id').notNull(),
    csrfToken: text('csrf_token').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (t) => [index('core_dashboard_sessions_expires_at_idx').on(t.expiresAt)],
);

/** Append-only log of staff actions (dashboard and commands; written from US-21). */
export const coreAuditLog = pgTable(
  'core_audit_log',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    actorDiscordId: text('actor_discord_id').notNull(),
    source: text('source').notNull(),
    action: text('action').notNull(),
    target: text('target'),
    details: text('details').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('core_audit_log_created_at_idx').on(t.createdAt)],
);
