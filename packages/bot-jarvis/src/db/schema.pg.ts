import { index, integer, pgTable as table, text, uniqueIndex } from 'drizzle-orm/pg-core';

/** One row per member; every number here can be rebuilt from jarvis_xp_ledger. */
export const jarvisProgress = table(
  'jarvis_progress',
  {
    // members.id (owned by Cérebro); no DB-level FK (ADR 0002).
    memberId: text('member_id').primaryKey(),
    guildId: text('guild_id').notNull(),
    xp: integer('xp').notNull().default(0),
    level: integer('level').notNull().default(1),
    rank: text('rank').notNull().default('recruta'),
    currentStreak: integer('current_streak').notNull().default(0),
    bestStreak: integer('best_streak').notNull().default(0),
    lastActiveDay: text('last_active_day'),
    triviaXpToday: integer('trivia_xp_today').notNull().default(0),
    triviaXpDay: text('trivia_xp_day'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('jarvis_progress_guild_xp_idx').on(t.guildId, t.xp)],
);

export const jarvisXpLedger = table(
  'jarvis_xp_ledger',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    memberId: text('member_id').notNull(),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    sourceKey: text('source_key').notNull(),
    day: text('day').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('jarvis_xp_ledger_source_unique').on(t.sourceKey),
    index('jarvis_xp_ledger_guild_created_idx').on(t.guildId, t.createdAt),
    index('jarvis_xp_ledger_member_idx').on(t.memberId),
  ],
);

export const jarvisTriviaQuestions = table(
  'jarvis_trivia_questions',
  {
    id: text('id').primaryKey(),
    locale: text('locale').notNull(),
    category: text('category').notNull(),
    difficulty: text('difficulty').notNull(),
    question: text('question').notNull(),
    choices: text('choices').notNull(),
    answerIndex: integer('answer_index').notNull(),
    explanation: text('explanation').notNull(),
    source: text('source').notNull(),
    contentHash: text('content_hash').notNull(),
    active: integer('active').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('jarvis_trivia_questions_pick_idx').on(t.locale, t.category, t.active)],
);

export const jarvisTriviaAttempts = table(
  'jarvis_trivia_attempts',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    memberId: text('member_id').notNull(),
    questionId: text('question_id').notNull(),
    choiceOrder: text('choice_order').notNull(),
    status: text('status').notNull(),
    chosenIndex: integer('chosen_index'),
    correct: integer('correct'),
    msToAnswer: integer('ms_to_answer'),
    xpAwarded: integer('xp_awarded').notNull().default(0),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    answeredAt: text('answered_at'),
  },
  (t) => [index('jarvis_trivia_attempts_member_idx').on(t.memberId, t.createdAt)],
);
