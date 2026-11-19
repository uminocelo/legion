import {
  type BotContext,
  type Combatant,
  customId,
  type Executor,
  type IncomingInteraction,
  isArchetype,
  type LegionEvent,
  type Locale,
  type OutgoingMessage,
  playerStats,
  type Responder,
  shownFaction,
} from '@legion/core';
import type { Difficulty, UltronConfig } from './config.js';
import type { EnemyTemplate } from './content.js';
import { type EventKind, type EventsRepo, OPEN_STATUSES, type WorldEventRow } from './db/events-repo.js';
import type { UltronRepo } from './db/repo.js';
import { scaleStats } from './domain/scaling.js';
import { hpBar, median } from './domain/when.js';
import { playerCombatantId } from './encounters.js';
import type { FlavorText } from './flavor.js';

export const V = 1;
export const JOBS = {
  announce: 'ultron.announce',
  start: 'ultron.start',
  end: 'ultron.end',
  refresh: 'ultron.refresh',
  plan: 'ultron.plan',
} as const;
const EDIT_THROTTLE_MS = 10_000;
/** Sentinel refuses combatants above this HP; the shared HP lives here, the strike only needs a snapshot. */
const MAX_SNAPSHOT_HP = 5000;
const COLORS = { invasion: 0x8e44ad, raid: 0xc0392b, ended: 0x2c3e50 };

export const strikeId = (eventId: string) => customId('ultron', V, 'strike', eventId);
const bossCombatantId = (eventId: string) => `boss:${eventId}`;
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

type Say = (key: string, vars?: Record<string, string | number>) => Promise<void>;

/** Invasions and raids: one shared-HP threat, worn down by `raid_strike` fights that Sentinel resolves. */
export class WorldEventService {
  constructor(
    private readonly ctx: BotContext<UltronConfig>,
    private readonly repo: EventsRepo,
    private readonly content: UltronRepo,
    private readonly flavor: FlavorText,
  ) {}

  /**
   * Set after both services exist. This file does not import the war service (that import would loop).
   * Strike scoring runs in the same transaction as the claim. Participation runs when a fight ends,
   * not when it is cancelled.
   */
  warScore: {
    strike?: (memberId: string, combatId: string, ex: Executor) => Promise<void>;
    participation?: (eventId: string, memberIds: string[]) => Promise<void>;
  } = {};

  private get cfg() {
    return this.ctx.botConfig;
  }
  private now = () => this.ctx.clock.now();
  private t = (key: string, vars: Record<string, string | number> = {}, l?: Locale) =>
    this.ctx.i18n.t(key, vars, l ?? this.ctx.config.locale);

  // ---------- scheduling ----------

  private async templateFor(kind: EventKind, pick: number): Promise<EnemyTemplate | null> {
    const ids = kind === 'invasion' ? [this.cfg.invasion.templateId] : this.cfg.raids.templateIds;
    const id = ids[pick % ids.length] ?? ids[0] ?? '';
    return (
      (await this.content.template(id)) ??
      (await this.content.templates()).find((x) => x.tier === (kind === 'raid' ? 'boss' : 'minion')) ??
      null
    );
  }

  title(ev: Pick<WorldEventRow, 'kind' | 'templateId'>, name: string, l?: Locale) {
    return this.t(`ultron.events.title_${ev.kind}`, { name }, l);
  }

  private async nameOf(ev: Pick<WorldEventRow, 'templateId'>) {
    return (await this.content.template(ev.templateId))?.name ?? ev.templateId;
  }

