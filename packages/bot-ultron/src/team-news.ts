import type { BotContext, LegionEvent } from '@legion/core';
import type { UltronConfig } from './config.js';
import type { WarService } from './war.js';

export const TEAM_NEWS_JOB = 'ultron.team-news';
/** Standings at most once an hour, only when the board changed (D34). */
export const TEAM_NEWS_CRON = '23 * * * *';
const LAST_KEY = 'ultron.teamNews.lastStandings';
const WARN_EVERY_MS = 3_600_000;

interface Last {
  warId: string;
  board: string;
}

/**
 * Team news (US-34): each team's `factions[].newsChannelId` gets its own war standing, the war result
 * and the result of each world event. A team without the key gets nothing; a channel that fails is
 * skipped and logged at most once an hour.
 */
export class TeamNews {
  private warnedAt = new Map<string, number>();
  constructor(
    private readonly ctx: BotContext<UltronConfig>,
    private readonly war: WarService,
  ) {}

  private t = (key: string, vars: Record<string, string | number> = {}) =>
    this.ctx.i18n.t(`ultron.team_news.${key}`, vars, this.ctx.config.locale);

  private channels(): { faction: string; channelId: string }[] {
    return this.ctx.config.factions
      .filter((f) => f.newsChannelId)
      .map((f) => ({ faction: f.key, channelId: f.newsChannelId as string }));
  }

  private async post(channelId: string, content: string): Promise<void> {
    try {
      await this.ctx.gateway.sendMessage(channelId, {
        persona: 'ultron',
        content,
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      const now = this.ctx.clock.now().getTime();
      if (now - (this.warnedAt.get(channelId) ?? 0) < WARN_EVERY_MS) return;
      this.warnedAt.set(channelId, now);
      this.ctx.log.warn({ err, channelId }, 'team news not posted');
    }
  }

  /** Hourly: each team's place and gap, when the board changed since the last post. */
  async standings(): Promise<void> {
    const targets = this.channels();
    if (!targets.length) return;
    const active = await this.war.repo.findStatus('active');
    if (!active) return;
    const scores = [...(await this.war.repo.scores(active.id))].sort(
      (a, b) => b.points - a.points || a.faction.localeCompare(b.faction),
    );
    if (!scores.length) return;
    const board = scores.map((s) => `${s.faction}:${s.points}`).join(',');
    const last = await this.ctx.kv.get<Last>(LAST_KEY);
    if (last?.warId === active.id && last.board === board) return;
    await this.ctx.kv.set(LAST_KEY, { warId: active.id, board } satisfies Last);
    for (const { faction, channelId } of targets) {
      const i = scores.findIndex((s) => s.faction === faction);
      const me = scores[i];
      if (!me) {
        await this.post(channelId, this.t('no_points'));
        continue;
      }
      const leader = scores[0];
      const next = scores[1];
      const content =
        i === 0
          ? this.t('leading', {
              points: me.points,
              gap: me.points - (next?.points ?? 0),
              other: next ? this.war.factionLabel(next.faction) : '—',
            })
          : this.t('behind', {
              place: i + 1,
              points: me.points,
              gap: (leader?.points ?? 0) - me.points,
              other: this.war.factionLabel(leader?.faction ?? ''),
            });
      await this.post(channelId, content);
    }
  }

  /** `war.ended`: each team learns if it won, or its place. */
  async onWarEnded(e: LegionEvent<'war.ended'>): Promise<void> {
    const scores = [...e.payload.scores].sort(
      (a, b) => b.points - a.points || a.faction.localeCompare(b.faction),
    );
    const winners = e.payload.winners.map((w) => this.war.factionLabel(w)).join(', ') || '—';
    for (const { faction, channelId } of this.channels()) {
      const i = scores.findIndex((s) => s.faction === faction);
      const points = scores[i]?.points ?? 0;
      await this.post(
        channelId,
        e.payload.winners.includes(faction)
          ? this.t('war_won', { points })
          : i < 0
            ? this.t('war_ended_none', { winners })
            : this.t('war_ended', { place: i + 1, points, winners }),
      );
    }
  }

  /** `world.event` ended: the outcome and how many heroes of each team took part. */
  async onWorldEvent(e: LegionEvent<'world.event'>): Promise<void> {
    const p = e.payload;
    if (p.phase !== 'ended' || !p.outcome) return;
    const targets = this.channels();
    if (!targets.length) return;
    const per = new Map<string, number>();
    for (const id of p.participantMemberIds) {
      const m = await this.ctx.read.members.getById(id);
      if (m?.faction) per.set(m.faction, (per.get(m.faction) ?? 0) + 1);
    }
    const outcome = this.t(p.outcome);
    for (const { faction, channelId } of targets)
      await this.post(channelId, this.t('event', { title: p.title, outcome, count: per.get(faction) ?? 0 }));
  }
}
