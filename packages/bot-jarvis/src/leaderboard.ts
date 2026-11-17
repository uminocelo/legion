import type { BotContext, IncomingInteraction, Locale, OutgoingMessage, Responder } from '@legion/core';
import { addDays } from '@legion/core';
import type { JarvisConfig } from './config.js';
import { type Period, periodStart } from './domain/periods.js';
import { advanceStreak, displayedStreak, levelFor } from './domain/xp.js';
import type { JarvisServices } from './services.js';
import type { JarvisUi } from './ui.js';

export interface RankingRow {
  memberId: string;
  discordUserId: string;
  codename: string;
  faction: string | null;
  xp: number;
  level: number;
}

export class JarvisLeaderboard {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    private readonly s: JarvisServices,
    private readonly ui: JarvisUi,
  ) {}

  /** Ranked members for a period: XP summed from the ledger, members who left are hidden. */
  async rows(period: Period, faction: string | null): Promise<RankingRow[]> {
    const members = await this.ctx.read.members.listRegistered(faction ? { faction } : {});
    const byId = new Map(members.filter((m) => !m.leftAt).map((m) => [m.id, m]));
    const totals = (
      await this.s.repo.xpTotals(periodStart(period, this.s.xp.today()), [...byId.keys()])
    ).filter((t) => byId.has(t.memberId));
    const progress = new Map(
      (await this.s.repo.progressMany(totals.map((t) => t.memberId))).map((p) => [p.memberId, p]),
    );
    const out: RankingRow[] = [];
    for (const t of totals) {
      const m = byId.get(t.memberId);
      if (!m) continue;
      const mutant = await this.ctx.read.mutants.getByMemberId(m.id);
      out.push({
        memberId: m.id,
        discordUserId: m.discordUserId,
        codename: mutant?.codename ?? `<@${m.discordUserId}>`,
        faction: m.faction,
        xp: t.xp,
        level: progress.get(m.id)?.level ?? levelFor(t.xp, this.ctx.botConfig.levels),
      });
    }
    return out;
  }

  private emoji(faction: string | null): string {
    return this.ctx.config.factions.find((f) => f.key === faction)?.emoji ?? '▫️';
  }

  private factionName(key: string, l: Locale): string {
    const k = `cerebro.faction.${key}.name`;
    const v = this.ctx.i18n.t(k, {}, l);
    return v === k ? key : v;
  }

  async render(
    period: Period,
    faction: string | null,
    callerUserId: string,
    l: Locale,
  ): Promise<OutgoingMessage> {
    const rows = await this.rows(period, faction);
    const size = this.ctx.botConfig.leaderboard.size;
    const t = this.ui.t;
    const periodLabel = t(`jarvis.ranking.period.${period}`, {}, l);
    const title = faction
      ? t('jarvis.ranking.title_faction', { period: periodLabel, faction: this.factionName(faction, l) }, l)
      : t('jarvis.ranking.title', { period: periodLabel }, l);
    const lines = rows
      .slice(0, size)
      .map((r, i) =>
        t(
          'jarvis.ranking.line',
          { pos: i + 1, emoji: this.emoji(r.faction), codename: r.codename, xp: r.xp, level: r.level },
          l,
        ),
      );
    const me = rows.findIndex((r) => r.discordUserId === callerUserId);
    const you =
      me >= 0
        ? t('jarvis.ranking.you', { pos: me + 1, xp: rows[me]?.xp ?? 0 }, l)
        : t('jarvis.ranking.you_none', {}, l);
    const factionTotals = new Map<string, number>();
    for (const r of rows)
      if (r.faction) factionTotals.set(r.faction, (factionTotals.get(r.faction) ?? 0) + r.xp);
    const totals = this.ctx.config.factions
      .map((f) => `${f.emoji} ${this.factionName(f.key, l)} ${factionTotals.get(f.key) ?? 0}`)
      .join(' · ');
    return {
      persona: 'jarvis',
      embeds: [
        {
          title,
          description: [lines.length ? lines.join('\n') : t('jarvis.ranking.empty', {}, l), '', you].join(
            '\n',
          ),
          footer: { text: t('jarvis.ranking.factions', { totals }, l) },
        },
      ],
    };
  }

  /** `/ranking`: public, with a per-channel cooldown. */
  async command(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const cd = this.ctx.botConfig.leaderboard.channelCooldownSeconds;
    const limit = await this.ctx.rateLimiter.consume(`jarvis:ranking:${i.channelId}`, 1, cd * 1000);
    if (!limit.allowed)
      return r.reply(
        this.ui.text(
          this.ui.t('jarvis.errors.ranking_cooldown', { seconds: Math.ceil(limit.retryAfterMs / 1000) }, l),
        ),
      );
    const period = (['semana', 'mes', 'total'] as const).find((p) => p === i.options?.periodo) ?? 'semana';
    const faction = typeof i.options?.faccao === 'string' ? i.options.faccao : null;
    await r.reply(await this.render(period, faction, i.userId, l));
  }

  /** `/sequencia`: current and best streak, today's status, tomorrow's bonus. */
  async streak(memberId: string, l: Locale): Promise<OutgoingMessage> {
    const p = await this.s.repo.progress(memberId);
    const today = this.s.xp.today();
    const state = {
      currentStreak: p?.currentStreak ?? 0,
      bestStreak: p?.bestStreak ?? 0,
      lastActiveDay: p?.lastActiveDay ?? null,
    };
    const current = displayedStreak(state, today);
    const doneToday = state.lastActiveDay === today;
    // Tomorrow's bonus assumes today is (or becomes) active.
    const base = doneToday ? state : (advanceStreak(state, today, this.ctx.botConfig.streak)?.state ?? state);
    const tomorrow = advanceStreak(base, addDays(today, 1), this.ctx.botConfig.streak);
    const t = this.ui.t;
    return {
      persona: 'jarvis',
      ephemeral: true,
      embeds: [
        {
          title: t('jarvis.streak.title', {}, l),
          fields: [
            {
              name: t('jarvis.streak.current', {}, l),
              value: t('jarvis.streak.days', { count: current }, l),
              inline: true,
            },
            {
              name: t('jarvis.streak.best', {}, l),
              value: t('jarvis.streak.days', { count: state.bestStreak }, l),
              inline: true,
            },
          ],
          description: [
            t(doneToday ? 'jarvis.streak.today_done' : 'jarvis.streak.today_pending', {}, l),
            t('jarvis.streak.tomorrow', { bonus: tomorrow?.bonus ?? 0 }, l),
          ].join('\n'),
        },
      ],
    };
  }
}
