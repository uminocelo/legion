import type {
  BotContext,
  EventType,
  IncomingInteraction,
  LegionEvent,
  Locale,
  MemberView,
  OutgoingMessage,
  Responder,
} from '@legion/core';
import { customId, GatewayError } from '@legion/core';
import type { HerbieConfig } from './config.js';
import { loadTutorial } from './content.js';
import type { HerbieRepo, TutorialProgressRow } from './db/repo.js';
import {
  advance,
  type Chain,
  currentStep,
  type EffectiveStep,
  effectiveSteps,
  memberIdsOf,
  TRIGGER_EVENTS,
} from './domain/quest.js';

export const V = 1;
export const tutorialIds = {
  show: () => customId('herbie', V, 'tutorial'),
  skip: () => customId('herbie', V, 'skip'),
  skipConfirm: () => customId('herbie', V, 'skip-confirm'),
};

/** Tutorial chain: start, triggers, delivery (DM first, channel fallback), checklist. */
export class HerbieTutorial {
  private chain: Chain | null = null;

  constructor(
    private readonly ctx: BotContext<HerbieConfig>,
    private readonly repo: HerbieRepo,
  ) {}

  private t = (k: string, v: Record<string, string | number>, l: Locale) => this.ctx.i18n.t(k, v, l);
  private get jarvisOn() {
    return this.ctx.config.bots.includes('jarvis');
  }

  /** Reloads the chain; an invalid file keeps the previous chain (errors are returned and logged). */
  reload(serverDir?: string): string[] {
    const res = loadTutorial(serverDir);
    if (res.value) this.chain = res.value;
    else if (!this.chain) this.chain = res.bundled; // boot with a broken server file: use the bundled chain
    if (res.errors.length)
      this.ctx.log.warn({ errors: res.errors }, 'tutorial content has errors; keeping the previous version');
    return res.errors;
  }

  get chainId(): string {
    return this.chain?.chain ?? 'boas-vindas';
  }

  steps(): EffectiveStep[] {
    if (!this.chain) return [];
    const jarvisCfg = (this.ctx.config as Record<string, unknown>).jarvis as
      | { missions?: { enabled?: boolean } }
      | undefined;
    const features = new Set<string>(
      this.jarvisOn && jarvisCfg?.missions?.enabled === true ? ['missions'] : [],
    );
    return effectiveSteps(this.chain, { enabledBots: this.ctx.config.bots, features });
  }

  // ---------- start ----------

  /** Starts the chain once per member; returns false when it already existed. */
  async start(member: Pick<MemberView, 'id' | 'discordUserId'>): Promise<boolean> {
    if (!this.ctx.botConfig.tutorial.enabled) return false;
    const steps = this.steps();
    const created = await this.repo.startProgress(member.id, this.chainId, steps[0]?.id ?? null);
    if (!created) return false;
    await this.deliver(member, (l) => this.intro(steps, l));
    return true;
  }

  // ---------- triggers ----------

  /** One trigger event: advances every member it is about whose current step it completes. */
  async onEvent(event: LegionEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const ids = memberIdsOf(payload);
    if (!ids.length && typeof payload.discordUserId === 'string') {
      const m = await this.ctx.read.members.getByDiscordId(payload.discordUserId);
      if (m) ids.push(m.id);
    }
    for (const memberId of ids) await this.advanceMember(memberId, event);
  }

  private async advanceMember(memberId: string, event: LegionEvent): Promise<void> {
    const progress = await this.repo.progress(memberId);
    if (!progress || progress.status !== 'active') return;
    const steps = this.steps();
    const done = new Set((await this.repo.stepsDone(memberId)).map((d) => d.stepId));
    const adv = advance(steps, done, event.type, event.payload as Record<string, unknown>);
    if (!adv) return;
    const xp = this.jarvisOn ? adv.step.rewardXp : 0;
    const bonus = adv.chainCompleted && this.jarvisOn ? (this.chain?.completionRewardXp ?? 0) : 0;
    const applied = await this.ctx.bus.transaction(async (tx) => {
      if (!(await this.repo.markStepDone(memberId, adv.step.id, event.id, xp, tx))) return false;
      await this.repo.updateProgress(
        memberId,
        adv.chainCompleted
          ? { currentStepId: null, status: 'completed', completedAt: this.repo.now() }
          : { currentStepId: adv.next?.id ?? null },
        tx,
      );
      await this.ctx.bus.emit(tx, 'quest.completed', {
        memberId,
        questId: `${this.chainId}:${adv.step.id}`,
        step: adv.index,
        chainCompleted: adv.chainCompleted,
      });
      if (xp > 0)
        await this.ctx.bus.emit(tx, 'xp.grant_requested', {
          memberId,
          amount: xp,
          reason: 'tutorial',
          sourceEventId: event.id,
        });
      if (bonus > 0)
        await this.ctx.bus.emit(tx, 'xp.grant_requested', {
          memberId,
          amount: bonus,
          reason: 'tutorial',
          sourceEventId: `tutorial:${memberId}:complete`,
        });
      return true;
    });
    if (!applied) return;
    const member = await this.ctx.read.members.getById(memberId);
    if (member) await this.deliver(member, (l) => this.congrats(adv.step, xp, bonus, adv.next, l));
  }

