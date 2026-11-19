import { type Clock, coreTables, type Executor, type LegionDb } from '@legion/core';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { type UltronTables, ultronTables } from './tables.js';

export type WorldEventRow = UltronTables['ultronWorldEvents']['$inferSelect'];
export type ParticipantRow = UltronTables['ultronEventParticipants']['$inferSelect'];
export type StrikeRow = UltronTables['ultronStrikes']['$inferSelect'];
export type WaveRow = UltronTables['ultronEventWaves']['$inferSelect'];
export type ThreatRow = UltronTables['ultronThreat']['$inferSelect'];
export type EventKind = 'invasion' | 'raid';
export type EventStatus = 'scheduled' | 'announced' | 'active' | 'ended' | 'cancelled';
export const OPEN_STATUSES: EventStatus[] = ['scheduled', 'announced', 'active'];

/** Data access for world events, participants, strikes and faction damage. */
export class EventsRepo {
  readonly t: UltronTables;

  constructor(
    readonly db: LegionDb,
    readonly guildId: string,
    private readonly clock: Clock,
  ) {
    this.t = ultronTables(db);
  }

  now = () => this.clock.now().toISOString();

  /** False when an event of this kind already starts at that time (dedupe). */
  async insertEvent(
    row: Omit<
      WorldEventRow,
      | 'guildId'
      | 'createdAt'
      | 'updatedAt'
      | 'status'
      | 'maxHp'
      | 'hp'
      | 'bossLevel'
      | 'outcome'
      | 'channelId'
      | 'announceMessageId'
      | 'messageId'
      | 'threadId'
      | 'resultsMessageId'
      | 'embedEditedAt'
      | 'waves'
      | 'wave'
    >,
    ex: Executor = this.db.orm,
  ) {
    const w = this.t.ultronWorldEvents;
    const now = this.now();
    const rows = await ex
      .insert(w)
      .values({ ...row, guildId: this.guildId, status: 'scheduled', createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning({ id: w.id });
    return rows.length > 0;
  }

  async event(id: string, ex: Executor = this.db.orm): Promise<WorldEventRow | null> {
    const w = this.t.ultronWorldEvents;
    const [row] = await ex.select().from(w).where(eq(w.id, id)).limit(1);
    return row ?? null;
  }

  /** Moves the event from one of `from` to `to` (with extra fields). False when someone else moved it first. */
  async transition(
    id: string,
    from: EventStatus[],
    to: EventStatus,
    set: Partial<WorldEventRow>,
    ex: Executor,
  ): Promise<WorldEventRow | null> {
    const w = this.t.ultronWorldEvents;
    const [row] = await ex
      .update(w)
      .set({ ...set, status: to, updatedAt: this.now() })
      .where(and(eq(w.id, id), inArray(w.status, from)))
      .returning();
    return row ?? null;
  }

  async patch(id: string, set: Partial<WorldEventRow>, ex: Executor = this.db.orm) {
    const w = this.t.ultronWorldEvents;
    await ex.update(w).set(set).where(eq(w.id, id));
  }

  /** Open events (not ended or cancelled), earliest first. */
  async openEvents(kind?: EventKind): Promise<WorldEventRow[]> {
    const w = this.t.ultronWorldEvents;
    return this.db.orm
      .select()
      .from(w)
      .where(
        and(
          eq(w.guildId, this.guildId),
          inArray(w.status, OPEN_STATUSES),
          kind ? eq(w.kind, kind) : undefined,
        ),
      )
      .orderBy(asc(w.startsAt));
  }

  /** An open event of this kind whose time overlaps [startsAt, endsAt). */
  async overlapping(kind: EventKind, startsAt: string, endsAt: string): Promise<WorldEventRow | null> {
    const w = this.t.ultronWorldEvents;
    const [row] = await this.db.orm
      .select()
      .from(w)
      .where(
        and(
          eq(w.guildId, this.guildId),
          eq(w.kind, kind),
          inArray(w.status, OPEN_STATUSES),
          lt(w.startsAt, endsAt),
          gt(w.endsAt, startsAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async lastEnded(kind: EventKind | null, n: number): Promise<WorldEventRow[]> {
    const w = this.t.ultronWorldEvents;
    return this.db.orm
      .select()
      .from(w)
      .where(and(eq(w.guildId, this.guildId), eq(w.status, 'ended'), kind ? eq(w.kind, kind) : undefined))
      .orderBy(desc(w.endsAt))
      .limit(n);
  }

  // ---------- participants and strikes ----------

  async participant(
    eventId: string,
    memberId: string,
    ex: Executor = this.db.orm,
  ): Promise<ParticipantRow | null> {
    const p = this.t.ultronEventParticipants;
    const [row] = await ex
      .select()
      .from(p)
      .where(and(eq(p.worldEventId, eventId), eq(p.memberId, memberId)))
      .limit(1);
    return row ?? null;
  }

  async participants(eventId: string): Promise<ParticipantRow[]> {
    const p = this.t.ultronEventParticipants;
    return this.db.orm
      .select()
      .from(p)
      .where(eq(p.worldEventId, eventId))
      .orderBy(desc(p.damage), asc(p.joinedAt));
  }

  /** Joins (or re-arms) a participant and records a strike, atomically. */
  async startStrike(
    o: { eventId: string; memberId: string; faction: string | null; combatId: string; nextStrikeAt: string },
    ex: Executor,
  ) {
    const p = this.t.ultronEventParticipants;
    const now = this.now();
    await ex
      .insert(p)
      .values({
        worldEventId: o.eventId,
        memberId: o.memberId,
        faction: o.faction,
        nextStrikeAt: o.nextStrikeAt,
        joinedAt: now,
      })
      .onConflictDoUpdate({ target: [p.worldEventId, p.memberId], set: { nextStrikeAt: o.nextStrikeAt } });
    await ex
      .insert(this.t.ultronStrikes)
      .values({ combatId: o.combatId, worldEventId: o.eventId, memberId: o.memberId, createdAt: now });
  }

  /** Marks the strike applied; null when unknown or already applied (idempotent by combatId). */
  async claimStrike(combatId: string, damage: number, ex: Executor): Promise<StrikeRow | null> {
    const s = this.t.ultronStrikes;
    const [row] = await ex
      .update(s)
      .set({ damage, appliedAt: this.now() })
      .where(and(eq(s.combatId, combatId), isNull(s.appliedAt)))
      .returning();
    return row ?? null;
  }

  async addDamage(
    o: {
      eventId: string;
      memberId: string;
      faction: string | null;
      damage: number;
      knockedOut: boolean;
      cooldownMs: number;
    },
    ex: Executor,
  ) {
    const p = this.t.ultronEventParticipants;
    const w = this.t.ultronWorldEvents;
    const set: Record<string, unknown> = {
      damage: sql`${p.damage} + ${o.damage}`,
      strikes: sql`${p.strikes} + 1`,
    };
    if (o.knockedOut) {
      set.knockouts = sql`${p.knockouts} + 1`;
      set.nextStrikeAt = new Date(this.clock.now().getTime() + o.cooldownMs * 2).toISOString();
    }
    await ex
      .update(p)
      .set(set)
      .where(and(eq(p.worldEventId, o.eventId), eq(p.memberId, o.memberId)));
    if (o.faction) {
      const f = this.t.ultronFactionDamage;
      await ex
        .insert(f)
        .values({ worldEventId: o.eventId, faction: o.faction, damage: o.damage })
        .onConflictDoUpdate({
          target: [f.worldEventId, f.faction],
          set: { damage: sql`${f.damage} + ${o.damage}` },
        });
    }
    const [row] = await ex
      .update(w)
      .set({
        hp:
          this.db.dialect === 'sqlite'
            ? sql`max(0, ${w.hp} - ${o.damage})`
            : sql`greatest(0, ${w.hp} - ${o.damage})`,
        updatedAt: this.now(),
      })
      .where(and(eq(w.id, o.eventId), eq(w.status, 'active')))
      .returning({ hp: w.hp, wave: w.wave, waves: w.waves, maxHp: w.maxHp, bossLevel: w.bossLevel });
    return row
      ? {
          hp: row.hp ?? 0,
          wave: row.wave,
          waves: row.waves,
          maxHp: row.maxHp ?? 0,
          bossLevel: row.bossLevel ?? 5,
        }
      : null;
  }

  // ---------- waves (US-19) ----------

  async insertWave(
    o: { eventId: string; wave: number; maxHp: number; bossLevel: number },
    ex: Executor = this.db.orm,
  ) {
    await ex
      .insert(this.t.ultronEventWaves)
      .values({
        worldEventId: o.eventId,
        wave: o.wave,
        maxHp: o.maxHp,
        bossLevel: o.bossLevel,
        startedAt: this.now(),
      })
      .onConflictDoNothing();
  }

  /** Sets the outcome of a wave that has none yet. */
  async closeWave(eventId: string, wave: number, outcome: 'cleared' | 'failed', ex: Executor) {
    const v = this.t.ultronEventWaves;
    await ex
      .update(v)
      .set({ outcome, endedAt: this.now() })
      .where(and(eq(v.worldEventId, eventId), eq(v.wave, wave), isNull(v.outcome)));
  }

  /**
   * Moves an active event from wave `from` (HP 0) to the next wave with fresh HP.
   * Guarded by `wave`: of two concurrent final strikes only one moves it. Null when someone else did.
   */
  async advanceWave(
    eventId: string,
    from: number,
    next: { maxHp: number; bossLevel: number },
    ex: Executor,
  ): Promise<WorldEventRow | null> {
    const w = this.t.ultronWorldEvents;
    const [row] = await ex
      .update(w)
      .set({
        wave: from + 1,
        maxHp: next.maxHp,
        hp: next.maxHp,
        bossLevel: next.bossLevel,
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(w.id, eventId),
          eq(w.status, 'active'),
          eq(w.wave, from),
          sql`${w.waves} > ${from}`,
          lte(w.hp, 0),
        ),
      )
      .returning();
    if (!row) return null;
    await this.closeWave(eventId, from, 'cleared', ex);
    await this.insertWave({ eventId, wave: from + 1, ...next }, ex);
    return row;
  }

  async setStrikeWave(combatId: string, wave: number, ex: Executor) {
    const s = this.t.ultronStrikes;
    await ex.update(s).set({ wave }).where(eq(s.combatId, combatId));
  }

  async waves(eventId: string): Promise<WaveRow[]> {
    const v = this.t.ultronEventWaves;
    return this.db.orm.select().from(v).where(eq(v.worldEventId, eventId)).orderBy(asc(v.wave));
  }

  /** Damage per wave and member, from applied strikes (highest first within a wave). */
  async waveDamage(eventId: string): Promise<{ wave: number; memberId: string; damage: number }[]> {
    const s = this.t.ultronStrikes;
    const rows = await this.db.orm
      .select({ wave: s.wave, memberId: s.memberId, damage: sql<number>`sum(${s.damage})` })
      .from(s)
      .where(and(eq(s.worldEventId, eventId), isNotNull(s.appliedAt)))
      .groupBy(s.wave, s.memberId);
    return rows
      .map((r) => ({ ...r, damage: Number(r.damage) }))
      .sort((a, b) => a.wave - b.wave || b.damage - a.damage || a.memberId.localeCompare(b.memberId));
  }

  // ---------- threat (US-19) ----------

  async threat(ex: Executor = this.db.orm): Promise<ThreatRow | null> {
    const t = this.t.ultronThreat;
    const [row] = await ex.select().from(t).where(eq(t.guildId, this.guildId)).limit(1);
    return row ?? null;
  }

  /**
   * Saves the threat only if nobody ticked since `seen` was read (`seen` null = no row yet).
   * False when another run got there first.
   */
  async saveThreat(
    o: { level: number; lastTickDay: string; seen: string | null | undefined },
    ex: Executor = this.db.orm,
  ): Promise<boolean> {
    const t = this.t.ultronThreat;
    const now = this.now();
    if (o.seen === undefined) {
      const rows = await ex
        .insert(t)
        .values({ guildId: this.guildId, level: o.level, lastTickDay: o.lastTickDay, updatedAt: now })
        .onConflictDoNothing()
        .returning({ id: t.guildId });
      return rows.length > 0;
    }
    const rows = await ex
      .update(t)
      .set({ level: o.level, lastTickDay: o.lastTickDay, updatedAt: now })
      .where(
        and(eq(t.guildId, this.guildId), o.seen === null ? isNull(t.lastTickDay) : eq(t.lastTickDay, o.seen)),
      )
      .returning({ id: t.guildId });
    return rows.length > 0;
  }

  /** Times of finished missions (success or failure) and strikes in [from, to). */
  async activityTimes(from: string, to: string): Promise<string[]> {
    const log = coreTables(this.db).coreEventLog;
    const missions = await this.db.orm
      .select({ at: log.occurredAt, payload: log.payload })
      .from(log)
      .where(
        and(
          eq(log.guildId, this.guildId),
          eq(log.type, 'mission.completed'),
          gte(log.occurredAt, from),
          lt(log.occurredAt, to),
        ),
      );
    const s = this.t.ultronStrikes;
    const w = this.t.ultronWorldEvents;
    const strikes = await this.db.orm
      .select({ at: s.createdAt })
      .from(s)
      .innerJoin(w, eq(w.id, s.worldEventId))
      .where(and(eq(w.guildId, this.guildId), gte(s.createdAt, from), lt(s.createdAt, to)));
    const finished = missions.filter((m) => {
      try {
        return (JSON.parse(m.payload) as { outcome?: string }).outcome !== 'abandoned';
      } catch {
        return false;
      }
    });
    return [...finished.map((m) => m.at), ...strikes.map((x) => x.at)];
  }

  async factionDamage(eventId: string) {
    const f = this.t.ultronFactionDamage;
    return this.db.orm.select().from(f).where(eq(f.worldEventId, eventId)).orderBy(desc(f.damage));
  }

  async totalDamage(eventId: string): Promise<number> {
    return (await this.participants(eventId)).reduce((a, p) => a + p.damage, 0);
  }
}
