// Credits (v0.10, US-14, ADR 0028): an append-only ledger plus a cached balance, like XP. Every
// movement has a unique source key, so a repeated payout is a no-op. No real money anywhere.
import { type BotContext, type Executor, localDay } from '@legion/core';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { JarvisConfig } from './config.js';
import type { JarvisRepo } from './db/repo.js';
import type { JarvisTables } from './db/tables.js';

export type WalletRow = JarvisTables['jarvisWallets']['$inferSelect'];
export type WalletLedgerRow = JarvisTables['jarvisWalletLedger']['$inferSelect'];
export const CREDIT_REASONS = ['mission', 'trivia', 'world_event', 'purchase', 'staff'] as const;
export type CreditReason = (typeof CREDIT_REASONS)[number];

export interface MoveInput {
  memberId: string;
  amount: number;
  reason: CreditReason;
  sourceKey: string;
  note?: string | null;
  createdBy?: string | null;
}
export interface MoveResult {
  duplicate: boolean;
  balance: number;
}

/** A debit larger than the balance. Thrown inside the transaction, so nothing is written. */
export class InsufficientCredits extends Error {
  constructor(
    readonly balance: number,
    readonly amount: number,
  ) {
    super(`insufficient credits: balance ${balance}, needed ${amount}`);
    this.name = 'InsufficientCredits';
  }
}

export class WalletService {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    private readonly repo: JarvisRepo,
  ) {}

  private get t() {
    return this.repo.t;
  }

  private today = () => localDay(this.ctx.clock.now(), this.ctx.config.timezone);

  /** Adds credits. A repeated `sourceKey` changes nothing and returns `duplicate: true`. */
  credit(tx: Executor, i: MoveInput): Promise<MoveResult> {
    if (!Number.isInteger(i.amount) || i.amount <= 0)
      throw new RangeError(`credit must be > 0, got ${i.amount}`);
    return this.move(tx, i);
  }

  /** Removes credits; throws `InsufficientCredits` when the balance is too small (nothing written). */
  debit(tx: Executor, i: MoveInput): Promise<MoveResult> {
    if (!Number.isInteger(i.amount) || i.amount <= 0)
      throw new RangeError(`debit must be > 0, got ${i.amount}`);
    return this.move(tx, { ...i, amount: -i.amount });
  }

  private async move(tx: Executor, i: MoveInput): Promise<MoveResult> {
    const w = this.t.jarvisWallets;
    const now = this.repo.now();
    // The wallet row is created lazily on the first movement.
    await tx
      .insert(w)
      .values({ memberId: i.memberId, guildId: this.repo.guildId, balance: 0, updatedAt: now })
      .onConflictDoNothing();
    const inserted = await tx
      .insert(this.t.jarvisWalletLedger)
      .values({
        id: this.ctx.newId(),
        guildId: this.repo.guildId,
        memberId: i.memberId,
        amount: i.amount,
        reason: i.reason,
        note: i.note ?? null,
        sourceKey: i.sourceKey,
        createdBy: i.createdBy ?? null,
        day: this.today(),
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: this.t.jarvisWalletLedger.id });
    if (!inserted.length) return { duplicate: true, balance: await this.balanceOf(i.memberId, tx) };
    // One atomic update (row lock on Postgres); a debit only applies when the balance covers it.
    const [row] = await tx
      .update(w)
      .set({ balance: sql`${w.balance} + ${i.amount}`, updatedAt: now })
      .where(and(eq(w.memberId, i.memberId), i.amount < 0 ? gte(w.balance, -i.amount) : undefined))
      .returning({ balance: w.balance });
    if (!row) throw new InsufficientCredits(await this.balanceOf(i.memberId, tx), -i.amount);
    return { duplicate: false, balance: row.balance };
  }

  async balanceOf(memberId: string, ex: Executor = this.repo.db.orm): Promise<number> {
    const w = this.t.jarvisWallets;
    const [row] = await ex.select({ b: w.balance }).from(w).where(eq(w.memberId, memberId)).limit(1);
    return row?.b ?? 0;
  }

  /** Newest first. */
  async history(memberId: string, limit = 10, ex: Executor = this.repo.db.orm): Promise<WalletLedgerRow[]> {
    const l = this.t.jarvisWalletLedger;
    return ex
      .select()
      .from(l)
      .where(eq(l.memberId, memberId))
      .orderBy(desc(l.createdAt), desc(l.id))
      .limit(limit);
  }

  /** Whether payouts are on (`jarvis.economy.enabled`). */
  get enabled(): boolean {
    return this.ctx.botConfig.economy.enabled;
  }
}
