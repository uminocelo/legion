import type { Clock, Executor, LegionDb } from '@legion/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import { type HerbieTables, herbieTables } from './tables.js';

export type TutorialProgressRow = HerbieTables['herbieTutorialProgress']['$inferSelect'];
export type StepDoneRow = HerbieTables['herbieTutorialStepsDone']['$inferSelect'];
export type TutorialStatus = 'active' | 'completed' | 'skipped';

/** Data access for H.E.R.B.I.E.'s own tables. */
export class HerbieRepo {
  readonly t: HerbieTables;

  constructor(
    readonly db: LegionDb,
    readonly guildId: string,
    private readonly clock: Clock,
    private readonly newId: () => string,
  ) {
    this.t = herbieTables(db);
  }

  now = () => this.clock.now().toISOString();

  async progress(memberId: string, ex: Executor = this.db.orm): Promise<TutorialProgressRow | null> {
    const p = this.t.herbieTutorialProgress;
    const [row] = await ex.select().from(p).where(eq(p.memberId, memberId)).limit(1);
    return row ?? null;
  }

  /** Creates the progress row; returns false when it already existed (replayed player.created). */
  async startProgress(
    memberId: string,
    chainId: string,
    firstStepId: string | null,
    ex: Executor = this.db.orm,
  ) {
    const p = this.t.herbieTutorialProgress;
    const now = this.now();
    const rows = await ex
      .insert(p)
      .values({
        memberId,
        guildId: this.guildId,
        chainId,
        currentStepId: firstStepId,
        status: 'active',
        startedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ memberId: p.memberId });
    return rows.length > 0;
  }

  /** Moves every progress row of chain `from` to `to` on this server; returns how many moved. */
  async renameChain(from: string, to: string): Promise<number> {
    const p = this.t.herbieTutorialProgress;
    const rows = await this.db.orm
      .update(p)
      .set({ chainId: to, updatedAt: this.now() })
      .where(and(eq(p.guildId, this.guildId), eq(p.chainId, from)))
      .returning({ memberId: p.memberId });
    return rows.length;
  }

  async updateProgress(
    memberId: string,
    patch: Partial<Omit<TutorialProgressRow, 'memberId' | 'guildId'>>,
    ex: Executor = this.db.orm,
  ) {
    const p = this.t.herbieTutorialProgress;
    await ex
      .update(p)
      .set({ ...patch, updatedAt: this.now() })
      .where(eq(p.memberId, memberId));
  }

  async stepsDone(memberId: string, ex: Executor = this.db.orm): Promise<StepDoneRow[]> {
    const d = this.t.herbieTutorialStepsDone;
    return ex.select().from(d).where(eq(d.memberId, memberId)).orderBy(asc(d.completedAt));
  }

  /** Marks a step done; returns false when it was already done (same or another trigger event). */
  async markStepDone(
    memberId: string,
    stepId: string,
    triggerEventId: string,
    xpGranted: number,
    ex: Executor = this.db.orm,
  ) {
    const d = this.t.herbieTutorialStepsDone;
    const rows = await ex
      .insert(d)
      .values({ memberId, stepId, triggerEventId, xpGranted, completedAt: this.now() })
      .onConflictDoNothing()
      .returning({ stepId: d.stepId });
    return rows.length > 0;
  }

  async allProgress(): Promise<TutorialProgressRow[]> {
    const p = this.t.herbieTutorialProgress;
    return this.db.orm.select().from(p).where(eq(p.guildId, this.guildId));
  }

  async stepCounts(): Promise<{ stepId: string; n: number }[]> {
    const d = this.t.herbieTutorialStepsDone;
    const p = this.t.herbieTutorialProgress;
    const rows = await this.db.orm
      .select({ stepId: d.stepId, n: sql<number>`count(*)` })
      .from(d)
      .innerJoin(p, eq(p.memberId, d.memberId))
      .where(eq(p.guildId, this.guildId))
      .groupBy(d.stepId);
    return rows.map((r) => ({ stepId: r.stepId, n: Number(r.n) }));
  }

  // ---- preferences ----
  async locale(memberId: string): Promise<string | null> {
    const t = this.t.herbiePreferences;
    const [row] = await this.db.orm.select().from(t).where(eq(t.memberId, memberId)).limit(1);
    return row?.locale ?? null;
  }

  async setLocale(memberId: string, locale: string) {
    const t = this.t.herbiePreferences;
    const now = this.now();
    await this.db.orm
      .insert(t)
      .values({ memberId, locale, updatedAt: now })
      .onConflictDoUpdate({ target: t.memberId, set: { locale, updatedAt: now } });
  }

  // ---- tips ----
  async tipLog(): Promise<HerbieTables['herbieTipLog']['$inferSelect'][]> {
    const t = this.t.herbieTipLog;
    return this.db.orm.select().from(t).where(eq(t.guildId, this.guildId)).orderBy(asc(t.postedAt));
  }

  async logTip(tipId: string, cycle: number) {
    await this.db.orm
      .insert(this.t.herbieTipLog)
      .values({ id: this.newId(), guildId: this.guildId, tipId, cycle, postedAt: this.now() });
  }

  // ---- world events ----
  /** Claims a world event for explanation; returns false when it was already posted. */
  async claimWorldEvent(worldEventId: string): Promise<boolean> {
    const t = this.t.herbieWorldEventPosts;
    const rows = await this.db.orm
      .insert(t)
      .values({ worldEventId, messageId: null, postedAt: this.now() })
      .onConflictDoNothing()
      .returning({ id: t.worldEventId });
    return rows.length > 0;
  }

  async setWorldEventMessage(worldEventId: string, messageId: string) {
    const t = this.t.herbieWorldEventPosts;
    await this.db.orm
      .update(t)
      .set({ messageId })
      .where(and(eq(t.worldEventId, worldEventId)));
  }
}