  /**
   * Creates an event and its three jobs. Same kind can't overlap; a past start is refused.
   * `announceNow` skips the announcement wait (staff "iniciar").
   */
  async schedule(o: {
    kind: EventKind;
    startsAt: Date;
    scheduledBy: string;
    announceNow?: boolean;
  }): Promise<
    { ok: true; event: WorldEventRow } | { ok: false; error: 'overlap' | 'past' | 'no_template' | 'exists' }
  > {
    const now = this.now();
    if (o.startsAt.getTime() < now.getTime() - 60_000) return { ok: false, error: 'past' };
    const minutes =
      o.kind === 'invasion' ? this.cfg.invasion.durationMinutes : this.cfg.raids.durationMinutes;
    const startsAt = o.startsAt.toISOString();
    const endsAt = new Date(o.startsAt.getTime() + minutes * 60_000).toISOString();
    if (await this.repo.overlapping(o.kind, startsAt, endsAt)) return { ok: false, error: 'overlap' };
    const template = await this.templateFor(o.kind, this.ctx.random.seed());
    if (!template) return { ok: false, error: 'no_template' };
    const announceAt = new Date(
      o.announceNow
        ? now.getTime()
        : Math.max(now.getTime(), o.startsAt.getTime() - this.cfg.events.announceMinutesBefore * 60_000),
    ).toISOString();
    const id = this.ctx.newId();
    const ok = await this.ctx.db.transaction(async (tx) => {
      const inserted = await this.repo.insertEvent(
        {
          id,
          kind: o.kind,
          templateId: template.id,
          scheduledBy: o.scheduledBy,
          announceAt,
          startsAt,
          endsAt,
          difficulty: this.cfg.events.difficulty,
        },
        tx,
      );
      if (!inserted) return false;
      const s = this.ctx.scheduler;
      await s.enqueue(
        JOBS.announce,
        { id },
        { runAt: new Date(announceAt), dedupeKey: `${JOBS.announce}:${id}` },
        tx,
      );
      await s.enqueue(
        JOBS.start,
        { id },
        { runAt: new Date(startsAt), dedupeKey: `${JOBS.start}:${id}` },
        tx,
      );
      await s.enqueue(JOBS.end, { id }, { runAt: new Date(endsAt), dedupeKey: `${JOBS.end}:${id}` }, tx);
      return true;
    });
    if (!ok) return { ok: false, error: 'exists' };
    const event = await this.repo.event(id);
    return event ? { ok: true, event } : { ok: false, error: 'exists' };
  }

  /** Recurring job: makes sure the next invasion (and the next cron raid, if any) exists. Idempotent. */
  async planRecurring(): Promise<void> {
    const plans: [EventKind, string | null][] = [
      ['invasion', this.cfg.invasion.enabled ? this.cfg.invasion.cron : null],
      ['raid', this.cfg.raids.cron],
    ];
    for (const [kind, cron] of plans) {
      if (!cron) continue;
      const next = this.ctx.scheduler.nextRun(cron, this.now());
      const r = await this.schedule({ kind, startsAt: next, scheduledBy: 'cron' });
      if (r.ok) this.ctx.log.info({ kind, startsAt: next.toISOString() }, 'world event scheduled');
    }
  }

  // ---------- lifecycle jobs ----------

  async announce(id: string): Promise<void> {
    const ev = await this.ctx.bus.transaction(async (tx) => {
      const row = await this.repo.transition(id, ['scheduled'], 'announced', {}, tx);
      if (row)
        await this.ctx.bus.emit(tx, 'world.event', await this.worldEventPayload(row, 'announced', null, []));
      return row;
    });
    const cur = ev ?? (await this.repo.event(id));
    // Post once: a retry after a crash finds the message id already stored.
    if (!cur || cur.announceMessageId || !['announced', 'active'].includes(cur.status)) return;
    const channel = this.ctx.config.channels.events;
    if (!channel) return this.ctx.log.warn({ id }, 'channels.events is empty; announcement not posted');
    const name = await this.nameOf(cur);
    const title = this.title(cur, name);
    const ping = this.cfg.events.pingRoleKey
      ? await this.ctx.roles.resolve(this.cfg.events.pingRoleKey)
      : null;
    const line = await this.flavor.text('event_announcement', { title }, unix(cur.startsAt));
    const sent = await this.ctx.gateway.sendMessage(channel, {
      persona: 'ultron',
      ...(ping ? { content: `<@&${ping.id}>` } : {}),
      embeds: [
        {
          title: `⚠️ ${title}`,
          description: `${line}\n\n${this.t(`ultron.events.announce_${cur.kind}`)}`,
          color: COLORS[cur.kind as EventKind],
          fields: [
            {
              name: this.t('ultron.events.starts'),
              value: `<t:${unix(cur.startsAt)}:F> (<t:${unix(cur.startsAt)}:R>)`,
              inline: true,
            },
            {
              name: this.t('ultron.events.duration'),
              value: this.t('ultron.events.minutes', { n: (unix(cur.endsAt) - unix(cur.startsAt)) / 60 }),
              inline: true,
            },
          ],
        },
      ],
      allowedMentions: ping ? { roles: [ping.id] } : { parse: [] },
    });
    await this.repo.patch(id, { announceMessageId: sent.messageId, channelId: channel });
  }

