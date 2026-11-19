import type { BotContext, Executor, LegionEvent, Locale, OutgoingMessage } from '@legion/core';
import { shownFaction } from '@legion/core';
import { and, eq } from 'drizzle-orm';
import type { UltronConfig } from './config.js';
import { pickWinners, type WarReason, type WarRepo, type WarRow } from './db/war-repo.js';
import { monthStartAtOrAfter, nextWarWindow } from './domain/war-window.js';

export const WAR_JOBS = {
  start: 'ultron.war.start',
  end: 'ultron.war.end',
  plan: 'ultron.war.plan',
} as const;

/** Stored faction key for Independente. They never score. */
export const INDEPENDENT_FACTION = 'independent';

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const DAY_MS = 86_400_000;

export type StaffStart = 'started' | 'active' | 'disabled';
export type StaffEnd = 'ended' | 'none' | 'disabled';
export type StaffPointsError =
  | 'range'
  | 'zero'
  | 'note'
  | 'missing'
  | 'left'
  | 'independent'
  | 'no_war'
  | 'disabled'
  | 'duplicate';

/**
 * Faction war: one scheduled window per guild, a points ledger, and `war.ended` when it closes.
 * ULTRON never writes the wallet. J.A.R.V.I.S. pays from the event.
 */
export class WarService {
  constructor(
    private readonly ctx: BotContext<UltronConfig>,
    readonly repo: WarRepo,
  ) {}

  private get cfg() {
    return this.ctx.botConfig.war;
  }
  private now = () => this.ctx.clock.now();
  private t = (key: string, vars: Record<string, string | number> = {}, l?: Locale) =>
    this.ctx.i18n.t(key, vars, l ?? this.ctx.config.locale);

  /** Next window when none is scheduled or active. No-op while the war is disabled. */
  async planNext(): Promise<void> {
    if (!this.cfg.enabled) return;
    if ((await this.repo.findStatus('active')) || (await this.repo.findStatus('scheduled'))) return;
    const prev = await this.repo.latestEnded();
    const window = nextWarWindow({
      length: this.cfg.length,
      timeZone: this.ctx.config.timezone,
      now: this.now(),
      previousEndsAt: prev ? new Date(prev.endsAt) : null,
    });
    const id = this.ctx.newId();
    await this.ctx.db.transaction(async (tx) => {
      const ok = await this.repo.insert(
        { id, startsAt: window.startsAt.toISOString(), endsAt: window.endsAt.toISOString() },
        tx,
      );
      if (!ok) return;
      const s = this.ctx.scheduler;
      await s.enqueue(
        WAR_JOBS.start,
        { id },
        { runAt: window.startsAt, dedupeKey: `${WAR_JOBS.start}:${id}` },
        tx,
      );
      await s.enqueue(WAR_JOBS.end, { id }, { runAt: window.endsAt, dedupeKey: `${WAR_JOBS.end}:${id}` }, tx);
    });
  }

  /** `ultron.war.start`: scheduled → active, once. */
  async startJob(id: string): Promise<void> {
    await this.ctx.db.transaction(async (tx) => {
      await this.repo.transition(id, ['scheduled'], 'active', {}, tx);
    });
  }

  /**
   * `ultron.war.end`. The status change and `war.ended` commit together.
   * The result post happens after that, and a retry posts only if the message id is still empty.
   */
  async end(id: string, opts?: { endsAt?: string }): Promise<void> {
    const current = await this.repo.war(id);
    if (!current || current.status === 'cancelled') return;
    if (current.status === 'scheduled') await this.startJob(id);
    const row = await this.repo.war(id);
    if (row?.status === 'active') {
      const endsAt = opts?.endsAt ?? row.endsAt;
      await this.ctx.bus.transaction(async (tx) => {
        const ended = await this.repo.transition(id, ['active'], 'ended', { endsAt }, tx);
        if (!ended) return;
        const scores = (await this.repo.scores(id, tx)).map((s) => ({
          faction: s.faction,
          points: Math.trunc(s.points),
          members: Math.trunc(s.members),
        }));
        const winners = pickWinners(scores);
        const winnerMemberIds = await this.repo.membersOf(id, winners, tx);
        await this.repo.setWinners(id, winners, tx);
        await this.ctx.bus.emit(tx, 'war.ended', {
          warId: id,
          startsAt: ended.startsAt,
          endsAt,
          winners,
          scores,
          winnerMemberIds,
        });
      });
    }
    const done = await this.repo.war(id);
    if (done?.status === 'ended') await this.postResult(done);
    await this.planNext();
  }

  /** Staff: start now. A scheduled war is pulled forward instead of overlapping it. */
  async staffStart(): Promise<StaffStart> {
    if (!this.cfg.enabled) return 'disabled';
    if (await this.repo.findStatus('active')) return 'active';
    const now = await this.unusedStart(this.now());
    const endsAt = this.staffEndsAt(this.now());
    const scheduled = await this.repo.findStatus('scheduled');
    if (scheduled) {
      await this.activate(scheduled.id, now, endsAt);
      return 'started';
    }
    const id = this.ctx.newId();
    await this.ctx.db.transaction(async (tx) => {
      await this.repo.insert({ id, startsAt: now.toISOString(), endsAt: endsAt.toISOString() }, tx);
      await this.repo.transition(id, ['scheduled'], 'active', {}, tx);
      await this.ctx.scheduler.enqueue(
        WAR_JOBS.end,
        { id },
        { runAt: endsAt, dedupeKey: `${WAR_JOBS.end}:${id}` },
        tx,
      );
    });
    return 'started';
  }