  // ---------- delivery ----------

  /**
   * DM first (or the channel when `delivery: channel`); on a DM failure post in the tutorial channel
   * (or welcome) mentioning the member and remember it for this member. Members who left get nothing.
   */
  async deliver(
    member: Pick<MemberView, 'id' | 'discordUserId'>,
    build: (l: Locale) => OutgoingMessage,
  ): Promise<void> {
    const view = await this.ctx.read.members.getById(member.id);
    if (view?.leftAt) return;
    const progress = await this.repo.progress(member.id);
    const useDm = this.ctx.botConfig.delivery === 'dm' && !progress?.deliveryFallback;
    if (useDm) {
      try {
        await this.ctx.gateway.sendDm(
          member.discordUserId,
          build(await this.ctx.i18n.localeFor(member.discordUserId)),
        );
        return;
      } catch (err) {
        const code = err instanceof GatewayError ? err.code : null;
        this.ctx.log.info({ memberId: member.id, code }, 'tutorial DM failed; using the channel');
        if (code === 50007 && progress) await this.repo.updateProgress(member.id, { deliveryFallback: 1 });
      }
    }
    const channel = this.ctx.config.channels.tutorial ?? this.ctx.config.channels.welcome;
    if (!channel) {
      this.ctx.log.warn({ memberId: member.id }, 'no tutorial or welcome channel for the tutorial fallback');
      return;
    }
    const msg = build(this.ctx.config.locale);
    try {
      await this.ctx.gateway.sendMessage(channel, {
        ...msg,
        content: `<@${member.discordUserId}>${msg.content ? ` ${msg.content}` : ''}`,
        allowedMentions: { users: [member.discordUserId] },
      });
    } catch (err) {
      this.ctx.log.error({ err, memberId: member.id, channel }, 'tutorial channel message failed');
    }
  }

  // ---------- messages ----------

  private stepLine(s: EffectiveStep, l: Locale) {
    return `**${this.t(s.titleKey, {}, l)}**\n${this.t(s.bodyKey, {}, l)}`;
  }

  intro(steps: EffectiveStep[], l: Locale): OutgoingMessage {
    const first = steps[0];
    const buttons = [
      {
        type: 'button' as const,
        customId: tutorialIds.show(),
        label: this.t('herbie.tutorial.show', {}, l),
        style: 'primary' as const,
        emoji: '📋',
      },
      ...(this.ctx.botConfig.tutorial.allowSkip
        ? [
            {
              type: 'button' as const,
              customId: tutorialIds.skip(),
              label: this.t('herbie.tutorial.skip', {}, l),
              style: 'secondary' as const,
            },
          ]
        : []),
    ];
    return {
      persona: 'herbie',
      embeds: [
        {
          title: this.t('herbie.tutorial.intro_title', {}, l),
          description: [
            this.t('herbie.tutorial.intro', { count: steps.length }, l),
            '',
            first ? this.stepLine(first, l) : '',
          ].join('\n'),
        },
      ],
      components: [buttons],
    };
  }

  congrats(
    step: EffectiveStep,
    xp: number,
    bonus: number,
    next: EffectiveStep | null,
    l: Locale,
  ): OutgoingMessage {
    const lines = [this.t('herbie.tutorial.step_done', { step: this.t(step.titleKey, {}, l) }, l)];
    if (xp > 0) lines.push(this.t('herbie.tutorial.xp', { xp }, l));
    if (next) lines.push('', this.t('herbie.tutorial.next', {}, l), this.stepLine(next, l));
    else {
      lines.push('', this.t('herbie.tutorial.completed', {}, l));
      if (bonus > 0) lines.push(this.t('herbie.tutorial.bonus', { xp: bonus }, l));
    }
    return { persona: 'herbie', embeds: [{ description: lines.join('\n') }] };
  }

