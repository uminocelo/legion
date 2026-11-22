import type { Clock, Executor, LegionDb } from '@legion/core';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { type UltronTables, ultronTables } from './tables.js';

export type WarRow = UltronTables['ultronWars']['$inferSelect'];
export type WarPointRow = UltronTables['ultronWarPoints']['$inferSelect'];
export type WarStatus = 'scheduled' | 'active' | 'ended' | 'cancelled';
export type WarReason = 'mission' | 'strike' | 'participation' | 'staff';

export interface FactionScore {
  faction: string;
  points: number;
  members: number;
}

/** Data access for faction wars and the points ledger. */
export class WarRepo {
  readonly t: UltronTables;

  constructor(
    readonly db: LegionDb,
    readonly guildId: string,
    private readonly clock: Clock,
    private readonly newId: () => string,
  ) {
    this.t = ultronTables(db);
  }

  now = () => this.clock.now().toISOString();

  async war(id: string, ex: Executor = this.db.orm): Promise<WarRow | null> {
    const w = this.t.ultronWars;
    const [row] = await ex.select().from(w).where(eq(w.id, id)).limit(1);
    return row ?? null;
  }

  async findStatus(status: WarStatus, ex: Executor = this.db.orm): Promise<WarRow | null> {
    const w = this.t.ultronWars;
    const [row] = await ex
      .select()
      .from(w)
      .where(and(eq(w.guildId, this.guildId), eq(w.status, status)))
      .orderBy(desc(w.startsAt))
      .limit(1);
    return row ?? null;
  }

  /** Latest ended war, used to place the next window. */
  async latestEnded(ex: Executor = this.db.orm): Promise<WarRow | null> {
    const w = this.t.ultronWars;
    const [row] = await ex
      .select()
      .from(w)
      .where(and(eq(w.guildId, this.guildId), eq(w.status, 'ended')))
      .orderBy(desc(w.endsAt))
      .limit(1);
    return row ?? null;
  }

  async insert(
    row: { id: string; startsAt: string; endsAt: string },
    ex: Executor = this.db.orm,
  ): Promise<boolean> {
    const w = this.t.ultronWars;
    const now = this.now();
    const rows = await ex
      .insert(w)
      .values({
        ...row,
        guildId: this.guildId,
        status: 'scheduled',
        winners: null,
        resultMessageId: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: w.id });
    return rows.length > 0;
  }

  async transition(
    id: string,
    from: WarStatus[],
    to: WarStatus,
    set: Partial<Pick<WarRow, 'startsAt' | 'endsAt' | 'winners' | 'resultMessageId'>>,
    ex: Executor,
  ): Promise<WarRow | null> {
    const w = this.t.ultronWars;
    const [row] = await ex
      .update(w)
      .set({ ...set, status: to, updatedAt: this.now() })
      .where(and(eq(w.id, id), inArray(w.status, from)))
      .returning();
    return row ?? null;
  }

  async setResultMessage(id: string, messageId: string, ex: Executor = this.db.orm) {
    const w = this.t.ultronWars;
    await ex.update(w).set({ resultMessageId: messageId, updatedAt: this.now() }).where(eq(w.id, id));
  }

  /** Inserts one ledger row. False when `sourceKey` was already used. */
  async addPoint(
    row: {
      warId: string;
      memberId: string;
      faction: string;
      points: number;
      reason: WarReason;
      sourceKey: string;
      squadId?: string | null;
      createdBy?: string | null;
      note?: string | null;
    },
    ex: Executor = this.db.orm,
  ): Promise<boolean> {
    const p = this.t.ultronWarPoints;
    const rows = await ex
      .insert(p)
      .values({
        id: this.newId(),
        guildId: this.guildId,
        createdBy: row.createdBy ?? null,
        note: row.note ?? null,
        squadId: row.squadId ?? null,
        createdAt: this.now(),
        warId: row.warId,
        memberId: row.memberId,
        faction: row.faction,
        points: row.points,
        reason: row.reason,
        sourceKey: row.sourceKey,
      })
      .onConflictDoNothing()
      .returning({ id: p.id });
    return rows.length > 0;
  }