  /** Expected participants and boss level, from config or (adaptive) recent events. */
  private async sizing(kind: EventKind): Promise<{ expected: number; bossLevel: number }> {
    const e = this.cfg.events;
    let expected = e.expectedParticipants;
    if (this.cfg.adaptive.enabled) {
      const last = await this.repo.lastEnded(kind, 3);
      if (last.length) {
        const counts = await Promise.all(last.map(async (x) => (await this.repo.participants(x.id)).length));
        expected = Math.max(3, Math.round(counts.reduce((a, b) => a + b, 0) / counts.length));
      }
    }
    let bossLevel = typeof e.bossLevel === 'number' ? e.bossLevel : 5;
    if (e.bossLevel === 'auto') {
      const [last] = await this.repo.lastEnded(null, 1);
      if (last) {
        const levels = await Promise.all(
          (await this.repo.participants(last.id)).map(
            async (p) => (await this.ctx.read.progress.get(p.memberId))?.level ?? 1,
          ),
        );
        bossLevel = median(levels) ?? 5;
      }
    }
    return { expected, bossLevel };
  }

  async start(id: string): Promise<void> {
    await this.announce(id); // a missed announcement still goes out first
    const before = await this.repo.event(id);
    if (!before) return;
    if (before.status === 'announced') {
      const { expected, bossLevel } = await this.sizing(before.kind as EventKind);
      const mult = this.cfg.scaling.difficultyMultiplier[before.difficulty as Difficulty] ?? 1;
      const maxHp = Math.max(1, Math.round(this.cfg.events.hpPerParticipant * expected * mult));
      await this.ctx.bus.transaction(async (tx) => {
        const row = await this.repo.transition(
          id,
          ['announced'],
          'active',
          { maxHp, hp: maxHp, bossLevel },
          tx,
        );
        if (row)
          await this.ctx.bus.emit(tx, 'world.event', await this.worldEventPayload(row, 'started', null, []));
      });
    }
    const ev = await this.repo.event(id);
    if (ev?.status !== 'active' || ev.messageId) return;
    const channel = this.ctx.config.channels.events;
    if (!channel) return;
    const sent = await this.ctx.gateway.sendMessage(channel, await this.eventMessage(ev));
    let threadId: string | null = null;
    if (ev.kind === 'raid') {
      try {
        threadId = (
          await this.ctx.gateway.createThread(
            channel,
            `⚔️ ${await this.nameOf(ev)}`.slice(0, 90),
            sent.messageId,
          )
        ).threadId;
      } catch (err) {
        this.ctx.log.warn({ err, id }, 'could not create the raid thread');
      }
    }
    await this.repo.patch(id, {
      messageId: sent.messageId,
      channelId: channel,
      threadId,
      embedEditedAt: this.now().toISOString(),
    });
    if (this.now().getTime() >= new Date(ev.endsAt).getTime()) await this.end(id);
  }