  /** ✅ done, ▶️ current, ⬜ next. */
  async checklist(memberId: string, l: Locale): Promise<OutgoingMessage> {
    const steps = this.steps();
    const progress = await this.repo.progress(memberId);
    const done = new Set((await this.repo.stepsDone(memberId)).map((d) => d.stepId));
    const cur = progress?.status === 'active' ? currentStep(steps, done) : null;
    const lines = steps.map((s) => {
      const icon = done.has(s.id) ? '✅' : s === cur ? '▶️' : '⬜';
      const xp = this.jarvisOn && s.rewardXp ? ` · +${s.rewardXp} XP` : '';
      return `${icon} ${this.t(s.titleKey, {}, l)}${xp}${s === cur ? `\n   ${this.t(s.bodyKey, {}, l)}` : ''}`;
    });
    const status =
      progress?.status === 'completed'
        ? this.t('herbie.tutorial.status_completed', {}, l)
        : progress?.status === 'skipped'
          ? this.t('herbie.tutorial.status_skipped', {}, l)
          : this.t(
              'herbie.tutorial.status_active',
              { done: [...done].filter((d) => steps.some((s) => s.id === d)).length, total: steps.length },
              l,
            );
    return {
      persona: 'herbie',
      ephemeral: true,
      embeds: [
        {
          title: this.t('herbie.tutorial.checklist_title', {}, l),
          description: [status, '', ...lines].join('\n'),
        },
      ],
    };
  }

  // ---------- interactions ----------

  private async registered(i: IncomingInteraction, r: Responder, l: Locale): Promise<MemberView | null> {
    const m = await this.ctx.read.members.getByDiscordId(i.userId);
    if (m && m.onboardingStep === 'registered' && !m.leftAt) return m;
    const welcome = this.ctx.config.channels.welcome;
    await r.reply({
      persona: 'herbie',
      ephemeral: true,
      content: this.t(
        'herbie.errors.not_registered',
        { welcome: welcome ? `<#${welcome}>` : '#boas-vindas' },
        l,
      ),
    });
    return null;
  }

  /** `/tutorial [reiniciar]` and the "Ver missões" button: backfill start, restart, checklist. */
  async command(i: IncomingInteraction, r: Responder, restart: boolean): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const m = await this.registered(i, r, l);
    if (!m) return;
    if (!this.ctx.botConfig.tutorial.enabled)
      return r.reply({
        persona: 'herbie',
        ephemeral: true,
        content: this.t('herbie.tutorial.disabled', {}, l),
      });
    const progress: TutorialProgressRow | null = await this.repo.progress(m.id);
    if (!progress) {
      await this.repo.startProgress(m.id, this.chainId, this.steps()[0]?.id ?? null);
    } else if (restart && progress.status !== 'active') {
      const done = new Set((await this.repo.stepsDone(m.id)).map((d) => d.stepId));
      const cur = currentStep(this.steps(), done);
      await this.repo.updateProgress(
        m.id,
        cur ? { status: 'active', currentStepId: cur.id, completedAt: null } : { status: 'completed' },
      );
    }
    await r.reply(await this.checklist(m.id, l));
  }

  async askSkip(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    await r.reply({
      persona: 'herbie',
      ephemeral: true,
      content: this.t('herbie.tutorial.skip_confirm', {}, l),
      components: [
        [
          {
            type: 'button',
            customId: tutorialIds.skipConfirm(),
            label: this.t('herbie.tutorial.skip_yes', {}, l),
            style: 'danger',
          },
        ],
      ],
    });
  }

  async skip(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const m = await this.ctx.read.members.getByDiscordId(i.userId);
    const p = m ? await this.repo.progress(m.id) : null;
    if (m && p?.status === 'active') await this.repo.updateProgress(m.id, { status: 'skipped' });
    await r.reply({ persona: 'herbie', ephemeral: true, content: this.t('herbie.tutorial.skipped', {}, l) });
  }
}

export const TUTORIAL_TRIGGER_EVENTS: readonly EventType[] = TRIGGER_EVENTS;
