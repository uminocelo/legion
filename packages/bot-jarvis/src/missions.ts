import type {
  ActionRow,
  BotContext,
  Executor,
  IncomingInteraction,
  LegionEvent,
  Locale,
  MemberView,
  OutgoingMessage,
  Responder,
} from '@legion/core';
import { customId } from '@legion/core';
import { eq } from 'drizzle-orm';
import type { JarvisConfig } from './config.js';
import { OPEN_RUN, type RunRow } from './db/repo.js';
import { loc, type Mission, missionXp, resolveVote, type StepResult, step } from './domain/mission.js';
import { periodStart } from './domain/periods.js';
import {
  type MissionSyncResult,
  missionDirs,
  parseMission,
  readMissions,
  syncMissions,
} from './mission-content.js';
import type { JarvisServices } from './services.js';
import { V } from './ui.js';

export const MISSION_TIMEOUT_JOB = 'jarvis.mission-timeout';
export const missionIds = {
  choose: (runId: string, sceneId: string, choice: number) =>
    customId('jarvis', V, 'mission', runId, sceneId, choice),
  lobby: (runId: string, action: 'join' | 'leave' | 'start') => customId('jarvis', V, 'lobby', runId, action),
};

/** `mission.started` id of one fight: the run plus the combat scene, so each fight scene spawns once. */
export const combatMissionId = (runId: string, sceneId: string) => `${runId}:${sceneId}`;

const COLOR = 0x00b0f4;
const ENDED_COLOR = { success: 0x2ecc71, failure: 0xe74c3c, abandoned: 0x95a5a6 } as const;
type Outcome = 'success' | 'failure' | 'abandoned';

/** Why a member cannot start a mission (null when they can). */
export type Blocker =
  | { key: 'level'; vars: { level: number } }
  | { key: 'daily_limit' | 'weekly_limit' | 'story_done' | 'combat_unavailable'; vars?: undefined };