  /** Ends the event (HP 0 → victory, time up → defeat). Safe to call twice. */
  async end(id: string, forced?: 'victory' | 'defeat'): Promise<void> {
    let ev = await this.repo.event(id);
    if (!ev) return;
    if (ev.status === 'scheduled' || ev.status === 'announced') {
      await this.start(id);
      ev = await this.repo.event(id);
      if (!ev) return;
    }
    if (ev.status === 'active') {
      const outcome = forced ?? ((ev.hp ?? 1) <= 0 ? 'victory' : 'defeat');
      const parts = await this.repo.participants(id);
      const jarvisOn = this.ctx.config.bots.includes('jarvis');
      await this.ctx.bus.transaction(async (tx) => {
        const row = await this.repo.transition(id, ['active'], 'ended', { outcome }, tx);
        if (!row) return;
        await this.ctx.bus.emit(
          tx,
          'world.event',
          await this.worldEventPayload(
            row,
            'ended',
            outcome,
            parts.map((p) => p.memberId),
          ),
        );
        if (!jarvisOn) return;
        for (const p of parts) {
          const amount = this.rewardFor(outcome, p.damage, parts[0]?.damage ?? 0);
          if (amount > 0)
            await this.ctx.bus.emit(tx, 'xp.grant_requested', {
              memberId: p.memberId,
              amount,
              reason: 'world_event',
              sourceEventId: id,
            });
        }
      });
      await this.ctx.scheduler.cancel(`${JOBS.end}:${id}`);
    }
    const done = await this.repo.event(id);
    if (done?.status !== 'ended') return;
    if (done.outcome === 'victory' || done.outcome === 'defeat') {
      const ids = (await this.repo.participants(id)).map((p) => p.memberId);
      await this.warScore.participation?.(id, ids);
    }
    await this.editEventMessage(done, true);
    if (!done.resultsMessageId && done.channelId) {
      const sent = await this.ctx.gateway.sendMessage(done.channelId, await this.resultsMessage(done));
      await this.repo.patch(id, { resultsMessageId: sent.messageId });
    }
    if (done.kind === 'invasion' || this.cfg.raids.cron) await this.planRecurring();
  }

  rewardFor(outcome: 'victory' | 'defeat', damage: number, top: number): number {
    const r = this.cfg.events.rewards;
    if (outcome === 'defeat') return r.participationXp;
    return r.victoryXp + (top > 0 ? Math.floor((r.bonusXpMax * damage) / top) : 0);
  }

  /** Staff cancel: removes pending jobs, edits the messages, tells everyone. */
  async cancel(id: string): Promise<WorldEventRow | null> {
    const row = await this.ctx.bus.transaction(async (tx) => {
      const r = await this.repo.transition(id, OPEN_STATUSES, 'cancelled', {}, tx);
      if (!r) return null;
      for (const job of [JOBS.announce, JOBS.start, JOBS.end])
        await this.ctx.scheduler.cancel(`${job}:${id}`, tx);
      await this.ctx.bus.emit(tx, 'world.event', await this.worldEventPayload(r, 'ended', null, []));
      return r;
    });
    if (!row) return null;
    const note = this.t('ultron.events.cancelled_note');
    for (const mid of [row.announceMessageId, row.messageId]) {
      if (!mid || !row.channelId) continue;
      try {
        await this.ctx.gateway.editMessage(row.channelId, mid, {
          persona: 'ultron',
          embeds: [
            {
              title: `❌ ${this.title(row, await this.nameOf(row))}`,
              description: note,
              color: COLORS.ended,
            },
          ],
          components: [],
        });
      } catch (err) {
        this.ctx.log.warn({ err, id }, 'could not edit a cancelled event message');
      }
    }
    return row;
  }

  // ---------- strikes ----------

