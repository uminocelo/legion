import type { Clock, Executor, LegionDb } from '@legion/core';
import { and, asc, desc, eq, gte, inArray, lt, sum } from 'drizzle-orm';
import { type JarvisTables, jarvisTables } from './tables.js';

export type SeasonRow = JarvisTables['jarvisSeasons']['$inferSelect'];
export type SeasonBadgeRow = JarvisTables['jarvisSeasonBadges']['$inferSelect'];
export type SeasonStatus = 'scheduled' | 'active' | 'ended';

export interface SeasonWinner {
  memberId: string;
  place: number;
  xp: number;
}

export interface SeasonScore {
  memberId: string;
  xp: number;
}

export interface SeasonArchiveEntry {
  memberId: string;
  discordUserId?: string;
  codename?: string;
  xp: number;
  place: number;
}

export interface SeasonArchive {
  board: SeasonArchiveEntry[];
}

/** Data access for season windows and season XP from the ledger. */
export class SeasonRepo {
  readonly t: JarvisTables;

  constructor(
    readonly db: LegionDb,
    readonly guildId: string,
    private readonly clock: Clock,
  ) {
    this.t = jarvisTables(db);
  }

  now = () => this.clock.now().toISOString();

  async season(id: string, ex: Executor = this.db.orm): Promise<SeasonRow | null> {
    const s = this.t.jarvisSeasons;
    const [row] = await ex.select().from(s).where(eq(s.id, id)).limit(1);
    return row ?? null;
  }

  async findStatus(status: SeasonStatus, ex: Executor = this.db.orm): Promise<SeasonRow | null> {
    const s = this.t.jarvisSeasons;
    const [row] = await ex
      .select()
      .from(s)
      .where(and(eq(s.guildId, this.guildId), eq(s.status, status)))
      .orderBy(desc(s.startsAt))
      .limit(1);
    return row ?? null;
  }

  async latestEnded(ex: Executor = this.db.orm): Promise<SeasonRow | null> {
    const s = this.t.jarvisSeasons;
    const [row] = await ex
      .select()
      .from(s)
      .where(and(eq(s.guildId, this.guildId), eq(s.status, 'ended')))
      .orderBy(desc(s.endsAt))
      .limit(1);
    return row ?? null;
  }

  async insert(
    row: { id: string; startsAt: string; endsAt: string },
    ex: Executor = this.db.orm,
  ): Promise<boolean> {
    const s = this.t.jarvisSeasons;
    const now = this.now();
    const rows = await ex
      .insert(s)
      .values({
        ...row,
        guildId: this.guildId,
        status: 'scheduled',
        winners: null,
        archive: null,
        resultMessageId: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: s.id });
    return rows.length > 0;
  }

  async transition(
    id: string,
    from: SeasonStatus[],
    to: SeasonStatus,
    set: Partial<Pick<SeasonRow, 'startsAt' | 'endsAt' | 'winners' | 'archive' | 'resultMessageId'>>,
    ex: Executor,
  ): Promise<SeasonRow | null> {
    const s = this.t.jarvisSeasons;
    const [row] = await ex
      .update(s)
      .set({ ...set, status: to, updatedAt: this.now() })
      .where(and(eq(s.id, id), inArray(s.status, from)))
      .returning();
    return row ?? null;
  }

  async setWinners(id: string, winners: SeasonWinner[], ex: Executor = this.db.orm): Promise<void> {
    const s = this.t.jarvisSeasons;
    await ex
      .update(s)
      .set({ winners: JSON.stringify(winners), updatedAt: this.now() })
      .where(eq(s.id, id));
  }

  async setArchive(id: string, archive: SeasonArchive, ex: Executor = this.db.orm): Promise<void> {
    const s = this.t.jarvisSeasons;
    await ex
      .update(s)
      .set({ archive: JSON.stringify(archive), updatedAt: this.now() })
      .where(eq(s.id, id));
  }

  /**
   * Season XP: sum of `jarvis_xp_ledger.amount` with `created_at` in `[startsAt, endsAt)`.
   * Highest first; ties broken by memberId.
   */
  async scoreboard(
    startsAt: string,
    endsAt: string,
    memberIds?: string[],
    ex: Executor = this.db.orm,
  ): Promise<SeasonScore[]> {
    const l = this.t.jarvisXpLedger;
    const conds = [eq(l.guildId, this.guildId), gte(l.createdAt, startsAt), lt(l.createdAt, endsAt)];
    if (memberIds) conds.push(inArray(l.memberId, memberIds.length ? memberIds : ['']));
    const total = sum(l.amount);
    const rows = await ex
      .select({ memberId: l.memberId, xp: total })
      .from(l)
      .where(and(...conds))
      .groupBy(l.memberId)
      .orderBy(desc(total), l.memberId);
    return rows.map((r) => ({ memberId: r.memberId, xp: Number(r.xp ?? 0) })).filter((r) => r.xp > 0);
  }

  /** Used when staff start needs a free `(guild_id, starts_at)`. */
  async hasStartsAt(startsAt: string, ex: Executor = this.db.orm): Promise<boolean> {
    const s = this.t.jarvisSeasons;
    const [hit] = await ex
      .select({ id: s.id })
      .from(s)
      .where(and(eq(s.guildId, this.guildId), eq(s.startsAt, startsAt)))
      .limit(1);
    return !!hit;
  }

  /** Insert place badges; duplicates of `(season_id, member_id)` are ignored. */
  async insertBadges(
    seasonId: string,
    winners: SeasonWinner[],
    newId: () => string,
    ex: Executor = this.db.orm,
  ): Promise<number> {
    if (!winners.length) return 0;
    const b = this.t.jarvisSeasonBadges;
    const now = this.now();
    const rows = await ex
      .insert(b)
      .values(
        winners.map((w) => ({
          id: newId(),
          guildId: this.guildId,
          seasonId,
          memberId: w.memberId,
          place: w.place,
          xp: w.xp,
          createdAt: now,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: b.id });
    return rows.length;
  }

  async badgesForMember(memberId: string, ex: Executor = this.db.orm): Promise<SeasonBadgeRow[]> {
    const b = this.t.jarvisSeasonBadges;
    return ex
      .select()
      .from(b)
      .where(and(eq(b.guildId, this.guildId), eq(b.memberId, memberId)))
      .orderBy(asc(b.place), desc(b.createdAt));
  }

  async badgesForSeason(seasonId: string, ex: Executor = this.db.orm): Promise<SeasonBadgeRow[]> {
    const b = this.t.jarvisSeasonBadges;
    return ex
      .select()
      .from(b)
      .where(and(eq(b.guildId, this.guildId), eq(b.seasonId, seasonId)))
      .orderBy(asc(b.place));
  }
}
