import type { BotContext, Executor, Rank } from '@legion/core';
import { localDay } from '@legion/core';
import type { JarvisConfig } from './config.js';
import type { JarvisRepo, ProgressRow } from './db/repo.js';
import { advanceStreak, countsForStreak, levelFor, rankFor, type XpReason } from './domain/xp.js';

export interface AwardInput {
  memberId: string;
  amount: number;
  reason: XpReason;
  note?: string | null;
  sourceKey: string;
  /** Trivia XP counts toward the daily cap. */
  trivia?: boolean;
}

export interface AwardResult {
  duplicate: boolean;
  progress: ProgressRow | null;
  streakBonus: number;
  levelFrom: number;
  rankFrom: Rank;
}

/**
 * The single XP write path (ADR 0013). Runs inside the caller's bus transaction: ledger entry,
 * progress update, streak bonus, and the xp.awarded / level.changed / rank.changed /
 * streak.updated events all commit together or not at all.
 */
export class XpService {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    readonly repo: JarvisRepo,
  ) {}

  today = () => localDay(this.ctx.clock.now(), this.ctx.config.timezone);

  async award(tx: Executor, i: AwardInput): Promise<AwardResult> {
    const day = this.today();
    await this.repo.ensureProgress(i.memberId, tx);
    const inserted = await this.repo.insertLedger(
      {
        memberId: i.memberId,
        amount: i.amount,
        reason: i.reason,
        note: i.note ?? null,
        sourceKey: i.sourceKey,
        day,
      },
      tx,
    );
    if (!inserted) {
      return {
        duplicate: true,
        progress: await this.repo.progress(i.memberId, tx),
        streakBonus: 0,
        levelFrom: 0,
        rankFrom: 'recruta',
      };
    }
    let row = await this.repo.addXp(i.memberId, i.amount, tx); // locks the row
    const before = { xp: row.xp - i.amount, level: row.level, rank: row.rank as Rank };
    if (i.amount > 0) await this.emitAwarded(tx, i.memberId, i.amount, i.reason, row.xp, i.sourceKey);

    if (i.trivia) {
      const today = row.triviaXpDay === day ? row.triviaXpToday : 0;
      await this.repo.updateProgress(i.memberId, { triviaXpDay: day, triviaXpToday: today + i.amount }, tx);
    }

    let streakBonus = 0;
    if (countsForStreak(i.reason) && i.amount > 0) {
      const next = advanceStreak(row, day, this.ctx.botConfig.streak);
      if (next) {
        await this.repo.updateProgress(i.memberId, next.state, tx);
        const key = `streak:${i.memberId}:${day}`;
        if (
          await this.repo.insertLedger(
            { memberId: i.memberId, amount: next.bonus, reason: 'streak_bonus', sourceKey: key, day },
            tx,
          )
        ) {
          streakBonus = next.bonus;
          row = await this.repo.addXp(i.memberId, next.bonus, tx);
          await this.emitAwarded(tx, i.memberId, next.bonus, 'streak_bonus', row.xp, key);
        }
        await this.ctx.bus.emit(tx, 'streak.updated', {
          memberId: i.memberId,
          streak: next.state.currentStreak,
          day,
        });
      }
    }

    row = await this.settle(tx, i.memberId, before);
    return { duplicate: false, progress: row, streakBonus, levelFrom: before.level, rankFrom: before.rank };
  }

  /** Recomputes level and rank from xp and emits level.changed / rank.changed once per crossing. */
  private async settle(
    tx: Executor,
    memberId: string,
    before: { level: number; rank: Rank },
  ): Promise<ProgressRow> {
    const row = await this.repo.progress(memberId, tx);
    if (!row) throw new Error(`no progress row for ${memberId}`);
    const level = levelFor(row.xp, this.ctx.botConfig.levels);
    const rank = rankFor(row.xp, this.ctx.botConfig.ranks);
    if (level !== row.level || rank !== row.rank)
      await this.repo.updateProgress(memberId, { level, rank }, tx);
    if (level !== before.level)
      await this.ctx.bus.emit(tx, 'level.changed', { memberId, from: before.level, to: level });
    if (rank !== before.rank) {
      const member = await this.ctx.read.members.getById(memberId);
      if (member)
        await this.ctx.bus.emit(tx, 'rank.changed', {
          memberId,
          discordUserId: member.discordUserId,
          from: before.rank,
          to: rank,
        });
      else this.ctx.log.warn({ memberId }, 'rank changed for an unknown member; rank.changed not emitted');
    }
    return { ...row, level, rank };
  }

  private emitAwarded(
    tx: Executor,
    memberId: string,
    amount: number,
    reason: string,
    totalXp: number,
    sourceKey: string,
  ) {
    return this.ctx.bus.emit(tx, 'xp.awarded', {
      memberId,
      amount,
      reason,
      totalXp,
      level: levelFor(totalXp, this.ctx.botConfig.levels),
      sourceKey,
    });
  }

  /** Rebuilds progress from the ledger (staff `/jarvis recalcular`). Emits rank/level changes if they move. */
  async recalculate(memberId: string): Promise<{ before: ProgressRow | null; after: ProgressRow }> {
    return this.ctx.bus.transaction(async (tx) => {
      await this.repo.ensureProgress(memberId, tx);
      const before = await this.repo.progress(memberId, tx);
      const rebuilt = rebuildFromLedger(await this.repo.ledgerFor(memberId, tx), this.ctx.botConfig);
      await this.repo.updateProgress(memberId, rebuilt, tx);
      const after = await this.settle(tx, memberId, {
        level: before?.level ?? 1,
        rank: (before?.rank as Rank) ?? 'recruta',
      });
      return { before, after };
    });
  }
}

/** Progress derived purely from ledger rows (ADR 0012). */
export function rebuildFromLedger(
  rows: { amount: number; reason: string; day: string }[],
  cfg: JarvisConfig,
): Pick<
  ProgressRow,
  'xp' | 'level' | 'rank' | 'currentStreak' | 'bestStreak' | 'lastActiveDay' | 'triviaXpToday' | 'triviaXpDay'
> {
  let xp = 0;
  let streak = { currentStreak: 0, bestStreak: 0, lastActiveDay: null as string | null };
  let triviaXpDay: string | null = null;
  let triviaXpToday = 0;
  for (const r of rows) {
    xp += r.amount;
    if (r.amount > 0 && countsForStreak(r.reason as XpReason)) {
      const next = advanceStreak(streak, r.day, cfg.streak);
      if (next) streak = next.state;
    }
    if (r.reason === 'trivia') {
      triviaXpToday = triviaXpDay === r.day ? triviaXpToday + r.amount : r.amount;
      triviaXpDay = r.day;
    }
  }
  return {
    xp,
    level: levelFor(xp, cfg.levels),
    rank: rankFor(xp, cfg.ranks),
    ...streak,
    triviaXpToday,
    triviaXpDay,
  };
}
