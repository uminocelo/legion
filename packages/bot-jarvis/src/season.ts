import type { BotContext, EventPayloads, Executor, Locale, OutgoingMessage } from '@legion/core';
import type { JarvisConfig } from './config.js';
import type { SeasonArchiveEntry, SeasonRepo, SeasonRow, SeasonWinner } from './db/season-repo.js';
import { monthStartAtOrAfter, nextSeasonWindow } from './domain/season-window.js';

export const SEASON_JOBS = {
  start: 'jarvis.season.start',
  end: 'jarvis.season.end',
  plan: 'jarvis.season.plan',
} as const;

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const DAY_MS = 86_400_000;

export type StaffStart = 'started' | 'active' | 'disabled';
export type StaffEnd = 'ended' | 'none' | 'disabled';

/**
 * Season windows and season XP from the ledger.
 * Lifetime progress is untouched; end emits `season.ended` once.
 */
export class SeasonService {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    readonly repo: SeasonRepo,
  ) {}

  private get cfg() {
    return this.ctx.botConfig.season;
  }
  private now = () => this.ctx.clock.now();
  private t = (key: string, vars: Record<string, string | number> = {}, l?: Locale) =>
    this.ctx.i18n.t(key, vars, l ?? this.ctx.config.locale);

  /** Next window when none is scheduled or active. No-op while seasons are disabled. */
  async planNext(): Promise<void> {
    if (!this.cfg.enabled) return;
    if ((await this.repo.findStatus('active')) || (await this.repo.findStatus('scheduled'))) return;
    const prev = await this.repo.latestEnded();
    const window = nextSeasonWindow({
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
        SEASON_JOBS.start,
        { id },
        { runAt: window.startsAt, dedupeKey: `${SEASON_JOBS.start}:${id}` },
        tx,
      );
      await s.enqueue(
        SEASON_JOBS.end,
        { id },
        { runAt: window.endsAt, dedupeKey: `${SEASON_JOBS.end}:${id}` },
        tx,
      );
    });
  }

  /** `jarvis.season.start`: scheduled → active, once. */
  async startJob(id: string): Promise<void> {
    await this.ctx.db.transaction(async (tx) => {
      await this.repo.transition(id, ['scheduled'], 'active', {}, tx);
    });
  }

  /**
   * `jarvis.season.end`. Status change, winners, archive and `season.ended` commit together.
   * A second call finds 0 rows and is a no-op. Lifetime XP is never wiped.
   */
  async end(id: string, opts?: { endsAt?: string }): Promise<void> {
    const current = await this.repo.season(id);
    if (!current) return;
    if (current.status === 'scheduled') await this.startJob(id);
    const row = await this.repo.season(id);
    if (row?.status === 'active') {
      const endsAt = opts?.endsAt ?? row.endsAt;
      await this.ctx.bus.transaction(async (tx) => {
        const ended = await this.repo.transition(id, ['active'], 'ended', { endsAt }, tx);
        if (!ended) return;
        const winners = await this.topWinners(ended, tx);
        await this.repo.setWinners(id, winners, tx);
        await this.repo.setArchive(id, { board: await this.archiveBoard(ended, tx) }, tx);
        await this.ctx.bus.emit(tx, 'season.ended', {
          seasonId: id,
          winners,
          endsAt,
        });
      });
    }
    await this.planNext();
  }

  /** Staff/tests: start now. A scheduled season is pulled forward. */
  async staffStart(): Promise<StaffStart> {
    if (!this.cfg.enabled) return 'disabled';
    if (await this.repo.findStatus('active')) return 'active';
    const endsAt = this.staffEndsAt(this.now());
    const scheduled = await this.repo.findStatus('scheduled');
    // Updating the scheduled row frees its starts_at; no need to bump past it.
    if (scheduled) {
      await this.activate(scheduled.id, this.now(), endsAt);
      return 'started';
    }
    const now = await this.unusedStart(this.now());
    const id = this.ctx.newId();
    await this.ctx.db.transaction(async (tx) => {
      await this.repo.insert({ id, startsAt: now.toISOString(), endsAt: endsAt.toISOString() }, tx);
      await this.repo.transition(id, ['scheduled'], 'active', {}, tx);
      await this.ctx.scheduler.enqueue(
        SEASON_JOBS.end,
        { id },
        { runAt: endsAt, dedupeKey: `${SEASON_JOBS.end}:${id}` },
        tx,
      );
    });
    return 'started';
  }

  /** Staff/tests: close the active season now and plan the next one. */
  async staffEnd(): Promise<StaffEnd> {
    const active = await this.repo.findStatus('active');
    if (!active) return this.cfg.enabled ? 'none' : 'disabled';
    await this.end(active.id, { endsAt: this.now().toISOString() });
    return 'ended';
  }

  /**
   * `season.ended` consumer (`jarvis.season-rewards`): one badge per winner.
   * Re-delivery is a no-op via unique `(season_id, member_id)`.
   */
  async grantBadges(e: EventPayloads['season.ended']): Promise<number> {
    return this.repo.insertBadges(e.seasonId, e.winners, this.ctx.newId);
  }

  /** Public `/temporada` body. */
  async playerView(discordUserId: string, locale: Locale): Promise<OutgoingMessage> {
    if (!this.cfg.enabled) {
      return {
        persona: 'jarvis',
        content: this.t('jarvis.season.disabled', {}, locale),
      };
    }
    const badgesLine = await this.badgesLine(discordUserId, locale);
    const active = await this.repo.findStatus('active');
    if (!active) {
      const next = await this.repo.findStatus('scheduled');
      const base = next
        ? this.t('jarvis.season.no_active_next', { at: `<t:${unix(next.startsAt)}:F>` }, locale)
        : this.t('jarvis.season.no_active', {}, locale);
      return {
        persona: 'jarvis',
        content: badgesLine ? `${base}\n${badgesLine}` : base,
      };
    }
    const board = await this.boardRows(active);
    const size = this.ctx.botConfig.leaderboard.size;
    const lines = board
      .slice(0, size)
      .map((r, i) => this.t('jarvis.season.line', { pos: i + 1, codename: r.codename, xp: r.xp }, locale));
    const me = board.findIndex((r) => r.discordUserId === discordUserId);
    const you =
      me >= 0
        ? this.t('jarvis.season.you', { pos: me + 1, xp: board[me]?.xp ?? 0 }, locale)
        : this.t('jarvis.season.you_none', {}, locale);
    const description = [
      this.t('jarvis.season.time_left', { at: `<t:${unix(active.endsAt)}:R>` }, locale),
      '',
      this.t('jarvis.season.board_title', {}, locale),
      lines.length ? lines.join('\n') : this.t('jarvis.season.empty', {}, locale),
      '',
      you,
    ];
    if (badgesLine) description.push('', badgesLine);
    return {
      persona: 'jarvis',
      embeds: [
        {
          title: this.t('jarvis.season.title', {}, locale),
          description: description.join('\n'),
        },
      ],
    };
  }

  private async badgesLine(discordUserId: string, locale: Locale): Promise<string | null> {
    const member = await this.ctx.read.members.getByDiscordId(discordUserId);
    if (!member) return null;
    const badges = await this.repo.badgesForMember(member.id);
    if (!badges.length) return null;
    const best = Math.min(...badges.map((b) => b.place));
    return this.t('jarvis.season.badges', { count: badges.length, best }, locale);
  }

  private async boardRows(season: SeasonRow) {
    const members = await this.ctx.read.members.listRegistered();
    const byId = new Map(members.filter((m) => !m.leftAt).map((m) => [m.id, m]));
    const scores = (await this.repo.scoreboard(season.startsAt, season.endsAt, [...byId.keys()])).filter(
      (s) => byId.has(s.memberId),
    );
    const out: { memberId: string; discordUserId: string; codename: string; xp: number }[] = [];
    for (const s of scores) {
      const m = byId.get(s.memberId);
      if (!m) continue;
      const mutant = await this.ctx.read.mutants.getByMemberId(m.id);
      out.push({
        memberId: m.id,
        discordUserId: m.discordUserId,
        codename: mutant?.codename ?? `<@${m.discordUserId}>`,
        xp: s.xp,
      });
    }
    return out;
  }

  private async archiveBoard(season: SeasonRow, tx: Executor): Promise<SeasonArchiveEntry[]> {
    const members = await this.ctx.read.members.listRegistered();
    const byId = new Map(members.filter((m) => !m.leftAt).map((m) => [m.id, m]));
    const scores = await this.repo.scoreboard(season.startsAt, season.endsAt, [...byId.keys()], tx);
    const board: SeasonArchiveEntry[] = [];
    for (let i = 0; i < scores.length; i++) {
      const s = scores[i];
      if (!s) continue;
      const m = byId.get(s.memberId);
      if (!m) continue;
      const mutant = await this.ctx.read.mutants.getByMemberId(m.id);
      board.push({
        memberId: m.id,
        discordUserId: m.discordUserId,
        codename: mutant?.codename ?? undefined,
        xp: s.xp,
        place: i + 1,
      });
    }
    return board;
  }

  private async topWinners(season: SeasonRow, tx: Executor): Promise<SeasonWinner[]> {
    const members = await this.ctx.read.members.listRegistered();
    const activeIds = members.filter((m) => !m.leftAt).map((m) => m.id);
    const scores = await this.repo.scoreboard(season.startsAt, season.endsAt, activeIds, tx);
    const top = this.cfg.rewards.top;
    return scores.slice(0, top).map((s, i) => ({ memberId: s.memberId, place: i + 1, xp: s.xp }));
  }

  private async unusedStart(preferred: Date): Promise<Date> {
    let at = preferred;
    for (let i = 0; i < 5; i++) {
      if (!(await this.repo.hasStartsAt(at.toISOString()))) return at;
      at = new Date(at.getTime() + 1);
    }
    return at;
  }

  private staffEndsAt(now: Date): Date {
    if (this.cfg.length === 'month')
      return monthStartAtOrAfter(new Date(now.getTime() + DAY_MS), this.ctx.config.timezone);
    return new Date(now.getTime() + this.cfg.length * DAY_MS);
  }

  private async activate(id: string, now: Date, endsAt: Date): Promise<void> {
    await this.ctx.db.transaction(async (tx) => {
      await this.ctx.scheduler.cancel(`${SEASON_JOBS.start}:${id}`, tx);
      await this.ctx.scheduler.cancel(`${SEASON_JOBS.end}:${id}`, tx);
      const row = await this.repo.transition(
        id,
        ['scheduled'],
        'active',
        { startsAt: now.toISOString(), endsAt: endsAt.toISOString() },
        tx,
      );
      if (!row) return;
      await this.ctx.scheduler.enqueue(
        SEASON_JOBS.end,
        { id },
        { runAt: endsAt, dedupeKey: `${SEASON_JOBS.end}:${id}` },
        tx,
      );
    });
  }
}