  /** Staff: close the active war now, post the result, and plan the next one. */
  async staffEnd(): Promise<StaffEnd> {
    const active = await this.repo.findStatus('active');
    if (!active) return this.cfg.enabled ? 'none' : 'disabled';
    await this.end(active.id, { endsAt: this.now().toISOString() });
    return 'ended';
  }

  async staffPoints(o: {
    discordUserId: string;
    points: number;
    note: string;
    actorId: string;
    sourceKey: string;
  }): Promise<{ ok: true; points: number; faction: string } | { ok: false; error: StaffPointsError }> {
    if (!this.cfg.enabled) return { ok: false, error: 'disabled' };
    if (!Number.isInteger(o.points) || o.points < -1000 || o.points > 1000)
      return { ok: false, error: 'range' };
    if (o.points === 0) return { ok: false, error: 'zero' };
    const note = o.note.trim();
    if (!note || note.length > 200) return { ok: false, error: 'note' };
    const member = await this.ctx.read.members.getByDiscordId(o.discordUserId);
    if (member?.onboardingStep !== 'registered') return { ok: false, error: 'missing' };
    if (member.leftAt) return { ok: false, error: 'left' };
    if (!member.faction || member.faction === INDEPENDENT_FACTION) return { ok: false, error: 'independent' };
    const war = await this.repo.findStatus('active');
    if (!war) return { ok: false, error: 'no_war' };
    const inserted = await this.repo.addPoint({
      warId: war.id,
      memberId: member.id,
      faction: member.faction,
      points: o.points,
      reason: 'staff',
      sourceKey: o.sourceKey,
      createdBy: o.actorId,
      note,
    });
    return inserted
      ? { ok: true, points: o.points, faction: member.faction }
      : { ok: false, error: 'duplicate' };
  }

  /** Current faction, idempotent on `sourceKey`. Skips a disabled war, Independente, and members who left. */
  async score(
    memberId: string,
    points: number,
    reason: WarReason,
    sourceKey: string,
    ex?: Executor,
  ): Promise<boolean> {
    if (!this.cfg.enabled || !points) return false;
    const run = async (tx: Executor) => {
      const war = await this.repo.findStatus('active', tx);
      if (!war) return false;
      const member = await this.ctx.read.members.getById(memberId);
      if (!member || member.leftAt || member.onboardingStep !== 'registered') return false;
      if (!member.faction || member.faction === INDEPENDENT_FACTION) return false;
      return this.repo.addPoint(
        { warId: war.id, memberId, faction: member.faction, points, reason, sourceKey },
        tx,
      );
    };
    return ex ? run(ex) : this.ctx.db.transaction(run);
  }

  async scoreMission(p: LegionEvent<'mission.completed'>['payload']): Promise<void> {
    if (!this.cfg.enabled || p.outcome === 'abandoned') return;
    const points = p.outcome === 'success' ? this.cfg.points.missionSuccess : this.cfg.points.missionFailure;
    for (const memberId of p.memberIds)
      await this.score(memberId, points, 'mission', `war:mission:${p.runId}:${memberId}`);
  }

  async scoreStrike(memberId: string, combatId: string, ex?: Executor): Promise<void> {
    await this.score(memberId, this.cfg.points.strike, 'strike', `war:strike:${combatId}`, ex);
  }

  async scoreParticipation(eventId: string, memberIds: string[]): Promise<void> {
    const points = this.cfg.points.participation;
    for (const memberId of memberIds)
      await this.score(memberId, points, 'participation', `war:event:${eventId}:${memberId}`);
  }

  async playerView(discordUserId: string, locale: Locale): Promise<string> {
    const active = await this.repo.findStatus('active');
    if (!active) {
      const next = await this.repo.findStatus('scheduled');
      return next
        ? this.t('ultron.war.no_active_next', { at: `<t:${unix(next.startsAt)}:F>` }, locale)
        : this.t('ultron.war.no_active', {}, locale);
    }
    const scores = [...(await this.repo.scores(active.id))].sort(
      (a, b) => b.points - a.points || a.faction.localeCompare(b.faction),
    );
    const board = scores.length
      ? scores.map((s) => `**${this.factionLabel(s.faction)}** · ${s.points}`).join('\n')
      : this.t('ultron.war.no_points', {}, locale);
    const member = await this.ctx.read.members.getByDiscordId(discordUserId);
    const lines = [
      this.t('ultron.war.time_left', { at: `<t:${unix(active.endsAt)}:R>` }, locale),
      this.t('ultron.war.board_title', {}, locale),
      board,
    ];
    if (!member || member.leftAt || member.onboardingStep !== 'registered') {
      lines.push(this.t('ultron.war.register_first', {}, locale));
    } else {
      const mine = await this.repo.pointsOf(active.id, member.id, member.faction);
      lines.push(this.t('ultron.war.mine', { points: mine.mine }, locale));
      lines.push(
        this.t(
          'ultron.war.my_faction',
          { faction: this.factionLabel(member.faction ?? INDEPENDENT_FACTION), points: mine.faction },
          locale,
        ),
      );
    }
    return lines.join('\n');
  }

