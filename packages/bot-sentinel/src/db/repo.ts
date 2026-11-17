import type { Clock, Executor, LegionDb } from '@legion/core';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Action, Fighter, LogEntry, RoundInput } from '../domain/combat/types.js';
import { type SentinelTables, sentinelTables } from './tables.js';

export type CombatRow = SentinelTables['sentinelCombats']['$inferSelect'];
export type CombatantRow = SentinelTables['sentinelCombatants']['$inferSelect'];
export type RoundRow = SentinelTables['sentinelCombatRounds']['$inferSelect'];

/** Data access for Sentinel's own tables. */
export class SentinelRepo {
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

  // ---------- combat ----------

  /** Inserts the combat; false when it already existed (idempotent start). */
  async insertCombat(
    row: Omit<
      CombatRow,
      | 'guildId'
      | 'createdAt'
      | 'status'
      | 'round'
      | 'threadId'
      | 'promptMessageId'
      | 'winnerSide'
      | 'logHash'
      | 'finishedAt'
    >,
    ex: Executor,
  ) {
    const c = this.t.sentinelCombats;
    const rows = await ex
      .insert(c)
      .values({ ...row, guildId: this.guildId, createdAt: this.now() })
      .onConflictDoNothing()
      .returning({ id: c.id });
    return rows.length > 0;
  }

  async insertCombatants(rows: CombatantRow[], ex: Executor) {
    if (rows.length) await ex.insert(this.t.sentinelCombatants).values(rows);
  }

  async combat(id: string, ex: Executor = this.db.orm): Promise<CombatRow | null> {
    const c = this.t.sentinelCombats;
    const [row] = await ex.select().from(c).where(eq(c.id, id)).limit(1);
    return row ?? null;
  }

  async updateCombat(id: string, patch: Partial<Omit<CombatRow, 'id'>>, ex: Executor = this.db.orm) {
    const c = this.t.sentinelCombats;
    await ex.update(c).set(patch).where(eq(c.id, id));
  }

  async combatants(combatId: string, ex: Executor = this.db.orm): Promise<CombatantRow[]> {
    const c = this.t.sentinelCombatants;
    return ex.select().from(c).where(eq(c.combatId, combatId)).orderBy(asc(c.id));
  }

  async updateCombatant(combatId: string, id: string, patch: Partial<CombatantRow>, ex: Executor) {
    const c = this.t.sentinelCombatants;
    await ex
      .update(c)
      .set(patch)
      .where(and(eq(c.combatId, combatId), eq(c.id, id)));
  }

  async rounds(combatId: string, ex: Executor = this.db.orm): Promise<RoundRow[]> {
    const r = this.t.sentinelCombatRounds;
    return ex.select().from(r).where(eq(r.combatId, combatId)).orderBy(asc(r.round));
  }

  /** Stores a resolved round; false when it was already stored (concurrent resolve). */
  async insertRound(
    combatId: string,
    round: number,
    actions: Record<string, Action>,
    idle: boolean,
    log: LogEntry[],
    ex: Executor,
  ) {
    const r = this.t.sentinelCombatRounds;
    const rows = await ex
      .insert(r)
      .values({
        combatId,
        round,
        actions: JSON.stringify(actions),
        idle: idle ? 1 : 0,
        log: JSON.stringify(log),
        resolvedAt: this.now(),
      })
      .onConflictDoNothing()
      .returning({ round: r.round });
    return rows.length > 0;
  }

  async setPending(combatId: string, round: number, combatantId: string, action: Action) {
    const p = this.t.sentinelPendingActions;
    const chosenAt = this.now();
    await this.db.orm
      .insert(p)
      .values({ combatId, round, combatantId, action, chosenAt })
      .onConflictDoUpdate({ target: [p.combatId, p.round, p.combatantId], set: { action, chosenAt } });
  }

  async pending(
    combatId: string,
    round: number,
    ex: Executor = this.db.orm,
  ): Promise<Record<string, Action>> {
    const p = this.t.sentinelPendingActions;
    const rows = await ex
      .select()
      .from(p)
      .where(and(eq(p.combatId, combatId), eq(p.round, round)));
    return Object.fromEntries(rows.map((r) => [r.combatantId, r.action as Action]));
  }

  async activeCombats(): Promise<CombatRow[]> {
    const c = this.t.sentinelCombats;
    return this.db.orm.select().from(c).where(eq(c.status, 'active'));
  }

  /** Combats (any status) a member took part in as a player, newest first. */
  async combatsOfMember(
    memberId: string,
    opts: { status?: string; mode?: string; excludeMode?: string } = {},
  ) {
    const c = this.t.sentinelCombats;
    const k = this.t.sentinelCombatants;
    const conds = [eq(k.refId, memberId), eq(k.kind, 'player')];
    if (opts.status) conds.push(eq(c.status, opts.status));
    if (opts.mode) conds.push(eq(c.mode, opts.mode));
    if (opts.excludeMode) conds.push(ne(c.mode, opts.excludeMode));
    const rows = await this.db.orm
      .select({ combat: c })
      .from(k)
      .innerJoin(c, eq(c.id, k.combatId))
      .where(and(...conds))
      .orderBy(desc(c.createdAt));
    return rows.map((r) => r.combat);
  }

  /**
   * Finds a combat by its full id or by the short id people see (`#ABC123`, the last characters),
   * ignoring case. A short id that matches several combats returns null.
   */
  async findCombat(idOrShort: string): Promise<CombatRow | null> {
    const q = idOrShort.trim().replace(/^#/, '');
    if (!q) return null;
    const exact = await this.combat(q);
    if (exact) return exact;
    if (q.length < 4) return null;
    const c = this.t.sentinelCombats;
    const all = await this.db.orm.select().from(c).where(eq(c.guildId, this.guildId));
    const hits = all.filter((x) => x.id.toUpperCase().endsWith(q.toUpperCase()));
    return hits.length === 1 ? (hits[0] ?? null) : null;
  }

  /** Recent combats (newest first), for autocomplete. */
  async recentCombats(limit = 25): Promise<CombatRow[]> {
    const c = this.t.sentinelCombats;
    return this.db.orm
      .select()
      .from(c)
      .where(eq(c.guildId, this.guildId))
      .orderBy(desc(c.createdAt))
      .limit(limit);
  }

  async combatsByIds(ids: string[]) {
    if (!ids.length) return [];
    const c = this.t.sentinelCombats;
    return this.db.orm.select().from(c).where(inArray(c.id, ids));
  }
}

/** Engine fighter at the start of the fight, from a stored combatant. */
export const startFighter = (r: CombatantRow): Fighter => ({
  id: r.id,
  side: r.side as Fighter['side'],
  kind: r.kind as Fighter['kind'],
  name: r.name,
  maxHp: r.maxHp,
  hp: r.maxHp,
  atk: r.atk,
  def: r.def,
  spd: r.spd,
  foc: r.foc,
  powerCooldownMax: r.powerCooldownMax,
  powerCooldown: r.startPowerCooldown,
  downedAtRound: null,
});

export const roundInput = (r: RoundRow): RoundInput => ({
  actions: JSON.parse(r.actions),
  idle: r.idle === 1,
});
