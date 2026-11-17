import type { Clock, Executor, LegionDb, ProgressView, Rank } from '@legion/core';
import { and, desc, eq, gte, inArray, lt, sql, sum } from 'drizzle-orm';
import type { XpReason } from '../domain/xp.js';
import { type JarvisTables, jarvisTables } from './tables.js';

export type ProgressRow = JarvisTables['jarvisProgress']['$inferSelect'];
export type LedgerRow = JarvisTables['jarvisXpLedger']['$inferSelect'];
export type QuestionRow = JarvisTables['jarvisTriviaQuestions']['$inferSelect'];
export type AttemptRow = JarvisTables['jarvisTriviaAttempts']['$inferSelect'];

export const toProgressView = (p: ProgressRow): ProgressView => ({
  xp: p.xp,
  level: p.level,
  rank: p.rank as Rank,
  currentStreak: p.currentStreak,
  bestStreak: p.bestStreak,
});

export interface LedgerInsert {
  memberId: string;
  amount: number;
  reason: XpReason;
  note?: string | null;
  sourceKey: string;
  day: string;
}

/** Data access for J.A.R.V.I.S.'s own tables (the only XP writer). */
export class JarvisRepo {
  readonly t: JarvisTables;

  constructor(
    readonly db: LegionDb,
    readonly guildId: string,
    private readonly clock: Clock,
    private readonly newId: () => string,
  ) {
    this.t = jarvisTables(db);
  }

  now = () => this.clock.now().toISOString();

  async progress(memberId: string, ex: Executor = this.db.orm): Promise<ProgressRow | null> {
    const p = this.t.jarvisProgress;
    const [row] = await ex.select().from(p).where(eq(p.memberId, memberId)).limit(1);
    return row ?? null;
  }

  /** Creates the progress row if missing (idempotent). */
  async ensureProgress(memberId: string, ex: Executor = this.db.orm): Promise<void> {
    await ex
      .insert(this.t.jarvisProgress)
      .values({ memberId, guildId: this.guildId, updatedAt: this.now() })
      .onConflictDoNothing();
  }

  /** Inserts a ledger entry; returns false when the sourceKey already exists (duplicate → no-op). */
  async insertLedger(e: LedgerInsert, ex: Executor = this.db.orm): Promise<boolean> {
    const rows = await ex
      .insert(this.t.jarvisXpLedger)
      .values({ id: this.newId(), guildId: this.guildId, note: null, ...e, createdAt: this.now() })
      .onConflictDoNothing()
      .returning({ id: this.t.jarvisXpLedger.id });
    return rows.length > 0;
  }

  /** Atomically adds XP and returns the updated row (locks the row on Postgres). */
  async addXp(memberId: string, amount: number, ex: Executor): Promise<ProgressRow> {
    const p = this.t.jarvisProgress;
    const [row] = await ex
      .update(p)
      .set({ xp: sql`${p.xp} + ${amount}`, updatedAt: this.now() })
      .where(eq(p.memberId, memberId))
      .returning();
    if (!row) throw new Error(`no progress row for ${memberId}`);
    return row;
  }

  async updateProgress(
    memberId: string,
    patch: Partial<ProgressRow>,
    ex: Executor = this.db.orm,
  ): Promise<void> {
    const p = this.t.jarvisProgress;
    await ex
      .update(p)
      .set({ ...patch, updatedAt: this.now() })
      .where(eq(p.memberId, memberId));
  }

  async ledgerFor(memberId: string, ex: Executor = this.db.orm): Promise<LedgerRow[]> {
    const l = this.t.jarvisXpLedger;
    return ex.select().from(l).where(eq(l.memberId, memberId)).orderBy(l.createdAt, l.id);
  }