  /**
   * `(guild_id, starts_at)` is unique, so a second staff start in the same millisecond
   * (the ended war already holds that instant) moves forward by a millisecond.
   */
  private async unusedStart(preferred: Date): Promise<Date> {
    const w = this.repo.t.ultronWars;
    let at = preferred;
    for (let i = 0; i < 5; i++) {
      const [hit] = await this.repo.db.orm
        .select({ id: w.id })
        .from(w)
        .where(and(eq(w.guildId, this.ctx.guildId), eq(w.startsAt, at.toISOString())))
        .limit(1);
      if (!hit) return at;
      at = new Date(at.getTime() + 1);
    }
    return at;
  }

  /** A month war started by staff ends on the next 1st. A day length runs that many days from now. */
  private staffEndsAt(now: Date): Date {
    if (this.cfg.length === 'month')
      return monthStartAtOrAfter(new Date(now.getTime() + DAY_MS), this.ctx.config.timezone);
    return new Date(now.getTime() + this.cfg.length * DAY_MS);
  }

  private async activate(id: string, now: Date, endsAt: Date): Promise<void> {
    await this.ctx.db.transaction(async (tx) => {
      await this.ctx.scheduler.cancel(`${WAR_JOBS.start}:${id}`, tx);
      await this.ctx.scheduler.cancel(`${WAR_JOBS.end}:${id}`, tx);
      const row = await this.repo.transition(
        id,
        ['scheduled'],
        'active',
        { startsAt: now.toISOString(), endsAt: endsAt.toISOString() },
        tx,
      );
      if (!row) return;
      await this.ctx.scheduler.enqueue(
        WAR_JOBS.end,
        { id },
        { runAt: endsAt, dedupeKey: `${WAR_JOBS.end}:${id}` },
        tx,
      );
    });
  }

  factionLabel(stored: string): string {
    const key = shownFaction(this.ctx.config.factions, stored) ?? stored;
    const f = this.ctx.config.factions.find((x) => x.key === key);
    return `${f?.emoji ?? ''} ${this.ctx.config.roles.find((r) => r.key === f?.roleKey)?.name ?? key}`.trim();
  }

  private winnersOf(war: WarRow): string[] {
    if (!war.winners) return [];
    try {
      const parsed = JSON.parse(war.winners) as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private paysCredits(): boolean {
    if (!this.ctx.config.bots.includes('jarvis')) return false;
    const economy = (this.ctx.config.jarvis as { economy?: { enabled?: boolean } } | undefined)?.economy;
    return economy?.enabled !== false;
  }

  private async postResult(war: WarRow): Promise<void> {
    if (war.resultMessageId) return;
    const channel = this.ctx.config.channels.events;
    if (!channel) {
      this.ctx.log.warn({ id: war.id }, 'channels.events is empty; war result not posted');
      return;
    }
    const sent = await this.ctx.gateway.sendMessage(channel, await this.resultMessage(war));
    await this.repo.setResultMessage(war.id, sent.messageId);
  }

  private async resultMessage(war: WarRow): Promise<OutgoingMessage> {
    const winners = this.winnersOf(war);
    const scores = [...(await this.repo.scores(war.id))].sort(
      (a, b) => b.points - a.points || a.faction.localeCompare(b.faction),
    );
    const fields = await Promise.all(
      scores.map(async (s) => {
        const top = await this.repo.memberScores(war.id, s.faction);
        const lines = await Promise.all(
          top.slice(0, 3).map(async (row, n) => {
            const discordId = (await this.ctx.read.members.getById(row.memberId))?.discordUserId;
            return `${n + 1}. ${discordId ? `<@${discordId}>` : '?'} · ${row.points}`;
          }),
        );
        return {
          name: `${this.factionLabel(s.faction)} · ${s.points}`,
          value: lines.length ? lines.join('\n') : this.t('ultron.war.result_empty_top'),
        };
      }),
    );
    fields.push({
      name: this.t('ultron.war.result_credits_title'),
      value: this.paysCredits()
        ? this.t('ultron.war.result_credits')
        : this.t('ultron.war.result_no_credits'),
    });
    return {
      persona: 'ultron',
      embeds: [
        {
          title: this.t('ultron.war.result_title'),
          description: winners.length
            ? this.t('ultron.war.result_winners', {
                names: winners.map((f) => this.factionLabel(f)).join(', '),
              })
            : this.t('ultron.war.result_none'),
          color: winners.length ? 0x27ae60 : 0x2c3e50,
          fields,
        },
      ],
      allowedMentions: { parse: [] },
    };
  }
}
