import type { BotContext, LegionEvent, RateLimiter, RateLimitResult, RatePolicy } from '@legion/core';
import { coreTables } from '@legion/core';
import { and, eq, gte } from 'drizzle-orm';
import type { SentinelConfig } from './config.js';
import type { SafetyRepo } from './db/safety-repo.js';

const TEN_MIN = 10 * 60_000;
const HOUR = 3_600_000;
type FlagReason = 'rate_limit' | 'xp_anomaly' | 'new_account';

/** DB-backed fixed-window limiter for every bot, plus violation tracking and anti-cheat signals. */
export class SafetyService implements RateLimiter {
  constructor(
    private readonly ctx: BotContext<SentinelConfig>,
    private readonly repo: SafetyRepo,
  ) {}

  private nowMs = () => this.ctx.clock.now().getTime();
  private hourBucket = () => new Date(this.nowMs() - (this.nowMs() % HOUR)).toISOString();

  // ---------- RateLimiter ----------

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.nowMs();
    const start = now - (now % windowMs);
    const count = await this.repo.hit(`${key}@${windowMs}`, new Date(start).toISOString());
    if (count <= limit) return { allowed: true, retryAfterMs: 0 };
    const [policy, userId] = key.split(':');
    if (policy && userId && /^\d+$/.test(userId)) await this.violation(userId, policy);
    return { allowed: false, retryAfterMs: start + windowMs - now };
  }

  /** Staff (and the guild owner) are never limited; everyone else gets the configured limits. */
  async policyFor(i: {
    userId: string;
    isGuildOwner: boolean;
    memberRoleIds: string[];
    inDm?: boolean;
  }): Promise<RatePolicy> {
    const staff = !i.inDm && (await this.ctx.isStaff(i));
    const { commandsPerMinute, componentsPer10Seconds } = this.ctx.botConfig.rateLimits;
    return { bypass: staff, commandsPerMinute, componentsPer10Seconds };
  }

  private async violation(discordUserId: string, policy: string) {
    await this.repo.addViolation(discordUserId, policy);
    const n = await this.repo.violationsSince(discordUserId, new Date(this.nowMs() - TEN_MIN).toISOString());
    if (n >= this.ctx.botConfig.rateLimits.violationsToFlag)
      await this.flag(
        discordUserId,
        'rate_limit',
        'medium',
        this.ctx.i18n.t('sentinel.flags.rate_limit', { n }, this.ctx.config.locale),
        { policy },
      );
  }

  /** Emits `report.flagged` at most once per member, reason and hour. */
  async flag(
    subject: string,
    reason: FlagReason,
    severity: 'low' | 'medium',
    details: string,
    refs: Record<string, string> = {},
  ) {
    if (!(await this.repo.claimFlag(subject, reason, this.hourBucket()))) return false;
    await this.ctx.bus.emit(this.ctx.db.orm, 'report.flagged', {
      reportId: this.ctx.newId(),
      reporter: 'sentinel',
      reporterDiscordUserId: null,
      subjectDiscordUserId: subject,
      reason,
      severity,
      details: details.slice(0, 500),
      refs,
    });
    return true;
  }

  // ---------- watchers ----------

  /** `sentinel.xp-watch`: XP earned in the last hour (staff adjustments excluded) above the limit. */
  async onXp(e: LegionEvent<'xp.awarded'>) {
    if (e.payload.amount <= 0) return;
    const log = coreTables(this.ctx.db).coreEventLog;
    const since = new Date(new Date(e.occurredAt).getTime() - HOUR).toISOString();
    const rows = await this.ctx.db.orm
      .select({ payload: log.payload })
      .from(log)
      .where(and(eq(log.type, 'xp.awarded'), gte(log.occurredAt, since)));
    let total = 0;
    for (const r of rows) {
      const p = JSON.parse(r.payload) as { memberId: string; amount: number; reason: string };
      if (p.memberId === e.payload.memberId && p.amount > 0 && p.reason !== 'admin_adjust') total += p.amount;
    }
    const limit = this.ctx.botConfig.antiCheat.xpAnomalyPerHour;
    if (total <= limit) return;
    const m = await this.ctx.read.members.getById(e.payload.memberId);
    if (!m) return;
    await this.flag(
      m.discordUserId,
      'xp_anomaly',
      'medium',
      this.ctx.i18n.t('sentinel.flags.xp_anomaly', { xp: total, limit }, this.ctx.config.locale),
      {
        memberId: m.id,
      },
    );
  }

  /** `sentinel.join-watch`: a young account is a signal, never a block. */
  async onJoin(e: LegionEvent<'member.joined'>) {
    const days = this.ctx.botConfig.antiCheat.newAccountDays;
    const age = new Date(e.occurredAt).getTime() - new Date(e.payload.accountCreatedAt).getTime();
    if (days <= 0 || age >= days * 86_400_000) return;
    await this.flag(
      e.payload.discordUserId,
      'new_account',
      'low',
      this.ctx.i18n.t(
        'sentinel.flags.new_account',
        { days: Math.max(0, Math.floor(age / 86_400_000)) },
        this.ctx.config.locale,
      ),
      {
        accountCreatedAt: e.payload.accountCreatedAt,
      },
    );
  }

  /** Daily job: old windows, violations and flag slots. */
  async prune() {
    const day = new Date(this.nowMs() - 86_400_000).toISOString();
    const week = new Date(this.nowMs() - 7 * 86_400_000).toISOString();
    await this.repo.prune(day, week);
  }
}
