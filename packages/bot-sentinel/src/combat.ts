import type {
  BotContext,
  Combatant as CombatantPayload,
  Executor,
  IncomingInteraction,
  LegionEvent,
  Locale,
  OutgoingMessage,
  Responder,
} from '@legion/core';
import { computePlayerStats, customId, isArchetype, playerStats } from '@legion/core';
import type { SentinelConfig } from './config.js';
import { type CombatantRow, type CombatRow, roundInput, type SentinelRepo, startFighter } from './db/repo.js';
import { damageSummary, replayCombat } from './domain/combat/engine.js';
import { ACTIONS, type Action, type Fighter, type LogEntry } from './domain/combat/types.js';

export const V = 1;
export const ROUND_JOB = 'sentinel.round-timeout';
export const combatIds = {
  act: (combatId: string, round: number, action: Action) =>
    customId('sentinel', V, 'act', combatId, round, action),
  log: (combatId: string, page: number, nav = false) =>
    customId('sentinel', V, 'log', combatId, page, ...(nav ? ['n'] : [])),
};
const LOG_PAGE = 15;
const DUMMY_NAME = 'Drone de Treino';

export const hpBar = (hp: number, max: number, width = 10) => {
  const filled = max > 0 ? Math.round((hp / max) * width) : 0;
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${hp}/${max}`;
};

/** Combat sessions: start from `combat.requested`, buttons per round, timeouts, recovery, logs. */
export class CombatService {
  constructor(
    private readonly ctx: BotContext<SentinelConfig>,
    private readonly repo: SentinelRepo,
  ) {}

  private get cfg() {
    return this.ctx.botConfig.combat;
  }
  private t = (k: string, v: Record<string, string | number> = {}, l: Locale = this.ctx.config.locale) =>
    this.ctx.i18n.t(k, v, l);
  private opts = (c: CombatRow) => ({
    maxRounds: c.maxRounds,
    abandonAfterIdleRounds: this.cfg.abandonAfterIdleRounds,
  });

  // ---------- start ----------

  /** Rejects obviously invalid stats (the requester's retry/timeout handles it). */
  static invalidStats(p: CombatantPayload): string | null {
    const s = p.stats;
    if ([s.hp, s.atk, s.def, s.spd, s.foc].some((v) => v <= 0)) return `${p.id}: every stat must be > 0`;
    if (s.hp > 5000) return `${p.id}: hp above 5000`;
    return null;
  }

  async onRequested(e: LegionEvent<'combat.requested'>): Promise<void> {
    const p = e.payload;
    const bad = p.participants.map(CombatService.invalidStats).find(Boolean);
    const ids = new Set(p.participants.map((x) => x.id));
    const sides = new Set(p.participants.map((x) => x.side));
    const problem =
      bad ??
      (ids.size !== p.participants.length
        ? 'duplicate combatant ids'
        : sides.size < 2
          ? 'needs both sides'
          : null);
    if (problem) {
      this.ctx.log.warn(
        { combatId: p.combatId, requestedBy: p.requestedBy, problem },
        'combat.requested rejected',
      );
      return;
    }
    const seed = this.ctx.random.seed();
    const maxRounds = p.mode === 'raid_strike' ? 1 : Math.min(p.maxRounds, this.cfg.maxRounds);
    const started = await this.ctx.bus.transaction(async (tx) => {
      const fresh = await this.repo.insertCombat(
        {
          id: p.combatId,
          requestedBy: p.requestedBy,
          mode: p.mode,
          missionId: p.missionId,
          raidId: p.raidId,
          channelId: p.channelId,
          seed,
          maxRounds,
        },
        tx,
      );
      if (!fresh) return false;
      await this.repo.insertCombatants(
        p.participants.map((x) => ({
          id: x.id,
          combatId: p.combatId,
          side: x.side,
          kind: x.kind,
          refId: x.refId,
          name: x.name,
          archetype: x.archetype,
          level: x.level,
          maxHp: x.stats.hp,
          hp: x.stats.hp,
          atk: x.stats.atk,
          def: x.stats.def,
          spd: x.stats.spd,
          foc: x.stats.foc,
          powerCooldownMax: this.cfg.powerCooldownRounds,
          powerCooldown: x.powerCooldown,
          startPowerCooldown: x.powerCooldown,
          downedAtRound: null,
        })),
        tx,
      );
      if (p.mode === 'raid_strike') {
        // One round, no buttons: power if ready, else attack.
        const actions = Object.fromEntries(
          p.participants
            .filter((x) => x.side === 'players')
            .map((x) => [x.id, x.powerCooldown === 0 ? 'power' : 'attack'] as const),
        );
        await this.resolveIn(tx, p.combatId, 1, { actions, idle: false });
      }
      return true;
    });
    if (!started || p.mode === 'raid_strike') return;
    const combat = await this.repo.combat(p.combatId);
    if (!combat) return;
    let where = combat.channelId;
    try {
      const short = combat.id.slice(-6);
      where = (
        await this.ctx.gateway.createThread(
          combat.channelId,
          this.t('sentinel.combat.thread_name', { id: short }),
        )
      ).threadId;
    } catch (err) {
      // 50024: the channel is already a thread (e.g. a J.A.R.V.I.S. mission): the fight stays in it.
      if ((err as { code?: number }).code !== 50024)
        this.ctx.log.warn(
          { err, combatId: combat.id },
          'could not create the combat thread; posting in the channel',
        );
    }
    await this.repo.updateCombat(combat.id, { threadId: where });
    const players = (await this.repo.combatants(combat.id)).filter((c) => c.kind === 'player');
    const mentions = await this.mentions(players);
    await this.ctx.gateway.sendMessage(where, {
      persona: 'sentinel',
      content: this.t('sentinel.combat.started', { players: mentions.join(', ') || '—' }),
      allowedMentions: { users: await this.discordIds(players) },
    });
    await this.prompt({ ...combat, threadId: where });
  }

  private async discordIds(players: CombatantRow[]) {
    const out: string[] = [];
    for (const p of players) {
      const m = await this.ctx.read.members.getById(p.refId);
      if (m) out.push(m.discordUserId);
    }
    return out;
  }
  private async mentions(players: CombatantRow[]) {
    return (await this.discordIds(players)).map((id) => `<@${id}>`);
  }

  // ---------- prompt and choices ----------

  private status(cs: CombatantRow[]) {
    const line = (c: CombatantRow) => `${c.hp > 0 ? '' : '💀 '}**${c.name}** ${hpBar(c.hp, c.maxHp)}`;
    return [
      {
        name: this.t('sentinel.combat.side_players'),
        value:
          cs
            .filter((c) => c.side === 'players')
            .map(line)
            .join('\n') || '—',
      },
      {
        name: this.t('sentinel.combat.side_enemies'),
        value:
          cs
            .filter((c) => c.side === 'enemies')
            .map(line)
            .join('\n') || '—',
      },
    ];
  }

  /** Posts the prompt for the next round and schedules its timeout. */
  async prompt(combat: CombatRow, summary: string[] = []): Promise<void> {
    const cs = await this.repo.combatants(combat.id);
    const round = combat.round + 1;
    const where = combat.threadId ?? combat.channelId;
    const powerReady = cs.some((c) => c.kind === 'player' && c.hp > 0 && c.powerCooldown === 0);
    const sent = await this.ctx.gateway.sendMessage(where, {
      persona: 'sentinel',
      embeds: [
        {
          title: this.t('sentinel.combat.round_title', { round, max: combat.maxRounds }),
          description: [
            ...summary,
            ...(summary.length ? [''] : []),
            this.t('sentinel.combat.choose', { seconds: this.cfg.roundTimeoutSeconds }),
          ].join('\n'),
          fields: this.status(cs),
        },
      ],
      components: [
        ACTIONS.map((a) => ({
          type: 'button' as const,
          customId: combatIds.act(combat.id, round, a),
          label: this.t(`sentinel.combat.action.${a}`),
          style:
            a === 'power'
              ? ('primary' as const)
              : a === 'defend'
                ? ('secondary' as const)
                : ('danger' as const),
          // Power stays clickable when only some players have it ready; the engine turns it into attack otherwise.
          ...(a === 'power' && !powerReady ? { disabled: true } : {}),
        })),
      ],
    });
    await this.repo.updateCombat(combat.id, { promptMessageId: sent.messageId });
    await this.scheduleTimeout(combat.id, round);
  }

  async scheduleTimeout(combatId: string, round: number, ex?: Executor) {
    await this.ctx.scheduler.enqueue(
      ROUND_JOB,
      { combatId, round },
      {
        runAt: new Date(this.ctx.clock.now().getTime() + this.cfg.roundTimeoutSeconds * 1000),
        dedupeKey: `sentinel.round:${combatId}:${round}`,
        maxAttempts: 3,
      },
      ex,
    );
  }

  /** A player clicked an action button. */
  async choose(
    i: IncomingInteraction,
    r: Responder,
    combatId: string,
    round: number,
    action: string,
  ): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const err = (k: string) =>
      r.reply({ persona: 'sentinel', ephemeral: true, content: this.t(`sentinel.errors.${k}`, {}, l) });
    const combat = await this.repo.combat(combatId);
    if (!combat || !(ACTIONS as readonly string[]).includes(action)) return err('round_over');
    const member = await this.ctx.read.members.getByDiscordId(i.userId);
    const cs = await this.repo.combatants(combatId);
    const me = member ? cs.find((c) => c.kind === 'player' && c.refId === member.id) : undefined;
    if (!me) return err('not_participant');
    if (combat.status !== 'active' || combat.round + 1 !== round) return err('round_over');
    if (me.hp <= 0) return err('downed');
    if (action === 'power' && me.powerCooldown > 0) return err('power_cooldown');
    await this.repo.setPending(combatId, round, me.id, action as Action);
    await r.reply({
      persona: 'sentinel',
      ephemeral: true,
      content: this.t(
        'sentinel.combat.chosen',
        { action: this.t(`sentinel.combat.action.${action}`, {}, l) },
        l,
      ),
    });
    const pending = await this.repo.pending(combatId, round);
    const waiting = cs.filter((c) => c.kind === 'player' && c.hp > 0 && !pending[c.id]);
    if (!waiting.length) await this.resolve(combatId, round);
  }

  // ---------- resolve ----------

  /** Resolves a round (from the last choice or the timeout job). Safe to call twice. */
  async resolve(combatId: string, round: number): Promise<void> {
    const res = await this.ctx.bus.transaction(async (tx) => {
      const pending = await this.repo.pending(combatId, round, tx);
      return this.resolveIn(tx, combatId, round, {
        actions: pending,
        idle: Object.keys(pending).length === 0,
      });
    });
    if (!res) return;
    await this.ctx.scheduler.cancel(`sentinel.round:${combatId}:${round}`);
    const combat = await this.repo.combat(combatId);
    if (!combat) return;
    const names = new Map((await this.repo.combatants(combatId)).map((c) => [c.id, c.name]));
    const summary = this.summaryLines(res.log, names).slice(0, 8);
    if (combat.status === 'active') return this.prompt(combat, summary);
    await this.postFinal(combat, summary);
  }

  /**
   * Replays the stored rounds plus this one from the seed, stores the round and the new combatant state,
   * and emits `combat.resolved` when the fight ended. Returns null when the round was already resolved.
   */
  private async resolveIn(
    tx: Executor,
    combatId: string,
    round: number,
    input: { actions: Record<string, Action>; idle: boolean },
  ) {
    const combat = await this.repo.combat(combatId, tx);
    if (combat?.status !== 'active' || combat.round + 1 !== round) return null;
    const cs = await this.repo.combatants(combatId, tx);
    const stored = (await this.repo.rounds(combatId, tx)).map(roundInput);
    const replay = replayCombat(
      combat.seed,
      cs.map(startFighter),
      [...stored, { actions: input.actions, idle: input.idle }],
      this.opts(combat),
    );
    const last = replay.rounds.at(-1);
    if (!last) return null;
    if (!(await this.repo.insertRound(combatId, round, last.actions, input.idle, last.log, tx))) return null;
    for (const f of replay.state.fighters)
      await this.repo.updateCombatant(
        combatId,
        f.id,
        { hp: f.hp, powerCooldown: f.powerCooldown, downedAtRound: f.downedAtRound },
        tx,
      );
    const ended = replay.state.ended;
    const abandoned = last.log.some((e) => e.type === 'end' && e.reason === 'abandoned');
    await this.repo.updateCombat(
      combatId,
      ended
        ? {
            round,
            status: abandoned ? 'abandoned' : 'finished',
            winnerSide: replay.state.winnerSide,
            logHash: replay.logHash,
            finishedAt: this.repo.now(),
          }
        : { round },
      tx,
    );
    if (ended) {
      const dmg = damageSummary(replay.log, replay.state.fighters);
      await this.ctx.bus.emit(tx, 'combat.resolved', {
        combatId,
        requestedBy: combat.requestedBy as never,
        mode: combat.mode as never,
        missionId: combat.missionId,
        raidId: combat.raidId,
        seed: combat.seed,
        winnerSide: replay.state.winnerSide,
        rounds: round,
        damageBySide: dmg.bySide,
        survivors: replay.state.fighters.filter((f) => f.hp > 0).map((f) => f.id),
        logHash: replay.logHash,
      });
    }
    return { log: last.log, ended };
  }

  summaryLines(
    log: readonly LogEntry[],
    names: Map<string, string>,
    l: Locale = this.ctx.config.locale,
  ): string[] {
    const n = (id: string | null) => (id ? (names.get(id) ?? id) : '—');
    return log.flatMap((e) => {
      if (e.type === 'round') return [this.t('sentinel.log.round', { round: e.round }, l)];
      if (e.type === 'end')
        return [
          this.t(
            `sentinel.log.end_${e.reason}`,
            { side: e.winnerSide ? this.t(`sentinel.combat.side_${e.winnerSide}`, {}, l) : '—' },
            l,
          ),
        ];
      if (e.action === 'defend') return [this.t('sentinel.log.defend', { actor: n(e.actorId) }, l)];
      if (!e.hit)
        return [
          this.t(
            'sentinel.log.miss',
            {
              actor: n(e.actorId),
              target: n(e.targetId),
              action: this.t(`sentinel.combat.action.${e.action}`, {}, l),
              roll: e.roll ?? 0,
            },
            l,
          ),
        ];
      return [
        this.t(
          e.crit ? 'sentinel.log.crit' : 'sentinel.log.hit',
          {
            actor: n(e.actorId),
            target: n(e.targetId),
            action: this.t(`sentinel.combat.action.${e.action}`, {}, l),
            damage: e.damage,
            hp: e.targetHpAfter ?? 0,
            roll: e.roll ?? 0,
          },
          l,
        ),
      ];
    });
  }

  private async fullLog(combat: CombatRow) {
    const rounds = await this.repo.rounds(combat.id);
    return rounds.flatMap((r) => JSON.parse(r.log) as LogEntry[]);
  }

  async postFinal(combat: CombatRow, summary: string[] = []) {
    await this.ctx.gateway.sendMessage(
      combat.threadId ?? combat.channelId,
      await this.finalMessage(combat, summary),
    );
  }

  async finalMessage(
    combat: CombatRow,
    summary: string[] = [],
    l: Locale = this.ctx.config.locale,
  ): Promise<OutgoingMessage> {
    const cs = await this.repo.combatants(combat.id);
    const log = await this.fullLog(combat);
    const dmg = damageSummary(log, cs.map(startFighter));
    const mvp = cs.find((c) => c.id === dmg.mvp);
    const result =
      combat.status === 'abandoned'
        ? this.t('sentinel.combat.result_abandoned', {}, l)
        : combat.winnerSide
          ? this.t(
              'sentinel.combat.result_win',
              { side: this.t(`sentinel.combat.side_${combat.winnerSide}`, {}, l) },
              l,
            )
          : this.t('sentinel.combat.result_draw', {}, l);
    return {
      persona: 'sentinel',
      embeds: [
        {
          title: this.t('sentinel.combat.final_title', { id: combat.id.slice(-6) }, l),
          description: [...summary, ...(summary.length ? [''] : []), `**${result}**`].join('\n'),
          fields: [
            ...this.status(cs),
            { name: this.t('sentinel.combat.rounds', {}, l), value: String(combat.round), inline: true },
            {
              name: this.t('sentinel.combat.damage', {}, l),
              value: `${dmg.bySide.players} × ${dmg.bySide.enemies}`,
              inline: true,
            },
            { name: 'MVP', value: mvp ? `${mvp.name} (${dmg.byFighter.get(mvp.id)})` : '—', inline: true },
          ],
          footer: { text: `${combat.id} · ${combat.logHash?.slice(0, 16) ?? ''}` },
        },
      ],
      components: [
        [
          {
            type: 'button',
            customId: combatIds.log(combat.id, 0),
            label: this.t('sentinel.combat.full_log', {}, l),
            style: 'secondary',
            emoji: '📜',
          },
        ],
      ],
    };
  }

  /** Paginated log of a finished combat (button or /combate log). */
  async logPage(combatId: string, page: number, l: Locale): Promise<OutgoingMessage | null> {
    const combat = await this.repo.findCombat(combatId);
    if (!combat || combat.status === 'active') return null;
    const names = new Map((await this.repo.combatants(combat.id)).map((c) => [c.id, c.name]));
    const lines = this.summaryLines(await this.fullLog(combat), names, l);
    const pages = Math.max(1, Math.ceil(lines.length / LOG_PAGE));
    const p = Math.min(Math.max(0, Number.isFinite(page) ? page : 0), pages - 1);
    return {
      persona: 'sentinel',
      ephemeral: true,
      embeds: [
        {
          title: this.t('sentinel.combat.log_title', { id: combat.id.slice(-6), page: p + 1, pages }, l),
          description: lines.slice(p * LOG_PAGE, (p + 1) * LOG_PAGE).join('\n'),
        },
      ],
      components: [
        [
          {
            type: 'button',
            customId: combatIds.log(combatId, p - 1, true),
            label: '◀',
            style: 'secondary',
            disabled: p === 0,
          },
          {
            type: 'button',
            customId: combatIds.log(combatId, p + 1, true),
            label: '▶',
            style: 'secondary',
            disabled: p >= pages - 1,
          },
        ],
      ],
    };
  }

  // ---------- replay check ----------

  async verify(
    idOrShort: string,
  ): Promise<{ id: string; ok: boolean; stored: string | null; computed: string } | null> {
    const combat = await this.repo.findCombat(idOrShort);
    if (!combat) return null;
    const combatId = combat.id;
    const cs = await this.repo.combatants(combatId);
    const rounds = await this.repo.rounds(combatId);
    const r = replayCombat(combat.seed, cs.map(startFighter), rounds.map(roundInput), this.opts(combat));
    const storedLog = rounds.flatMap((x) => JSON.parse(x.log) as LogEntry[]);
    const sameLog = JSON.stringify(storedLog) === JSON.stringify(r.log);
    const expected = combat.logHash ?? r.logHash; // active combat: compare the log only
    return {
      id: combatId,
      ok: sameLog && expected === r.logHash,
      stored: combat.logHash,
      computed: r.logHash,
    };
  }

  /** Autocomplete for combat ids: recent combats, matching the short or full id. */
  async autocomplete(i: IncomingInteraction, r: Responder, finishedOnly: boolean): Promise<void> {
    const q = (i.focused?.value ?? '').trim().replace(/^#/, '').toUpperCase();
    const rows = (await this.repo.recentCombats(50)).filter(
      (c) => (!finishedOnly || c.status !== 'active') && (!q || c.id.toUpperCase().includes(q)),
    );
    await r.autocomplete(
      rows.slice(0, 25).map((c) => ({
        name: `#${c.id.slice(-6)} · ${this.t(`sentinel.modes.${c.mode}`)} · ${c.status === 'active' ? this.t('sentinel.combat.in_progress') : c.winnerSide ? this.t(`sentinel.combat.side_${c.winnerSide}`) : this.t('sentinel.combat.result_draw')} · ${c.createdAt.slice(0, 16).replace('T', ' ')}`.slice(
          0,
          100,
        ),
        value: c.id,
      })),
    );
  }

  // ---------- recovery ----------

  /** On startup: every active combat gets its round timeout back (no-op when the job exists). */
  async recover(): Promise<number> {
    let n = 0;
    for (const c of await this.repo.activeCombats()) {
      if (c.mode === 'raid_strike') continue;
      if (
        await this.ctx.scheduler.enqueue(
          ROUND_JOB,
          { combatId: c.id, round: c.round + 1 },
          {
            runAt: new Date(this.ctx.clock.now().getTime() + this.cfg.roundTimeoutSeconds * 1000),
            dedupeKey: `sentinel.round:${c.id}:${c.round + 1}`,
            maxAttempts: 3,
          },
        )
      )
        n++;
    }
    return n;
  }

  // ---------- /treino ----------

  async training(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const say = (k: string, v: Record<string, string | number> = {}) =>
      r.reply({ persona: 'sentinel', ephemeral: true, content: this.t(k, v, l) });
    const member = await this.ctx.read.members.getByDiscordId(i.userId);
    if (member?.onboardingStep !== 'registered' || member.leftAt)
      return say('sentinel.errors.not_registered');
    const active = await this.repo.combatsOfMember(member.id, {
      status: 'active',
      excludeMode: 'raid_strike',
    });
    if (active[0])
      return say('sentinel.errors.already_fighting', {
        thread: `<#${active[0].threadId ?? active[0].channelId}>`,
      });
    const last = (await this.repo.combatsOfMember(member.id, { mode: 'training' }))[0];
    const cd = this.ctx.botConfig.training.cooldownSeconds * 1000;
    if (last && cd > 0) {
      const left = new Date(last.createdAt).getTime() + cd - this.ctx.clock.now().getTime();
      if (left > 0) return say('sentinel.errors.training_cooldown', { seconds: Math.ceil(left / 1000) });
    }
    const mutant = await this.ctx.read.mutants.getByMemberId(member.id);
    const level = (await this.ctx.read.progress.get(member.id))?.level ?? 1;
    const archetype = mutant && isArchetype(mutant.archetype) ? mutant.archetype : 'Elemental';
    const me = playerStats(
      archetype,
      level,
      await this.ctx.read.gear.bonusOf(member.id),
      this.ctx.read.gear.statCap(),
    );
    const tank = computePlayerStats('Tanque', level);
    const dummy = {
      ...tank,
      atk: Math.max(1, Math.floor(tank.atk * this.ctx.botConfig.training.dummyAtkMultiplier)),
    };
    const combatId = this.ctx.newId();
    await this.ctx.bus.transaction((tx) =>
      this.ctx.bus.emit(tx, 'combat.requested', {
        combatId,
        requestedBy: 'sentinel',
        mode: 'training',
        missionId: null,
        raidId: null,
        channelId: this.ctx.config.channels.combat ?? i.channelId,
        participants: [
          {
            id: 'p1',
            side: 'players',
            kind: 'player',
            refId: member.id,
            name: mutant?.codename ?? 'Mutante',
            archetype,
            level,
            stats: me,
            powerCooldown: 0,
          },
          {
            id: 'z1',
            side: 'enemies',
            kind: 'dummy',
            refId: 'sentinel',
            name: DUMMY_NAME,
            archetype: 'Tanque',
            level,
            stats: dummy,
            powerCooldown: 0,
          },
        ],
        maxRounds: this.cfg.maxRounds,
      }),
    );
    await say('sentinel.combat.training_started');
  }

  /** /combate status */
  async statusOf(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const member = await this.ctx.read.members.getByDiscordId(i.userId);
    const active = member
      ? (await this.repo.combatsOfMember(member.id, { status: 'active', excludeMode: 'raid_strike' }))[0]
      : undefined;
    if (!active)
      return r.reply({
        persona: 'sentinel',
        ephemeral: true,
        content: this.t('sentinel.combat.no_active', {}, l),
      });
    const cs = await this.repo.combatants(active.id);
    return r.reply({
      persona: 'sentinel',
      ephemeral: true,
      embeds: [
        {
          title: this.t(
            'sentinel.combat.status_title',
            { round: active.round + 1, max: active.maxRounds },
            l,
          ),
          description: `<#${active.threadId ?? active.channelId}>`,
          fields: this.status(cs),
        },
      ],
    });
  }
}

export type { Fighter };
