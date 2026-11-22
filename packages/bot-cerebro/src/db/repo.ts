import type { Clock, Executor, LegionDb, MemberView, MutantView, Rank } from '@legion/core';
import { and, count, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { toStep } from '../domain/onboarding.js';
import { type CerebroTables, cerebroTables } from './tables.js';

export type MemberRow = CerebroTables['members']['$inferSelect'];
export type MutantRow = CerebroTables['mutants']['$inferSelect'];
export interface PendingPowers {
  main: string | null;
  secondary: string[];
}
const pendingSchema = z
  .object({ main: z.string().nullable().catch(null), secondary: z.array(z.string()).catch([]) })
  .catch({ main: null, secondary: [] });
export const pendingPowersOf = (m: Pick<MemberRow, 'pendingPowers'>): PendingPowers =>
  m.pendingPowers ? pendingSchema.parse(JSON.parse(m.pendingPowers)) : { main: null, secondary: [] };

const optInsSchema = z.array(z.string()).catch([]);

export const toMemberView = (m: MemberRow): MemberView => ({
  id: m.id,
  discordUserId: m.discordUserId,
  onboardingStep: toStep(m.onboardingStep),
  faction: m.faction,
  factionChangedAt: m.factionChangedAt,
  rank: m.rank as Rank,
  optIns: optInsSchema.parse(JSON.parse(m.optIns)),
  leftAt: m.leftAt,
});

export const toMutantView = (m: MutantRow): MutantView => ({
  id: m.id,
  memberId: m.memberId,
  codename: m.codename,
  archetype: m.archetype,
  power: m.power,
  origin: m.origin,
  originType: m.originType,
});

/** Data access for Cérebro's own tables (the only writer of members/mutants). */
export class CerebroRepo {
  readonly t: CerebroTables;

  constructor(
    readonly db: LegionDb,
    private readonly guildId: string,
    private readonly clock: Clock,
    private readonly newId: () => string,
  ) {
    this.t = cerebroTables(db);
  }

  private now = () => this.clock.now().toISOString();

  async memberByDiscordId(discordUserId: string, ex: Executor = this.db.orm): Promise<MemberRow | null> {
    const m = this.t.members;
    const [row] = await ex
      .select()
      .from(m)
      .where(and(eq(m.guildId, this.guildId), eq(m.discordUserId, discordUserId)))
      .limit(1);
    return row ?? null;
  }

  async memberById(id: string, ex: Executor = this.db.orm): Promise<MemberRow | null> {
    const m = this.t.members;
    const [row] = await ex.select().from(m).where(eq(m.id, id)).limit(1);
    return row ?? null;
  }

  /** Returns the member row, creating it at `signal` if missing (idempotent under races). */
  async ensureMember(
    discordUserId: string,
    ex: Executor = this.db.orm,
  ): Promise<{ row: MemberRow; created: boolean }> {
    const existing = await this.memberByDiscordId(discordUserId, ex);
    if (existing) return { row: existing, created: false };
    const now = this.now();
    const inserted = await ex
      .insert(this.t.members)
      .values({
        id: this.newId(),
        guildId: this.guildId,
        discordUserId,
        onboardingStep: 'signal',
        rank: 'recruta',
        optIns: '[]',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    const row = inserted[0] ?? (await this.memberByDiscordId(discordUserId, ex));
    if (!row) throw new Error('member insert failed');
    return { row, created: inserted.length > 0 };
  }

  async updateMember(
    id: string,
    patch: Partial<Omit<MemberRow, 'id' | 'guildId' | 'discordUserId' | 'createdAt'>>,
    ex: Executor = this.db.orm,
  ) {
    const m = this.t.members;
    const [row] = await ex
      .update(m)
      .set({ ...patch, updatedAt: this.now() })
      .where(eq(m.id, id))
      .returning();
    return row ?? null;
  }

  async mutantByMemberId(memberId: string, ex: Executor = this.db.orm): Promise<MutantRow | null> {
    const t = this.t.mutants;
    const [row] = await ex.select().from(t).where(eq(t.memberId, memberId)).limit(1);
    return row ?? null;
  }

  async codenameTaken(normalized: string, ex: Executor = this.db.orm): Promise<boolean> {
    const t = this.t.mutants;
    const [row] = await ex
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.guildId, this.guildId), eq(t.codenameNormalized, normalized)))
      .limit(1);
    return Boolean(row);
  }

  async insertMutant(
    v: Pick<MutantRow, 'memberId' | 'codename' | 'codenameNormalized' | 'power' | 'archetype' | 'origin'> &
      Partial<Pick<MutantRow, 'originType'>>,
    ex: Executor = this.db.orm,
  ): Promise<MutantRow> {
    const now = this.now();
    const [row] = await ex
      .insert(this.t.mutants)
      .values({ id: this.newId(), guildId: this.guildId, ...v, createdAt: now, updatedAt: now })
      .returning();
    if (!row) throw new Error('mutant insert failed');
    return row;
  }

  /** Catalog power ids of a mutant, main first. */
  async powersOf(
    mutantId: string,
    ex: Executor = this.db.orm,
  ): Promise<{ main: string | null; secondary: string[] }> {
    const t = this.t.cerebroMutantPowers;
    const rows = await ex.select().from(t).where(eq(t.mutantId, mutantId)).orderBy(t.createdAt, t.id);
    return {
      main: rows.find((r) => r.slot === 'main')?.powerId ?? null,
      secondary: rows.filter((r) => r.slot === 'secondary').map((r) => r.powerId),
    };
  }

  async insertPowers(mutantId: string, picked: { main: string; secondary: string[] }, ex: Executor) {
    const now = this.now();
    await ex.insert(this.t.cerebroMutantPowers).values([
      { id: this.newId(), mutantId, powerId: picked.main, slot: 'main', createdAt: now },
      ...picked.secondary.map((powerId) => ({
        id: this.newId(),
        mutantId,
        powerId,
        slot: 'secondary',
        createdAt: now,
      })),
    ]);
  }

  /** Replaces all catalog powers of a mutant (origin change). */
  async replacePowers(mutantId: string, picked: { main: string; secondary: string[] }, ex: Executor) {
    const t = this.t.cerebroMutantPowers;
    await ex.delete(t).where(eq(t.mutantId, mutantId));
    await this.insertPowers(mutantId, picked, ex);
  }

  async updateMutant(
    id: string,
    patch: Partial<Pick<MutantRow, 'archetype' | 'originType' | 'originRechoice'>>,
    ex: Executor = this.db.orm,
  ) {
    await ex
      .update(this.t.mutants)
      .set({ ...patch, updatedAt: this.now() })
      .where(eq(this.t.mutants.id, id));
  }

  /** Records a faction change; false when `sourceKey` was already recorded (idempotent). */
  async insertFactionChange(
    v: {
      memberId: string;
      from: string | null;
      to: string;
      reason: 'onboarding' | 'arc' | 'staff' | 'squad';
      sourceKey: string;
      by: string | null;
    },
    ex: Executor,
  ): Promise<boolean> {
    const rows = await ex
      .insert(this.t.cerebroFactionChanges)
      .values({
        id: this.newId(),
        guildId: this.guildId,
        memberId: v.memberId,
        fromFaction: v.from,
        toFaction: v.to,
        reason: v.reason,
        sourceKey: v.sourceKey,
        byDiscordUserId: v.by,
        createdAt: this.now(),
      })
      .onConflictDoNothing()
      .returning({ id: this.t.cerebroFactionChanges.id });
    return rows.length > 0;
  }

  async factionChangeBySource(sourceKey: string) {
    const t = this.t.cerebroFactionChanges;
    const [row] = await this.db.orm
      .select()
      .from(t)
      .where(and(eq(t.guildId, this.guildId), eq(t.sourceKey, sourceKey)))
      .limit(1);
    return row ?? null;
  }

  async factionChanges(memberId: string) {
    const t = this.t.cerebroFactionChanges;
    return this.db.orm.select().from(t).where(eq(t.memberId, memberId)).orderBy(t.createdAt, t.id);
  }

  /** Registered members (still on the server) per stored faction key. */
  async countsByFaction(): Promise<Record<string, number>> {
    const m = this.t.members;
    const rows = await this.db.orm
      .select({ faction: m.faction, n: count() })
      .from(m)
      .where(and(eq(m.guildId, this.guildId), eq(m.onboardingStep, 'registered'), isNull(m.leftAt)))
      .groupBy(m.faction);
    return Object.fromEntries(rows.map((r) => [r.faction ?? '', Number(r.n)]));
  }

  async listRegistered(opts: { faction?: string; includeLeft?: boolean } = {}): Promise<MemberRow[]> {
    const m = this.t.members;
    const conds = [eq(m.guildId, this.guildId), eq(m.onboardingStep, 'registered')];
    if (opts.faction) conds.push(eq(m.faction, opts.faction));
    if (!opts.includeLeft) conds.push(isNull(m.leftAt));
    return this.db.orm
      .select()
      .from(m)
      .where(and(...conds));
  }

  async countsByStep(): Promise<Record<string, number>> {
    const m = this.t.members;
    const rows = await this.db.orm
      .select({ step: m.onboardingStep, n: count() })
      .from(m)
      .where(and(eq(m.guildId, this.guildId), isNull(m.leftAt)))
      .groupBy(m.onboardingStep);
    return Object.fromEntries(rows.map((r) => [r.step, Number(r.n)]));
  }

  async countLeft(): Promise<number> {
    const m = this.t.members;
    const [row] = await this.db.orm
      .select({ n: count() })
      .from(m)
      .where(and(eq(m.guildId, this.guildId), isNotNull(m.leftAt)));
    return Number(row?.n ?? 0);
  }

  /** Records a canon-name attempt and returns how many happened in the window (including this one). */
  async recordCanonAttempt(memberId: string, attemptedName: string, windowMinutes: number): Promise<number> {
    const t = this.t.cerebroCanonAttempts;
    const now = this.clock.now();
    await this.db.orm.insert(t).values({
      id: this.newId(),
      memberId,
      attemptedName: attemptedName.slice(0, 100),
      createdAt: now.toISOString(),
    });
    const since = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
    const [row] = await this.db.orm
      .select({ n: count() })
      .from(t)
      .where(and(eq(t.memberId, memberId), gte(t.createdAt, since)));
    return Number(row?.n ?? 0);
  }
}
