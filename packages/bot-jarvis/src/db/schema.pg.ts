import { index, integer, primaryKey, pgTable as table, text, uniqueIndex } from 'drizzle-orm/pg-core';

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
    index('jarvis_xp_ledger_guild_day_idx').on(t.guildId, t.day),
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
    // file (content packs) | staff (created in Discord)
    origin: text('origin').notNull().default('file'),
    // Staff questions: pending | approved | rejected. Any question: disabled (kept out by staff, even on reload).
    review: text('review'),
    createdBy: text('created_by'),
    reviewedBy: text('reviewed_by'),
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

/** Missions loaded from content files (definition = the validated mission as JSON). */
export const jarvisMissions = table(
  'jarvis_missions',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    minLevel: integer('min_level').notNull(),
    party: integer('party').notNull(),
    difficulty: text('difficulty').notNull(),
    hasCombat: integer('has_combat').notNull(),
    definition: text('definition').notNull(),
    contentHash: text('content_hash').notNull(),
    active: integer('active').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
    // file (content folders) | staff (imported in Discord; file reloads never touch it)
    origin: text('origin').notNull().default('file'),
    importedBy: text('imported_by'),
    // Set when staff turned it off: stays off across file reloads until turned on again.
    disabledBy: text('disabled_by'),
    // v0.9 campaigns (copied from the definition for queries): chapter of `campaign_id`, `requires` JSON.
    campaignId: text('campaign_id'),
    chapter: integer('chapter'),
    requires: text('requires'),
  },
  (t) => [index('jarvis_missions_campaign_idx').on(t.campaignId, t.chapter)],
);

/** Campaign metadata (v0.9, US-27). Mirrors `jarvis_missions`: files or staff imports. */
export const jarvisCampaigns = table('jarvis_campaigns', {
  id: text('id').primaryKey(),
  // tutorial | recruitment | story
  kind: text('kind').notNull(),
  // The team a recruitment campaign recruits for; null otherwise.
  faction: text('faction'),
  definition: text('definition').notNull(),
  contentHash: text('content_hash').notNull(),
  active: integer('active').notNull().default(1),
  // file | staff
  origin: text('origin').notNull().default('file'),
  importedBy: text('imported_by'),
  disabledBy: text('disabled_by'),
  updatedAt: text('updated_at').notNull(),
});

/** One play of a mission. `version` grows on every state change (idempotent clicks and timers). */
export const jarvisMissionRuns = table(
  'jarvis_mission_runs',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    missionId: text('mission_id').notNull(),
    kind: text('kind').notNull(),
    leaderMemberId: text('leader_member_id').notNull(),
    // lobby | active | fighting | success | failure | abandoned | cancelled
    status: text('status').notNull(),
    sceneId: text('scene_id').notNull(),
    version: integer('version').notNull().default(0),
    locale: text('locale').notNull(),
    channelId: text('channel_id').notNull(),
    threadId: text('thread_id'),
    // The scene whose message is already in the thread (restart recovery posts the missing one).
    postedScene: text('posted_scene'),
    messageId: text('message_id'),
    day: text('day').notNull(),
    week: text('week').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    endedAt: text('ended_at'),
  },
  (t) => [
    index('jarvis_mission_runs_status_idx').on(t.guildId, t.status),
    index('jarvis_mission_runs_mission_idx').on(t.missionId),
  ],
);

export const jarvisMissionMembers = table(
  'jarvis_mission_members',
  {
    runId: text('run_id').notNull(),
    memberId: text('member_id').notNull(),
    joinedAt: text('joined_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.memberId] }),
    index('jarvis_mission_members_member_idx').on(t.memberId),
  ],
);

/** Choices made in a run: one row per member and scene (a solo run has one per scene). */
export const jarvisMissionChoices = table(
  'jarvis_mission_choices',
  {
    runId: text('run_id').notNull(),
    sceneId: text('scene_id').notNull(),
    memberId: text('member_id').notNull(),
    choice: integer('choice').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.sceneId, t.memberId] })],
);

/** Staff changes to trivia questions (create, edit, approve, reject, disable, enable). */
export const jarvisTriviaEdits = table(
  'jarvis_trivia_edits',
  {
    id: text('id').primaryKey(),
    questionId: text('question_id').notNull(),
    staffId: text('staff_id').notNull(),
    action: text('action').notNull(),
    before: text('before'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('jarvis_trivia_edits_question_idx').on(t.questionId, t.createdAt)],
);