/** J.A.R.V.I.S. missions: branching scenes in a thread, XP through the ledger (`reason: mission`). */
export class JarvisMissions {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    private readonly s: JarvisServices,
  ) {}

  private get cfg() {
    return this.ctx.botConfig.missions;
  }

  private t = (key: string, vars: Record<string, string | number>, l: Locale) =>
    this.ctx.i18n.t(key, vars, l);

  private text(content: string): OutgoingMessage {
    return { persona: 'jarvis', content, ephemeral: true };
  }

  async reload(dirs = missionDirs()): Promise<MissionSyncResult> {
    const res = await syncMissions(this.s.repo, readMissions(dirs));
    if (res.errors.length) this.ctx.log.warn({ errors: res.errors }, 'mission content has errors');
    return res;
  }

  /** Fights need ULTRON (enemies) and Sentinel (referee). */
  combatReady(): boolean {
    const bots = this.ctx.config.bots;
    return bots.includes('ultron') && bots.includes('sentinel');
  }

  async missions(): Promise<Mission[]> {
    return (await this.s.repo.allMissions())
      .filter((r) => r.active === 1 && (r.hasCombat === 0 || this.combatReady()))
      .map(parseMission);
  }

  private async mission(id: string): Promise<Mission | null> {
    const row = await this.s.repo.mission(id);
    return row ? parseMission(row) : null;
  }

  private today = () => this.s.xp.today();

  /** Level and daily/weekly/story limits for one member. */
  async blocker(memberId: string, m: Mission): Promise<Blocker | null> {
    const level = (await this.s.repo.progress(memberId))?.level ?? 1;
    if (level < m.minLevel) return { key: 'level', vars: { level: m.minLevel } };
    const runs = await this.s.repo.countedRunsOf(memberId);
    const lim = this.cfg.limits;
    const today = this.today();
    if (
      m.kind === 'daily' &&
      runs.filter((r) => r.kind === 'daily' && r.day === today).length >= lim.dailyPerMember
    )
      return { key: 'daily_limit' };
    const week = periodStart('semana', today) ?? today;
    if (
      m.kind === 'weekly' &&
      runs.filter((r) => r.kind === 'weekly' && r.week === week).length >= lim.weeklyPerMember
    )
      return { key: 'weekly_limit' };
    if (m.kind === 'story' && !lim.storyRepeatable && runs.some((r) => r.missionId === m.id))
      return { key: 'story_done' };
    return null;
  }

  async openRunOf(memberId: string): Promise<RunRow | null> {
    return (await this.s.repo.runsOf(memberId, OPEN_RUN))[0] ?? null;
  }

  // ---------- commands ----------

  /** `/missao lista`: every active mission and whether the member can play it now. */
  async list(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const member = await this.s.trivia.registered(i, r, l);
    if (!member) return;
    if (!this.cfg.enabled) return r.reply(this.text(this.t('jarvis.missions.disabled', {}, l)));
    const all = await this.missions();
    if (!all.length) return r.reply(this.text(this.t('jarvis.missions.none', {}, l)));
    const fields = [];
    for (const m of all) {
      const b = await this.blocker(member.id, m);
      const status = b ? `🔒 ${this.t(`jarvis.missions.blocked.${b.key}`, b.vars ?? {}, l)}` : '✅';
      fields.push({
        name: `${loc(m.title, l)} · ${this.t(`jarvis.missions.kind.${m.kind}`, {}, l)}`,
        value: [
          loc(m.summary, l),
          this.t(
            'jarvis.missions.meta',
            {
              id: m.id,
              level: m.minLevel,
              party: m.party,
              difficulty: this.t(`jarvis.trivia.difficulty.${m.difficulty}`, {}, l),
            },
            l,
          ),
          status,
        ].join('\n'),
      });
    }
    await r.reply({
      persona: 'jarvis',
      ephemeral: true,
      embeds: [
        { title: this.t('jarvis.missions.list_title', {}, l), color: COLOR, fields: fields.slice(0, 25) },
      ],
    });
  }

  /** Autocomplete for `/missao iniciar`: missions the member can start now. */
  async autocomplete(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const q = (i.focused?.value ?? '').toLowerCase();
    const member = await this.ctx.read.members.getByDiscordId(i.userId);
    const out = [];
    for (const m of await this.missions()) {
      const name = `${loc(m.title, l)} (${this.t(`jarvis.missions.kind.${m.kind}`, {}, l)})`;
      if (q && !name.toLowerCase().includes(q) && !m.id.includes(q)) continue;
      if (member && (await this.blocker(member.id, m))) continue;
      out.push({ name: name.slice(0, 100), value: m.id });
    }
    await r.autocomplete(out.slice(0, 25));
  }

  /** `/missao iniciar <missao>`: opens a thread and posts the first scene. */
  async start(i: IncomingInteraction, r: Responder, missionId: string): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const member = await this.s.trivia.registered(i, r, l);
    if (!member) return;
    if (!this.cfg.enabled) return r.reply(this.text(this.t('jarvis.missions.disabled', {}, l)));
    const m = (await this.missions()).find((x) => x.id === missionId);
    if (!m) return r.reply(this.text(this.t('jarvis.missions.unknown', {}, l)));
    const open = await this.openRunOf(member.id);
    if (open)
      return r.reply(this.text(this.t('jarvis.missions.already_open', { thread: this.where(open) }, l)));
    const b = await this.blocker(member.id, m);
    if (b) return r.reply(this.text(this.t(`jarvis.missions.blocked.${b.key}`, b.vars ?? {}, l)));

    const party = m.party > 1;
    const now = this.ctx.clock.now().toISOString();
    const today = this.today();
    const run: RunRow = {
      id: this.ctx.newId(),
      guildId: this.ctx.guildId,
      missionId: m.id,
      kind: m.kind,
      leaderMemberId: member.id,
      status: party ? 'lobby' : 'active',
      sceneId: m.start,
      version: 0,
      locale: l,
      channelId: this.ctx.config.channels.missions ?? this.ctx.config.channels.combat ?? i.channelId,
      threadId: null,
      postedScene: null,
      messageId: null,
      day: today,
      week: periodStart('semana', today) ?? today,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };
    const created = await this.ctx.bus.transaction(async (tx) => {
      // The open-run check above can race with a second click: re-check inside the transaction.
      if ((await this.s.repo.runsOf(member.id, OPEN_RUN, tx)).length) return false;
      await this.s.repo.insertRun(run, [member.id], tx);
      if (party) {
        await this.scheduleTimeout(tx, run, this.cfg.lobbyTimeoutMinutes);
        return true;
      }
      await this.emitStarted(tx, run, m, [member.id], 'text', run.id);
      await this.scheduleTimeout(tx, run, this.cfg.choiceTimeoutMinutes);
      return true;
    });
    if (!created) return r.reply(this.text(this.t('jarvis.missions.already_open', { thread: '—' }, l)));
    if (party) {
      try {
        const sent = await this.ctx.gateway.sendMessage(run.channelId, await this.lobbyMessage(run, m));
        await this.s.repo.markRun(run.id, { messageId: sent.messageId });
      } catch (err) {
        this.ctx.log.warn({ err, runId: run.id }, 'could not post the mission lobby');
      }
      return r.reply(
        this.text(this.t('jarvis.missions.lobby_opened', { channel: `<#${run.channelId}>` }, l)),
      );
    }
    const posted = await this.postScene(run, m);
    await r.reply(this.text(this.t('jarvis.missions.started', { thread: `<#${posted}>` }, l)));
  }

  /** `/missao abandonar`: ends the member's open run without XP. */
  async abandon(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const member = await this.s.trivia.registered(i, r, l);
    if (!member) return;
    const run = await this.openRunOf(member.id);
    if (!run) return r.reply(this.text(this.t('jarvis.missions.no_open', {}, l)));
    const m = await this.mission(run.missionId);
    if (!m) return r.reply(this.text(this.t('jarvis.missions.unknown', {}, l)));
    const members = await this.s.repo.runMembers(run.id);
    if (members.length > 1) {
      // In a party, leaving takes only this member out; the rest keep playing.
      await this.leave(run, member.id, members);
      await this.refreshLobby(run.id, m);
      return r.reply(this.text(this.t('jarvis.missions.left_party', {}, l)));
    }
    const ended = await this.ctx.bus.transaction((tx) =>
      run.status === 'lobby' ? this.cancel(tx, run) : this.finish(tx, run, m, 'abandoned'),
    );
    if (ended && ended.status === 'cancelled') await this.refreshLobby(run.id, m);
    else if (ended) await this.announceEnd(ended, m, 'abandoned');
    await r.reply(this.text(this.t('jarvis.missions.abandoned_reply', {}, l)));
  }

  // ---------- clicks ----------

  /** A choice button. Idempotent: stale scenes and repeated clicks change nothing. */
  async choose(i: IncomingInteraction, r: Responder, runId: string, sceneId: string, choice: number) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const run = await this.s.repo.run(runId);
    const m = run && (await this.mission(run.missionId));
    if (!run || !m) return r.reply(this.text(this.t('jarvis.missions.unknown', {}, l)));
    const member = await this.ctx.read.members.getByDiscordId(i.userId);
    const members = await this.s.repo.runMembers(run.id);
    if (!member || !members.includes(member.id))
      return r.reply(this.text(this.t('jarvis.missions.not_yours', {}, l)));
    if (run.status !== 'active' || run.sceneId !== sceneId || !m.scenes[sceneId]?.choices?.[choice])
      return r.reply(this.text(this.t('jarvis.missions.stale', {}, l)));

    const res = await this.ctx.bus.transaction(async (tx) => {
      const cur = await this.s.repo.run(run.id, tx);
      if (cur?.status !== 'active' || cur.sceneId !== sceneId) return { kind: 'stale' as const };
      if (!(await this.s.repo.insertChoice({ runId: run.id, sceneId, memberId: member.id, choice }, tx)))
        return { kind: 'already' as const };
      const votes = await this.s.repo.choices(run.id, sceneId, tx);
      const inRun = await this.s.repo.runMembers(run.id, tx);
      if (votes.filter((v) => inRun.includes(v.memberId)).length < inRun.length)
        return { kind: 'voted' as const };
      return { kind: 'moved' as const, ...(await this.resolveScene(tx, cur, m, votes, inRun)) };
    });
    if (res.kind === 'stale') return r.reply(this.text(this.t('jarvis.missions.stale', {}, l)));
    if (res.kind === 'already') return r.reply(this.text(this.t('jarvis.missions.already_chose', {}, l)));
    if (res.kind === 'voted') return r.reply(this.text(this.t('jarvis.missions.vote_recorded', {}, l)));
    if (!res.next) return r.reply(this.text(this.t('jarvis.missions.stale', {}, l)));
    await r.update(this.sceneMessage(run, m, sceneId, { picked: res.picked }));
    await this.afterMove(res.next, m);
  }

  /** Applies the votes on the current scene and moves the run. Inside the caller's transaction. */
  private async resolveScene(
    tx: Executor,
    run: RunRow,
    m: Mission,
    votes: { memberId: string; choice: number }[],
    members: string[],
  ): Promise<{ next: RunRow | null; picked: number }> {
    const counted = new Map(
      votes.filter((v) => members.includes(v.memberId)).map((v) => [v.memberId, v.choice]),
    );
    const picked = resolveVote(counted, run.leaderMemberId) ?? 0;
    const to = step(m, run.sceneId, { choice: picked });
    if (!to) return { next: null, picked };
    return { next: await this.moveTo(tx, run, m, to, members), picked };
  }

  /** Moves the run to the next scene (or ends it). Null when the run moved concurrently. */
  private async moveTo(
    tx: Executor,
    run: RunRow,
    m: Mission,
    to: StepResult,
    members: string[],
  ): Promise<RunRow | null> {
    if (to.type === 'end')
      return this.finish(tx, { ...run, sceneId: to.scene }, m, to.outcome, run.version, members);
    const status = to.type === 'combat' ? 'fighting' : 'active';
    if (!(await this.s.repo.updateRun(run.id, run.version, { sceneId: to.scene, status }, tx))) return null;
    const next = { ...run, sceneId: to.scene, status, version: run.version + 1 };
    if (to.type === 'combat') {
      await this.emitStarted(tx, next, m, members, 'combat', combatMissionId(run.id, to.scene));
      await this.scheduleTimeout(tx, next, this.cfg.combatTimeoutMinutes);
    } else await this.scheduleTimeout(tx, next, this.cfg.choiceTimeoutMinutes);
    return next;
  }

  /** Ends the run, pays every member still in the server, emits `mission.completed`. */
  private async finish(
    tx: Executor,
    run: RunRow,
    m: Mission,
    outcome: Outcome,
    version = run.version,
    members?: string[],
  ): Promise<RunRow | null> {
    const endedAt = this.ctx.clock.now().toISOString();
    if (
      !(await this.s.repo.updateRun(run.id, version, { status: outcome, sceneId: run.sceneId, endedAt }, tx))
    )
      return null;
    const who = members ?? (await this.s.repo.runMembers(run.id, tx));
    const xp = missionXp(m, outcome, this.cfg);
    if (xp > 0)
      for (const memberId of who) {
        const member = await this.ctx.read.members.getById(memberId);
        if (!member || member.leftAt) continue;
        await this.s.xp.award(tx, {
          memberId,
          amount: xp,
          reason: 'mission',
          note: m.id,
          sourceKey: `mission:${run.id}:${memberId}`,
        });
      }
    await this.ctx.bus.emit(tx, 'mission.completed', { missionId: run.id, memberIds: who, outcome });
    return { ...run, status: outcome, version: version + 1, endedAt };
  }

  // ---------- timers and recovery ----------

  private scheduleTimeout(tx: Executor, run: RunRow, minutes: number) {
    const runAt = new Date(this.ctx.clock.now().getTime() + minutes * 60_000);
    return this.ctx.scheduler.enqueue(
      MISSION_TIMEOUT_JOB,
      { runId: run.id, version: run.version },
      { runAt, dedupeKey: `mission-timeout:${run.id}:${run.version}` },
      tx,
    );
  }

  /**
   * One timer per run version. Lobby: cancelled. Fight: no result in time → failure. Choice: partial
   * votes decide, otherwise the run is abandoned. Stale timers (the run moved on) do nothing.
   */
  async onTimeout(p: { runId: string; version: number }): Promise<void> {
    const run = await this.s.repo.run(p.runId);
    if (!run || run.version !== p.version) return;
    const m = await this.mission(run.missionId);
    if (!m) return;
    if (run.status === 'lobby') {
      if (await this.ctx.bus.transaction((tx) => this.cancel(tx, run))) await this.refreshLobby(run.id, m);
      return;
    }
    if (run.status === 'fighting') {
      const ended = await this.ctx.bus.transaction((tx) => this.finish(tx, run, m, 'failure'));
      if (ended) await this.announceEnd(ended, m, 'failure', 'jarvis.missions.combat_timeout');
      return;
    }
    if (run.status !== 'active') return;
    const res = await this.ctx.bus.transaction(async (tx) => {
      const votes = await this.s.repo.choices(run.id, run.sceneId, tx);
      const members = await this.s.repo.runMembers(run.id, tx);
      if (votes.some((v) => members.includes(v.memberId)))
        return { ...(await this.resolveScene(tx, run, m, votes, members)), abandoned: false };
      return { next: await this.finish(tx, run, m, 'abandoned'), picked: null, abandoned: true };
    });
    if (!res.next) return;
    if (run.messageId && run.threadId)
      await this.edit(
        run.threadId,
        run.messageId,
        this.sceneMessage(run, m, run.sceneId, { picked: res.picked }),
      );
    if (res.abandoned) await this.announceEnd(res.next, m, 'abandoned');
    else await this.afterMove(res.next, m);
  }

  /** After a restart: posts scenes that were committed but not posted, and re-arms the timers. */
  async recover(): Promise<number> {
    let n = 0;
    for (const run of await this.s.repo.openRuns()) {
      const m = await this.mission(run.missionId);
      if (!m) continue;
      const minutes = {
        lobby: this.cfg.lobbyTimeoutMinutes,
        active: this.cfg.choiceTimeoutMinutes,
        fighting: this.cfg.combatTimeoutMinutes,
      }[run.status as (typeof OPEN_RUN)[number]];
      await this.ctx.bus.transaction(async (tx) => {
        // Same dedupe key as the original timer: a timer that survived the restart is not doubled.
        const elapsed = this.ctx.clock.now().getTime() - Date.parse(run.updatedAt);
        await this.scheduleTimeout(tx, run, Math.max(0, minutes * 60_000 - elapsed) / 60_000);
      });
      if (run.status !== 'lobby' && run.postedScene !== run.sceneId) await this.postScene(run, m);
      n++;
    }
    return n;
  }

  // ---------- fights ----------

  /** Sentinel's result for a mission fight: the story continues on the win or lose branch, once. */
  async onCombatResolved(e: LegionEvent<'combat.resolved'>): Promise<void> {
    const p = e.payload;
    if (!p.missionId) return;
    const cut = p.missionId.lastIndexOf(':');
    if (cut < 0) return;
    const runId = p.missionId.slice(0, cut);
    const sceneId = p.missionId.slice(cut + 1);
    const run = await this.s.repo.run(runId);
    if (run?.status !== 'fighting' || run.sceneId !== sceneId) return; // duplicate or late result
    const m = await this.mission(run.missionId);
    if (!m) return;
    const to = step(m, sceneId, { combat: p.winnerSide === 'players' ? 'win' : 'lose' });
    if (!to) return;
    const next = await this.ctx.bus.transaction(async (tx) => {
      const cur = await this.s.repo.run(runId, tx);
      if (cur?.status !== 'fighting' || cur.sceneId !== sceneId) return null;
      return this.moveTo(tx, cur, m, to, await this.s.repo.runMembers(runId, tx));
    });
    if (next) await this.afterMove(next, m);
  }

  // ---------- parties ----------

  /** Lobby buttons: join, leave, start (leader only). */
  async lobbyAction(i: IncomingInteraction, r: Responder, runId: string, action: string): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const run = await this.s.repo.run(runId);
    const m = run && (await this.mission(run.missionId));
    if (!run || !m) return r.reply(this.text(this.t('jarvis.missions.unknown', {}, l)));
    if (run.status !== 'lobby') return r.reply(this.text(this.t('jarvis.missions.lobby_closed', {}, l)));
    const member = await this.s.trivia.registered(i, r, l);
    if (!member) return;
    const members = await this.s.repo.runMembers(run.id);
    if (action === 'join') return this.join(r, run, m, member, members, l);
    if (!members.includes(member.id)) return r.reply(this.text(this.t('jarvis.missions.not_yours', {}, l)));
    if (action === 'leave') {
      if (member.id === run.leaderMemberId && members.length === 1) {
        await this.ctx.bus.transaction((tx) => this.cancel(tx, run));
      } else await this.leave(run, member.id, members);
      return r.update(await this.lobbyMessage((await this.s.repo.run(run.id)) ?? run, m));
    }
    if (action !== 'start') return r.reply(this.text(this.t('jarvis.missions.stale', {}, l)));
    if (member.id !== run.leaderMemberId)
      return r.reply(this.text(this.t('jarvis.missions.leader_only', {}, l)));
    const started = await this.ctx.bus.transaction(async (tx) => {
      if (!(await this.s.repo.updateRun(run.id, run.version, { status: 'active' }, tx))) return null;
      const next = { ...run, status: 'active', version: run.version + 1 };
      const inRun = await this.s.repo.runMembers(run.id, tx);
      await this.emitStarted(tx, next, m, inRun, 'text', run.id);
      await this.scheduleTimeout(tx, next, this.cfg.choiceTimeoutMinutes);
      return next;
    });
    if (!started) return r.reply(this.text(this.t('jarvis.missions.lobby_closed', {}, l)));
    const where = await this.postScene(started, m);
    await r.update(await this.lobbyMessage(started, m, where));
  }

  private async join(
    r: Responder,
    run: RunRow,
    m: Mission,
    member: MemberView,
    members: string[],
    l: Locale,
  ): Promise<void> {
    if (members.includes(member.id)) return r.reply(this.text(this.t('jarvis.missions.already_in', {}, l)));
    if (members.length >= m.party) return r.reply(this.text(this.t('jarvis.missions.full', {}, l)));
    const open = await this.openRunOf(member.id);
    if (open)
      return r.reply(this.text(this.t('jarvis.missions.already_open', { thread: this.where(open) }, l)));
    const b = await this.blocker(member.id, m);
    if (b) return r.reply(this.text(this.t(`jarvis.missions.blocked.${b.key}`, b.vars ?? {}, l)));
    const ok = await this.ctx.bus.transaction(async (tx) => {
      const cur = await this.s.repo.run(run.id, tx);
      if (cur?.status !== 'lobby') return false;
      if ((await this.s.repo.runMembers(run.id, tx)).length >= m.party) return false;
      if ((await this.s.repo.runsOf(member.id, OPEN_RUN, tx)).length) return false;
      return this.s.repo.addRunMember(run.id, member.id, tx);
    });
    if (!ok) return r.reply(this.text(this.t('jarvis.missions.full', {}, l)));
    await r.update(await this.lobbyMessage(run, m));
  }

  /** Takes a member out of a run; the leader role passes to the next member. */
  private async leave(run: RunRow, memberId: string, members: string[]) {
    await this.ctx.db.transaction(async (tx) => {
      await this.s.repo.removeRunMember(run.id, memberId, tx);
      const next = members.find((x) => x !== memberId);
      if (run.leaderMemberId === memberId && next)
        await tx
          .update(this.s.repo.t.jarvisMissionRuns)
          .set({ leaderMemberId: next })
          .where(eq(this.s.repo.t.jarvisMissionRuns.id, run.id));
    });
  }

  /** Closes a lobby that never started (does not count toward limits). */
  private async cancel(tx: Executor, run: RunRow): Promise<RunRow | null> {
    const endedAt = this.ctx.clock.now().toISOString();
    if (!(await this.s.repo.updateRun(run.id, run.version, { status: 'cancelled', endedAt }, tx)))
      return null;
    return { ...run, status: 'cancelled', version: run.version + 1, endedAt };
  }

  private async refreshLobby(runId: string, m: Mission) {
    const run = await this.s.repo.run(runId);
    if (!run?.messageId || run.threadId) return;
    await this.edit(run.channelId, run.messageId, await this.lobbyMessage(run, m));
  }

  async lobbyMessage(run: RunRow, m: Mission, thread?: string): Promise<OutgoingMessage> {
    const l = run.locale as Locale;
    const members = await this.s.repo.runMembers(run.id);
    const ids = await this.discordIds(members);
    const open = run.status === 'lobby';
    const state =
      run.status === 'cancelled'
        ? this.t('jarvis.missions.lobby_cancelled', {}, l)
        : open
          ? this.t('jarvis.missions.lobby_wait', { minutes: this.cfg.lobbyTimeoutMinutes }, l)
          : this.t('jarvis.missions.lobby_started', { thread: thread ? `<#${thread}>` : '—' }, l);
    const leader = (await this.ctx.read.members.getById(run.leaderMemberId))?.discordUserId;
    return {
      persona: 'jarvis',
      embeds: [
        {
          title: `${loc(m.title, l)} · ${this.t(`jarvis.missions.kind.${m.kind}`, {}, l)}`,
          description: [loc(m.summary, l), '', state].join('\n'),
          color: COLOR,
          fields: [
            {
              name: this.t('jarvis.missions.party', { n: ids.length, max: m.party }, l),
              value: ids.map((d) => (d === leader ? `👑 <@${d}>` : `<@${d}>`)).join('\n') || '—',
            },
          ],
        },
      ],
      components: open
        ? [
            [
              {
                type: 'button',
                customId: missionIds.lobby(run.id, 'join'),
                label: this.t('jarvis.missions.btn.join', {}, l),
                style: 'primary',
              },
              {
                type: 'button',
                customId: missionIds.lobby(run.id, 'leave'),
                label: this.t('jarvis.missions.btn.leave', {}, l),
                style: 'secondary',
              },
              {
                type: 'button',
                customId: missionIds.lobby(run.id, 'start'),
                label: this.t('jarvis.missions.btn.start', {}, l),
                style: 'success',
              },
            ],
          ]
        : [],
      allowedMentions: { users: [] },
    };
  }

  // ---------- messages ----------

  private where(run: RunRow) {
    return `<#${run.threadId ?? run.channelId}>`;
  }

  private async afterMove(run: RunRow, m: Mission) {
    if (run.status === 'active' || run.status === 'fighting') await this.postScene(run, m);
    else if (run.status === 'success' || run.status === 'failure' || run.status === 'abandoned')
      await this.announceEnd(run, m, run.status);
  }

  /** Ensures the run's thread exists, posts the current scene and records it. Returns the thread id. */
  private async postScene(run: RunRow, m: Mission): Promise<string> {
    const where = await this.thread(run, m);
    const members = await this.s.repo.runMembers(run.id);
    const first = run.sceneId === m.start;
    const msg = this.sceneMessage(run, m, run.sceneId, {});
    if (first) {
      const ids = await this.discordIds(members);
      msg.content = ids.map((d) => `<@${d}>`).join(' ');
      msg.allowedMentions = { users: ids };
    }
    try {
      const sent = await this.ctx.gateway.sendMessage(where, msg);
      await this.s.repo.markRun(run.id, { postedScene: run.sceneId, messageId: sent.messageId });
    } catch (err) {
      this.ctx.log.warn({ err, runId: run.id }, 'could not post the mission scene');
    }
    return where;
  }

  private async thread(run: RunRow, m: Mission): Promise<string> {
    const fresh = (await this.s.repo.run(run.id)) ?? run;
    if (fresh.threadId) return fresh.threadId;
    let id = run.channelId;
    try {
      const name = this.t(
        'jarvis.missions.thread_name',
        { title: loc(m.title, run.locale as Locale), id: run.id.slice(-6) },
        run.locale as Locale,
      );
      id = (await this.ctx.gateway.createThread(run.channelId, name.slice(0, 100))).threadId;
    } catch (err) {
      this.ctx.log.warn(
        { err, runId: run.id },
        'could not create the mission thread; posting in the channel',
      );
    }
    await this.s.repo.markRun(run.id, { threadId: id });
    return id;
  }

  private async announceEnd(run: RunRow, m: Mission, outcome: Outcome, reasonKey?: string) {
    const l = run.locale as Locale;
    const where = (await this.s.repo.run(run.id))?.threadId ?? run.threadId ?? run.channelId;
    const xp = missionXp(m, outcome, this.cfg);
    const scene = outcome === 'abandoned' || reasonKey ? null : m.scenes[run.sceneId];
    const lines = [
      scene ? loc(scene.text, l) : this.t(reasonKey ?? 'jarvis.missions.abandoned_text', {}, l),
      '',
      this.t(`jarvis.missions.result.${outcome}`, { xp }, l),
    ];
    try {
      await this.ctx.gateway.sendMessage(where, {
        persona: 'jarvis',
        embeds: [{ title: loc(m.title, l), description: lines.join('\n'), color: ENDED_COLOR[outcome] }],
      });
      await this.s.repo.markRun(run.id, { postedScene: run.sceneId });
    } catch (err) {
      this.ctx.log.warn({ err, runId: run.id }, 'could not post the mission result');
    }
  }

  /** A scene with its choice buttons; `picked` disables them and marks the chosen one. */
  sceneMessage(run: RunRow, m: Mission, sceneId: string, o: { picked?: number | null }): OutgoingMessage {
    const l = run.locale as Locale;
    const scene = m.scenes[sceneId];
    const done = o.picked !== undefined;
    const row: ActionRow = (scene?.choices ?? []).map((c, idx) => ({
      type: 'button',
      customId: missionIds.choose(run.id, sceneId, idx),
      label: loc(c.label, l).slice(0, 80),
      style: done && o.picked === idx ? 'success' : done ? 'secondary' : 'primary',
      disabled: done,
    }));
    const footer = scene?.combat
      ? this.t('jarvis.missions.fight', {}, l)
      : done
        ? o.picked === null
          ? this.t('jarvis.missions.timed_out', {}, l)
          : this.t('jarvis.missions.chosen', {}, l)
        : this.t('jarvis.missions.choose_within', { minutes: this.cfg.choiceTimeoutMinutes }, l);
    return {
      persona: 'jarvis',
      embeds: [
        {
          title: loc(m.title, l),
          description: scene ? loc(scene.text, l) : '',
          color: COLOR,
          footer: { text: footer },
        },
      ],
      components: row.length ? [row] : [],
    };
  }

  private async edit(channelId: string, messageId: string, msg: OutgoingMessage) {
    try {
      await this.ctx.gateway.editMessage(channelId, messageId, msg);
    } catch (err) {
      this.ctx.log.warn({ err, messageId }, 'could not edit the mission message');
    }
  }

  private async discordIds(memberIds: string[]) {
    const out: string[] = [];
    for (const id of memberIds) {
      const m = await this.ctx.read.members.getById(id);
      if (m) out.push(m.discordUserId);
    }
    return out;
  }

  private async emitStarted(
    tx: Executor,
    run: RunRow,
    m: Mission,
    members: string[],
    missionType: 'text' | 'combat',
    missionId: string,
  ) {
    const levels = await Promise.all(
      members.map(async (id) => (await this.s.repo.progress(id, tx))?.level ?? 1),
    );
    const partyLevel = Math.max(
      1,
      Math.round(levels.reduce((a, b) => a + b, 0) / Math.max(1, levels.length)),
    );
    await this.ctx.bus.emit(tx, 'mission.started', {
      missionId,
      missionType,
      memberIds: members,
      partyLevel,
      difficulty: m.difficulty,
      channelId: run.threadId ?? run.channelId,
    });
  }
}