  /** XP per member since `fromIso` (all time when null), highest first. */
  async xpTotals(fromIso: string | null, memberIds?: string[]): Promise<{ memberId: string; xp: number }[]> {
    const l = this.t.jarvisXpLedger;
    const conds = [eq(l.guildId, this.guildId)];
    if (fromIso) conds.push(gte(l.createdAt, fromIso));
    if (memberIds) conds.push(inArray(l.memberId, memberIds.length ? memberIds : ['']));
    const total = sum(l.amount);
    const rows = await this.db.orm
      .select({ memberId: l.memberId, xp: total })
      .from(l)
      .where(and(...conds))
      .groupBy(l.memberId)
      .orderBy(desc(total), l.memberId);
    return rows.map((r) => ({ memberId: r.memberId, xp: Number(r.xp ?? 0) })).filter((r) => r.xp > 0);
  }

  async progressMany(memberIds: string[]): Promise<ProgressRow[]> {
    if (!memberIds.length) return [];
    const p = this.t.jarvisProgress;
    return this.db.orm.select().from(p).where(inArray(p.memberId, memberIds));
  }

  // ---- trivia ----

  async openAttempt(memberId: string, nowIso: string): Promise<AttemptRow | null> {
    const a = this.t.jarvisTriviaAttempts;
    const [row] = await this.db.orm
      .select()
      .from(a)
      .where(and(eq(a.memberId, memberId), eq(a.status, 'open'), gte(a.expiresAt, nowIso)))
      .orderBy(desc(a.createdAt))
      .limit(1);
    return row ?? null;
  }

  async lastAttempt(memberId: string): Promise<AttemptRow | null> {
    const a = this.t.jarvisTriviaAttempts;
    const [row] = await this.db.orm
      .select()
      .from(a)
      .where(eq(a.memberId, memberId))
      .orderBy(desc(a.createdAt))
      .limit(1);
    return row ?? null;
  }

  async attempt(id: string, ex: Executor = this.db.orm): Promise<AttemptRow | null> {
    const a = this.t.jarvisTriviaAttempts;
    const [row] = await ex.select().from(a).where(eq(a.id, id)).limit(1);
    return row ?? null;
  }

  /** Last time the member saw each question (for noRepeatDays and least-recently-seen). */
  async lastSeen(memberId: string): Promise<Map<string, string>> {
    const a = this.t.jarvisTriviaAttempts;
    const rows = await this.db.orm
      .select({ questionId: a.questionId, at: sql<string>`max(${a.createdAt})` })
      .from(a)
      .where(eq(a.memberId, memberId))
      .groupBy(a.questionId);
    return new Map(rows.map((r) => [r.questionId, r.at]));
  }

  async activeQuestions(locale: string, category: string | null): Promise<QuestionRow[]> {
    const q = this.t.jarvisTriviaQuestions;
    const conds = [eq(q.active, 1), eq(q.locale, locale)];
    if (category) conds.push(eq(q.category, category));
    return this.db.orm
      .select()
      .from(q)
      .where(and(...conds))
      .orderBy(q.id);
  }

  async question(id: string): Promise<QuestionRow | null> {
    const q = this.t.jarvisTriviaQuestions;
    const [row] = await this.db.orm.select().from(q).where(eq(q.id, id)).limit(1);
    return row ?? null;
  }

  async allQuestions(): Promise<QuestionRow[]> {
    return this.db.orm.select().from(this.t.jarvisTriviaQuestions).orderBy(this.t.jarvisTriviaQuestions.id);
  }

  async attemptsSince(fromIso: string): Promise<AttemptRow[]> {
    const a = this.t.jarvisTriviaAttempts;
    return this.db.orm
      .select()
      .from(a)
      .where(and(eq(a.guildId, this.guildId), gte(a.createdAt, fromIso)));
  }

  async answeredAttempts(): Promise<Pick<AttemptRow, 'questionId' | 'correct'>[]> {
    const a = this.t.jarvisTriviaAttempts;
    return this.db.orm
      .select({ questionId: a.questionId, correct: a.correct })
      .from(a)
      .where(and(eq(a.guildId, this.guildId), eq(a.status, 'answered')));
  }

  async expireOpenBefore(memberId: string, nowIso: string): Promise<void> {
    const a = this.t.jarvisTriviaAttempts;
    await this.db.orm
      .update(a)
      .set({ status: 'expired' })
      .where(and(eq(a.memberId, memberId), eq(a.status, 'open'), lt(a.expiresAt, nowIso)));
  }
}