  /** Sum of points per squad for one faction. Rows with a null squad_id are skipped. */
  async squadScores(
    warId: string,
    faction: string,
    ex: Executor = this.db.orm,
  ): Promise<{ squadId: string; points: number }[]> {
    const p = this.t.ultronWarPoints;
    const rows = await ex
      .select({
        squadId: p.squadId,
        points: sql<number>`sum(${p.points})`.mapWith(Number),
      })
      .from(p)
      .where(and(eq(p.warId, warId), eq(p.faction, faction), isNotNull(p.squadId)))
      .groupBy(p.squadId);
    return rows
      .filter((r): r is { squadId: string; points: number } => !!r.squadId)
      .map((r) => ({ squadId: r.squadId, points: Number(r.points) }));
  }

  async scores(warId: string, ex: Executor = this.db.orm): Promise<FactionScore[]> {
    const p = this.t.ultronWarPoints;
    const rows = await ex
      .select({
        faction: p.faction,
        points: sql<number>`sum(${p.points})`.mapWith(Number),
        members: sql<number>`count(distinct ${p.memberId})`.mapWith(Number),
      })
      .from(p)
      .where(eq(p.warId, warId))
      .groupBy(p.faction);
    return rows.map((r) => ({ faction: r.faction, points: Number(r.points), members: Number(r.members) }));
  }

  /** Distinct members who scored for one of `factions` in this war. */
  async membersOf(warId: string, factions: string[], ex: Executor = this.db.orm): Promise<string[]> {
    if (!factions.length) return [];
    const p = this.t.ultronWarPoints;
    const rows = await ex
      .select({ memberId: p.memberId })
      .from(p)
      .where(and(eq(p.warId, warId), inArray(p.faction, factions)));
    return [...new Set(rows.map((r) => r.memberId))];
  }

  async pointsOf(warId: string, memberId: string, faction: string | null, ex: Executor = this.db.orm) {
    const p = this.t.ultronWarPoints;
    const [mine] = await ex
      .select({ points: sql<number>`coalesce(sum(${p.points}), 0)`.mapWith(Number) })
      .from(p)
      .where(and(eq(p.warId, warId), eq(p.memberId, memberId)));
    const factionPoints = faction
      ? (
          await ex
            .select({ points: sql<number>`coalesce(sum(${p.points}), 0)`.mapWith(Number) })
            .from(p)
            .where(and(eq(p.warId, warId), eq(p.faction, faction)))
        )[0]?.points
      : 0;
    return { mine: Number(mine?.points ?? 0), faction: Number(factionPoints ?? 0) };
  }

  /** Sum per member inside one faction, highest first. */
  async memberScores(
    warId: string,
    faction: string,
    ex: Executor = this.db.orm,
  ): Promise<{ memberId: string; points: number }[]> {
    const p = this.t.ultronWarPoints;
    const rows = await ex
      .select({
        memberId: p.memberId,
        points: sql<number>`sum(${p.points})`.mapWith(Number),
      })
      .from(p)
      .where(and(eq(p.warId, warId), eq(p.faction, faction)))
      .groupBy(p.memberId);
    return rows
      .map((r) => ({ memberId: r.memberId, points: Number(r.points) }))
      .sort((a, b) => b.points - a.points);
  }

  async setWinners(id: string, winners: string[], ex: Executor = this.db.orm): Promise<void> {
    const w = this.t.ultronWars;
    await ex
      .update(w)
      .set({ winners: JSON.stringify(winners), updatedAt: this.now() })
      .where(eq(w.id, id));
  }
}

/** Factions with the highest total among those above 0. Empty when nobody scored. Ties all win. */
export function pickWinners(scores: FactionScore[]): string[] {
  const above = scores.filter((s) => s.points > 0);
  const top = Math.max(0, ...above.map((s) => s.points));
  return above
    .filter((s) => s.points === top)
    .map((s) => s.faction)
    .sort();
}
