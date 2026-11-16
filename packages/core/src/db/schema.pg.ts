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
