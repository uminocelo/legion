import type { Clock, Executor, LegionDb } from '@legion/core';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { type SentinelTables, sentinelTables } from './tables.js';

export type ReportRow = SentinelTables['sentinelReports']['$inferSelect'];
export type ModActionRow = SentinelTables['sentinelModerationActions']['$inferSelect'];

/** Rate buckets, violations, flags, reports and moderation actions. */
export class SafetyRepo {
  readonly t: SentinelTables;

  constructor(
    readonly db: LegionDb,
    readonly guildId: string,
    private readonly clock: Clock,
    readonly newId: () => string,
  ) {
    this.t = sentinelTables(db);
  }

  now = () => this.clock.now().toISOString();

  /** Atomically counts one request in a window; returns the count after it. */
  async hit(key: string, windowStart: string): Promise<number> {
    const b = this.t.sentinelRateBuckets;
    const [row] = await this.db.orm
      .insert(b)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({ target: [b.key, b.windowStart], set: { count: sql`${b.count} + 1` } })
      .returning({ count: b.count });
    return row?.count ?? 1;
  }

  async addViolation(discordUserId: string, policy: string) {
    await this.db.orm
      .insert(this.t.sentinelViolations)
      .values({ id: this.newId(), discordUserId, policy, createdAt: this.now() });
  }

  async violationsSince(discordUserId: string, since: string): Promise<number> {
    const v = this.t.sentinelViolations;
    const [row] = await this.db.orm
      .select({ n: sql<number>`count(*)` })
      .from(v)
      .where(and(eq(v.discordUserId, discordUserId), gte(v.createdAt, since)));
    return Number(row?.n ?? 0);
  }

  /** Claims the once-per-hour slot for a flag; false when it was already sent this hour. */
  async claimFlag(subjectDiscordUserId: string, reason: string, hourBucket: string): Promise<boolean> {
    const f = this.t.sentinelFlagsSent;
    const rows = await this.db.orm
      .insert(f)
      .values({ subjectDiscordUserId, reason, hourBucket })
      .onConflictDoNothing()
      .returning({ r: f.reason });
    return rows.length > 0;
  }

  async prune(bucketsBefore: string, violationsBefore: string) {
    await this.db.orm
      .delete(this.t.sentinelRateBuckets)
      .where(lt(this.t.sentinelRateBuckets.windowStart, bucketsBefore));
    await this.db.orm
      .delete(this.t.sentinelViolations)
      .where(lt(this.t.sentinelViolations.createdAt, violationsBefore));
    await this.db.orm
      .delete(this.t.sentinelFlagsSent)
      .where(lt(this.t.sentinelFlagsSent.hourBucket, violationsBefore));
  }

  // ---------- reports ----------

  async report(id: string, ex: Executor = this.db.orm): Promise<ReportRow | null> {
    const r = this.t.sentinelReports;
    const [row] = await ex.select().from(r).where(eq(r.id, id)).limit(1);
    return row ?? null;
  }

  /** An open report with the same subject and reason, updated since `since` (grouping). */
  async openGroup(
    subject: string,
    reason: string,
    since: string,
    ex: Executor = this.db.orm,
  ): Promise<ReportRow | null> {
    const r = this.t.sentinelReports;
    const [row] = await ex
      .select()
      .from(r)
      .where(
        and(
          eq(r.subjectDiscordUserId, subject),
          eq(r.reason, reason),
          eq(r.status, 'open'),
          gte(r.updatedAt, since),
        ),
      )
      .orderBy(desc(r.updatedAt))
      .limit(1);
    return row ?? null;
  }

  async insertReport(
    row: Omit<ReportRow, 'guildId' | 'createdAt' | 'updatedAt' | 'count' | 'status' | 'queueMessageId'>,
    ex: Executor = this.db.orm,
  ) {
    const now = this.now();
    const rows = await ex
      .insert(this.t.sentinelReports)
      .values({ ...row, guildId: this.guildId, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning({ id: this.t.sentinelReports.id });
    return rows.length > 0;
  }

  async updateReport(id: string, patch: Partial<Omit<ReportRow, 'id'>>, ex: Executor = this.db.orm) {
    const r = this.t.sentinelReports;
    await ex
      .update(r)
      .set({ ...patch, updatedAt: this.now() })
      .where(eq(r.id, id));
  }

  async reports(opts: { status?: string; subject?: string; limit?: number } = {}): Promise<ReportRow[]> {
    const r = this.t.sentinelReports;
    const conds = [eq(r.guildId, this.guildId)];
    if (opts.status) conds.push(eq(r.status, opts.status));
    if (opts.subject) conds.push(eq(r.subjectDiscordUserId, opts.subject));
    return this.db.orm
      .select()
      .from(r)
      .where(and(...conds))
      .orderBy(desc(r.updatedAt))
      .limit(opts.limit ?? 25);
  }

  async logAction(reportId: string, staffDiscordUserId: string, action: string, note: string | null) {
    await this.db.orm
      .insert(this.t.sentinelModerationActions)
      .values({ id: this.newId(), reportId, staffDiscordUserId, action, note, createdAt: this.now() });
  }

  async actionsFor(reportIds: string[]): Promise<ModActionRow[]> {
    if (!reportIds.length) return [];
    const a = this.t.sentinelModerationActions;
    return this.db.orm
      .select()
      .from(a)
      .where(inArray(a.reportId, reportIds))
      .orderBy(desc(a.createdAt), desc(a.id));
  }
}