  /** Button "Atacar". */
  async strike(i: IncomingInteraction, r: Responder, id: string): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const say: Say = (key, vars = {}) =>
      r.reply({ persona: 'ultron', ephemeral: true, content: this.t(key, vars, l) });
    const member = await this.ctx.read.members.getByDiscordId(i.userId);
    if (member?.onboardingStep !== 'registered' || member.leftAt) return say('ultron.errors.register_first');
    const ev = await this.repo.event(id);
    if (!ev) return say('ultron.errors.event_not_found');
    const now = this.now();
    if (ev.status === 'ended' || ev.status === 'cancelled' || now.getTime() >= new Date(ev.endsAt).getTime())
      return say('ultron.errors.event_over');
    if (ev.status !== 'active')
      return say('ultron.errors.event_not_started', { at: `<t:${unix(ev.startsAt)}:R>` });
    const me = await this.repo.participant(id, member.id);
    if (me && new Date(me.nextStrikeAt).getTime() > now.getTime()) {
      const s = Math.ceil((new Date(me.nextStrikeAt).getTime() - now.getTime()) / 1000);
      return say('ultron.errors.strike_cooldown', { time: s >= 60 ? `${Math.ceil(s / 60)} min` : `${s}s` });
    }
    const [player] = await this.playerSnapshot(member.id);
    if (!player) return say('ultron.errors.register_first');
    const boss = await this.bossSnapshot(ev);
    const combatId = this.ctx.newId();
    const nextStrikeAt = new Date(
      now.getTime() + this.cfg.events.strikeCooldownMinutes * 60_000,
    ).toISOString();
    await this.ctx.bus.transaction(async (tx) => {
      await this.repo.startStrike(
        { eventId: id, memberId: member.id, faction: member.faction, combatId, nextStrikeAt },
        tx,
      );
      await this.ctx.bus.emit(tx, 'combat.requested', {
        combatId,
        requestedBy: 'ultron',
        mode: 'raid_strike',
        missionId: null,
        raidId: id,
        channelId: ev.threadId ?? ev.channelId ?? i.channelId,
        participants: [player, boss],
        maxRounds: 1,
      });
    });
    return say('ultron.events.strike_sent', { minutes: this.cfg.events.strikeCooldownMinutes });
  }

  /** Same stats a mission would use. */
  private async playerSnapshot(memberId: string): Promise<Combatant[]> {
    const mutant = await this.ctx.read.mutants.getByMemberId(memberId);
    const level = (await this.ctx.read.progress.get(memberId))?.level ?? 1;
    const archetype = mutant && isArchetype(mutant.archetype) ? mutant.archetype : 'Elemental';
    return [
      {
        id: playerCombatantId(memberId),
        side: 'players',
        kind: 'player',
        refId: memberId,
        name: mutant?.codename ?? 'Mutante',
        archetype,
        level,
        stats: playerStats(
          archetype,
          level,
          await this.ctx.read.gear.bonusOf(memberId),
          this.ctx.read.gear.statCap(),
        ),
        powerCooldown: 0,
      },
    ];
  }

  async bossSnapshot(ev: WorldEventRow): Promise<Combatant> {
    const t = await this.content.template(ev.templateId);
    const level = ev.bossLevel ?? 5;
    const base = t?.base ?? { hp: 0, atk: 12, def: 10, spd: 8, foc: 10 };
    const stats = scaleStats(base, level, ev.difficulty as Difficulty, this.cfg.scaling);
    stats.hp = Math.max(1, Math.min(MAX_SNAPSHOT_HP, ev.hp ?? 1));
    return {
      id: bossCombatantId(ev.id),
      side: 'enemies',
      kind: 'enemy',
      refId: ev.templateId,
      name: t?.name ?? ev.templateId,
      archetype: null,
      level,
      stats,
      powerCooldown: 0,
    };
  }

  /** Consumer `ultron.raid-result`: applies a strike once (by combatId). */
  async onStrikeResolved(e: LegionEvent<'combat.resolved'>): Promise<void> {
    const p = e.payload;
    if (p.requestedBy !== 'ultron' || p.mode !== 'raid_strike' || !p.raidId) return;
    const raidId = p.raidId;
    const res = await this.ctx.db.transaction(async (tx) => {
      const strike = await this.repo.claimStrike(p.combatId, p.damageBySide.players, tx);
      if (!strike) return null;
      await this.warScore.strike?.(strike.memberId, p.combatId, tx);
      const ev = await this.repo.event(raidId, tx);
      if (ev?.status !== 'active') return { hp: null }; // after the end: recorded, outcome unchanged
      const me = await this.repo.participant(raidId, strike.memberId, tx);
      const hp = await this.repo.addDamage(
        {
          eventId: raidId,
          memberId: strike.memberId,
          faction: me?.faction ?? null,
          damage: p.damageBySide.players,
          knockedOut: !p.survivors.includes(playerCombatantId(strike.memberId)),
          cooldownMs: this.cfg.events.strikeCooldownMinutes * 60_000,
        },
        tx,
      );
      return { hp };
    });
    if (!res || res.hp === null) return;
    if (res.hp <= 0) return this.end(raidId, 'victory');
    await this.refresh(raidId);
  }

  /** Edits the HP embed at most every 10 s; later strikes schedule one catch-up edit (last write wins). */
  async refresh(id: string): Promise<void> {
    const ev = await this.repo.event(id);
    if (!ev?.messageId || ev.status !== 'active') return;
    const now = this.now().getTime();
    const last = ev.embedEditedAt ? new Date(ev.embedEditedAt).getTime() : 0;
    if (now - last < EDIT_THROTTLE_MS) {
      const runAt = new Date(last + EDIT_THROTTLE_MS);
      await this.ctx.scheduler.enqueue(
        JOBS.refresh,
        { id },
        { runAt, dedupeKey: `${JOBS.refresh}:${id}:${runAt.toISOString()}` },
      );
      return;
    }
    await this.repo.patch(id, { embedEditedAt: new Date(now).toISOString() });
    await this.editEventMessage(ev, false);
  }

  private async editEventMessage(ev: WorldEventRow, final: boolean) {
    if (!ev.messageId || !ev.channelId) return;
    try {
      await this.ctx.gateway.editMessage(ev.channelId, ev.messageId, await this.eventMessage(ev, final));
    } catch (err) {
      // Never fail a strike because an edit failed (rate limits, deleted message).
      this.ctx.log.warn({ err, id: ev.id }, 'could not edit the event message');
    }
  }

  // ---------- messages ----------

  async eventMessage(ev: WorldEventRow, final = false): Promise<OutgoingMessage> {
    const name = await this.nameOf(ev);
    const parts = await this.repo.participants(ev.id);
    const hp = ev.hp ?? 0;
    const max = ev.maxHp ?? 0;
    const fields = [
      { name: this.t('ultron.events.hp'), value: `\`${hpBar(hp, max)}\` ${hp} / ${max}` },
      final
        ? {
            name: this.t('ultron.events.result'),
            value: this.t(`ultron.events.outcome_${ev.outcome ?? 'cancelled'}`),
            inline: true,
          }
        : { name: this.t('ultron.events.ends'), value: `<t:${unix(ev.endsAt)}:R>`, inline: true },
      { name: this.t('ultron.events.participants'), value: String(parts.length), inline: true },
    ];
    return {
      persona: 'ultron',
      embeds: [
        {
          title: `${final ? '🏁' : '🔥'} ${this.title(ev, name)}`,
          description: this.t(`ultron.events.active_${ev.kind}`, {
            cooldown: this.cfg.events.strikeCooldownMinutes,
          }),
          color: final ? COLORS.ended : COLORS[ev.kind as EventKind],
          fields,
        },
      ],
      components: final
        ? []
        : [
            [
              {
                type: 'button',
                customId: strikeId(ev.id),
                label: this.t('ultron.events.strike_button'),
                style: 'danger',
                emoji: '⚔️',
              },
            ],
          ],
      allowedMentions: { parse: [] },
    };
  }

  async resultsMessage(ev: WorldEventRow): Promise<OutgoingMessage> {
    const name = await this.nameOf(ev);
    const parts = await this.repo.participants(ev.id);
    const outcome = (ev.outcome ?? 'defeat') as 'victory' | 'defeat';
    const line = await this.flavor.text(
      outcome === 'victory' ? 'event_victory' : 'event_defeat',
      {},
      unix(ev.endsAt),
    );
    const total = parts.reduce((a, p) => a + p.damage, 0);
    const top = await Promise.all(
      parts.slice(0, 5).map(async (p, n) => {
        const discordId = (await this.ctx.read.members.getById(p.memberId))?.discordUserId;
        return `${n + 1}. ${discordId ? `<@${discordId}>` : '?'} · ${p.damage}`;
      }),
    );
    const fields = [
      { name: this.t('ultron.events.total_damage'), value: `${total} / ${ev.maxHp ?? 0}`, inline: true },
      { name: this.t('ultron.events.participants'), value: String(parts.length), inline: true },
      { name: this.t('ultron.events.top'), value: top.length ? top.join('\n') : '—' },
    ];
    if (ev.kind === 'invasion') {
      const factions = await this.repo.factionDamage(ev.id);
      fields.push({
        name: this.t('ultron.events.by_faction'),
        value: factions.length
          ? factions.map((f) => `**${this.factionName(f.faction)}** · ${f.damage}`).join('\n')
          : '—',
      });
    }
    if (this.ctx.config.bots.includes('jarvis') && parts.length) {
      const r = this.cfg.events.rewards;
      fields.push({
        name: this.t('ultron.events.xp'),
        value:
          outcome === 'victory'
            ? this.t('ultron.events.xp_victory', { base: r.victoryXp, bonus: r.bonusXpMax })
            : this.t('ultron.events.xp_defeat', { xp: r.participationXp }),
      });
    }
    return {
      persona: 'ultron',
      embeds: [
        {
          title: `${outcome === 'victory' ? '🏆' : '💀'} ${this.title(ev, name)} · ${this.t(`ultron.events.outcome_${outcome}`)}`,
          description: line,
          color: outcome === 'victory' ? 0x27ae60 : COLORS.ended,
          fields,
        },
      ],
      allowedMentions: { parse: [] },
    };
  }

  private factionName(stored: string) {
    const key = shownFaction(this.ctx.config.factions, stored) ?? stored;
    const f = this.ctx.config.factions.find((x) => x.key === key);
    return `${f?.emoji ?? ''} ${this.ctx.config.roles.find((r) => r.key === f?.roleKey)?.name ?? key}`.trim();
  }

  private async worldEventPayload(
    ev: WorldEventRow,
    phase: 'announced' | 'started' | 'ended',
    outcome: 'victory' | 'defeat' | null,
    participantMemberIds: string[],
  ) {
    return {
      worldEventId: ev.id,
      kind: ev.kind as EventKind,
      phase,
      title: this.title(ev, await this.nameOf(ev)),
      startsAt: ev.startsAt,
      endsAt: ev.endsAt,
      outcome,
      participantMemberIds,
    };
  }

  // ---------- views ----------

  /** /ameaca */
  async threat(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const open = await this.repo.openEvents();
    const ev = open.find((e) => e.status === 'active') ?? open[0];
    if (!ev)
      return r.reply({ persona: 'ultron', ephemeral: true, content: this.t('ultron.threat.none', {}, l) });
    const name = await this.nameOf(ev);
    const member = await this.ctx.read.members.getByDiscordId(i.userId);
    const me = member ? await this.repo.participant(ev.id, member.id) : null;
    const now = this.now().getTime();
    const lines = [
      this.t(
        `ultron.threat.status_${ev.status}`,
        { at: `<t:${unix(ev.startsAt)}:R>`, ends: `<t:${unix(ev.endsAt)}:R>` },
        l,
      ),
    ];
    if (ev.status === 'active') lines.push(`\`${hpBar(ev.hp ?? 0, ev.maxHp ?? 0)}\` ${ev.hp} / ${ev.maxHp}`);
    if (me) {
      lines.push(this.t('ultron.threat.your_damage', { damage: me.damage, strikes: me.strikes }, l));
      const left = new Date(me.nextStrikeAt).getTime() - now;
      lines.push(
        left > 0
          ? this.t('ultron.threat.cooldown', { at: `<t:${unix(me.nextStrikeAt)}:R>` }, l)
          : this.t('ultron.threat.ready', {}, l),
      );
    }
    return r.reply({
      persona: 'ultron',
      ephemeral: true,
      embeds: [
        {
          title: `☢️ ${this.title(ev, name, l)}`,
          description: lines.join('\n'),
          color: COLORS[ev.kind as EventKind],
        },
      ],
      ...(ev.status === 'active' && ev.messageId && ev.channelId
        ? {
            components: [
              [
                {
                  type: 'button' as const,
                  url: `https://discord.com/channels/${this.ctx.guildId}/${ev.channelId}/${ev.messageId}`,
                  label: this.t('ultron.threat.go', {}, l),
                  style: 'link' as const,
                },
              ],
            ],
          }
        : {}),
    });
  }
}
