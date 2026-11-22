import {
  type BotContext,
  GatewayError,
  type GuildMember,
  type IncomingInteraction,
  isArchetype,
  isOrigin,
  type Locale,
  type OutgoingMessage,
  type Responder,
  shownFaction,
} from '@legion/core';
import { z } from 'zod';
import type { CerebroConfig } from './config.js';
import { type CosmeticKind, resolveCosmeticId } from './cosmetics.js';
import {
  CerebroRepo,
  cosmeticsOf,
  type MemberRow,
  type MutantRow,
  pendingPowersOf,
  toMemberView,
} from './db/repo.js';
import { validateCodename } from './domain/codename.js';
import { expectedRoles, transition } from './domain/onboarding.js';
import { FactionJoin } from './faction-join.js';
import { InviteTracker } from './invite-tracker.js';
import { OriginChange } from './origin-change.js';
import { PowerFlow } from './power-flow.js';
import { CARD_FILE, SheetCard } from './sheet.js';
import { renderSquadOutcome, Squads } from './squads.js';
import { TeamMove } from './team-move.js';
import { CerebroUi, COSMETIC_NONE, channelMention } from './ui.js';

const stepOf = (row: MemberRow) => toMemberView(row).onboardingStep;

export const RECONCILE_JOB = 'cerebro.reconcile-member';
const RANK_KEYS = ['rank_recruta', 'rank_agente', 'rank_veterano'];

/** Onboarding, profile and role flows. Handlers stay thin; every state change is read from and written to the DB. */
export class CerebroFlow {
  readonly repo: CerebroRepo;
  readonly ui: CerebroUi;
  readonly powers: PowerFlow;
  readonly sheet: SheetCard;
  readonly originChange: OriginChange;
  readonly teamMove: TeamMove;
  readonly factionJoin: FactionJoin;
  readonly squads: Squads;
  readonly invites: InviteTracker;

  constructor(readonly ctx: BotContext<CerebroConfig>) {
    this.repo = new CerebroRepo(ctx.db, ctx.guildId, ctx.clock, ctx.newId);
    this.ui = new CerebroUi(ctx.i18n, ctx.botConfig, {
      channels: ctx.config.channels,
      factions: ctx.config.factions.map((f) => ({ key: f.key, emoji: f.emoji })),
    });
    this.powers = new PowerFlow(this);
    this.sheet = new SheetCard(this);
    this.originChange = new OriginChange(this);
    this.teamMove = new TeamMove(this);
    this.factionJoin = new FactionJoin(this);
    this.squads = new Squads(this);
    this.invites = new InviteTracker(this);
  }

  /** Origins offered now: configured ones that have at least one power (when the catalog is on). */
  visibleOrigins(): { key: string; emoji: string }[] {
    return this.cfg.origins.filter(
      (o) => !this.powers.enabled || this.powers.catalog.forOrigin(o.key).length,
    );
  }
  isVisibleOrigin(key: string | null | undefined): key is string {
    return isOrigin(key) && this.visibleOrigins().some((o) => o.key === key);
  }
  /** Where new heroes start: `cerebro.teams.startFaction`, or the first faction when it is not configured. */
  startFaction(): string {
    const { startFaction } = this.cfg.teams;
    const factions = this.ctx.config.factions;
    return factions.some((f) => f.key === startFaction) ? startFaction : (factions[0]?.key ?? startFaction);
  }
  /** Shown to the hero themself while the one-time origin change is open. */
  originHint(mutant: MutantRow, locale?: Locale): string | null {
    return mutant.originRechoice === 1 ? this.t('origin_change.hint', {}, locale) : null;
  }

  /** "★ main · secondary…" or null when the mutant has no catalog powers. */
  async powersLine(mutant: MutantRow, locale?: Locale): Promise<string | null> {
    return this.powers.sheetLine(await this.repo.powersOf(mutant.id), locale);
  }

  private get cfg() {
    return this.ctx.botConfig;
  }
  private t(key: string, vars: Record<string, string | number> = {}, locale?: Locale) {
    return this.ctx.i18n.t(`cerebro.${key}`, vars, locale);
  }
  locale(userId: string) {
    return this.ctx.i18n.localeFor(userId);
  }
  /** The team to show: a key no longer in `factions` (disabled team, rollback) shows as Independente. */
  displayFaction(faction: string | null): string | null {
    return shownFaction(this.ctx.config.factions, faction);
  }
  /** The Discord role for a member's team; a disabled team maps to Independente's role, like the screen. */
  factionRoleKey(faction: string | null): string | null {
    const shown = this.displayFaction(faction);
    return this.ctx.config.factions.find((f) => f.key === shown)?.roleKey ?? null;
  }
  private factionRoleKeys(): string[] {
    return this.ctx.config.factions.map((f) => f.roleKey);
  }

  // ---------- join / leave ----------

  async memberJoined(member: GuildMember): Promise<void> {
    if (member.isBot) return;
    const { row, isRejoin } = await this.ctx.bus.transaction(async (tx) => {
      const before = await this.repo.memberByDiscordId(member.userId, tx);
      const { row: ensured } = await this.repo.ensureMember(member.userId, tx);
      const row = ensured.leftAt
        ? ((await this.repo.updateMember(ensured.id, { leftAt: null }, tx)) ?? ensured)
        : ensured;
      await this.ctx.bus.emit(tx, 'member.joined', {
        discordUserId: member.userId,
        accountCreatedAt: member.accountCreatedAt,
        isRejoin: Boolean(before),
      });
      if (row.onboardingStep === 'registered')
        await this.ctx.bus.emit(tx, 'player.rejoined', { memberId: row.id, discordUserId: member.userId });
      return { row, isRejoin: Boolean(before) };
    });
    let current = row;
    if (this.ctx.config.squads.enabled && current.onboardingStep !== 'registered') {
      const squadId = await this.invites.diff();
      if (squadId && squadId !== current.pendingSquadId)
        current = (await this.repo.updateMember(current.id, { pendingSquadId: squadId })) ?? current;
    }
    this.ctx.log.info({ userId: member.userId, step: current.onboardingStep, isRejoin }, 'member joined');
    await this.applyExpectedRoles(current);
    const welcome = this.ctx.config.channels.welcome;
    if (!welcome) return;
    if (current.onboardingStep === 'registered') {
      const mutant = await this.repo.mutantByMemberId(current.id);
      await this.safeSend(welcome, this.ui.welcomeBack(mutant?.codename ?? `<@${member.userId}>`));
    } else {
      await this.safeSend(welcome, this.ui.welcome(member.userId));
    }
  }

  async memberLeft(userId: string): Promise<void> {
    const row = await this.repo.memberByDiscordId(userId);
    if (row && !row.leftAt)
      await this.repo.updateMember(row.id, { leftAt: this.ctx.clock.now().toISOString() });
    if (row) await this.squads.onServerLeft(row);
  }

  private async safeSend(channelId: string, msg: Parameters<BotContext['gateway']['sendMessage']>[1]) {
    try {
      return await this.ctx.gateway.sendMessage(channelId, msg);
    } catch (err) {
      this.ctx.log.warn({ err, channelId }, 'could not post message; check channel permissions');
      return null;
    }
  }

  // ---------- roles ----------

  /** Brings a member's Discord roles to what the DB says. Throws on Discord errors (the job retries). */
  async reconcileRoles(row: MemberRow): Promise<void> {
    const view = toMemberView(row);
    const factionKey = this.factionRoleKey(row.faction);
    const { add, remove } = expectedRoles({
      onboardingStep: view.onboardingStep,
      factionRoleKey: factionKey,
      rank: view.rank,
      optIns: view.optIns,
    });
    const reason = 'Legion: registro do Cérebro';
    if (view.onboardingStep === 'registered') {
      await this.ctx.roles.setExactlyOne(row.discordUserId, this.factionRoleKeys(), factionKey, reason);
      await this.ctx.roles.setExactlyOne(row.discordUserId, RANK_KEYS, `rank_${view.rank}`, reason);
    }
    await this.ctx.roles.reconcileMember(row.discordUserId, add, remove, reason);
  }

  /** Like reconcileRoles, but on failure logs and schedules the retry job. Returns false on failure. */
  async applyExpectedRoles(row: MemberRow): Promise<boolean> {
    try {
      await this.reconcileRoles(row);
      return true;
    } catch (err) {
      this.ctx.log.warn(
        { err, userId: row.discordUserId, hint: 'drag the bot role above the Legion roles' },
        'role update failed; scheduling reconcile',
      );
      await this.ctx.scheduler.enqueue(
        RECONCILE_JOB,
        { memberId: row.id },
        { runAt: new Date(this.ctx.clock.now().getTime() + 5_000), maxAttempts: 3 },
      );
      return false;
    }
  }

  async reconcileJob(payload: { memberId: string }): Promise<void> {
    const row = await this.repo.memberById(payload.memberId);
    if (!row || row.leftAt) return;
    await this.reconcileRoles(row);
  }

  async onRankChanged(memberId: string, to: string): Promise<void> {
    const row = await this.repo.memberById(memberId);
    if (!row) {
      this.ctx.log.warn({ memberId }, 'rank.changed for an unknown member');
      return;
    }
    const updated = row.rank === to ? row : ((await this.repo.updateMember(row.id, { rank: to })) ?? row);
    if (updated.leftAt) return;
    await this.ctx.roles.setExactlyOne(updated.discordUserId, RANK_KEYS, `rank_${to}`, 'Legion: novo rank');
  }

  // ---------- onboarding screens ----------

  /** The screen for a member's current step (used by "start", old buttons and resumes). */
  async currentScreen(row: MemberRow, locale: Locale, prefix?: string) {
    switch (stepOf(row)) {
      case 'signal':
        return this.ui.rules(locale, prefix);
      case 'rules_accepted':
        return this.ui.origin(locale, this.visibleOrigins(), row.pendingOrigin, prefix);
      case 'origin_chosen':
        if (!this.isVisibleOrigin(row.pendingOrigin))
          return this.ui.origin(locale, this.visibleOrigins(), null, prefix);
        if (this.powers.enabled)
          return this.powers.screen(locale, pendingPowersOf(row), 'r', prefix, undefined, row.pendingOrigin);
        return this.ui.archetype(locale, row.pendingArchetype, prefix);
      default:
        return this.profileOrOptIns(row, locale);
    }
  }

  private async profileOrOptIns(row: MemberRow, locale: Locale) {
    const mutant = await this.repo.mutantByMemberId(row.id);
    const header = mutant
      ? this.ui.profileEmbed(row, mutant, locale, [], await this.powersLine(mutant, locale))
      : undefined;
    return this.ui.optIns(locale, toMemberView(row).optIns, header);
  }

  private async loadOrCreate(userId: string): Promise<MemberRow> {
    const { row, created } = await this.repo.ensureMember(userId);
    if (created) await this.applyExpectedRoles(row);
    return row;
  }

  /** `cerebro:v1:start` — on the public welcome message, so the answer is a new ephemeral reply. */
  async start(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.loadOrCreate(i.userId);
    await r.reply(await this.currentScreen(row, locale));
  }

  async acceptRules(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.loadOrCreate(i.userId);
    const res = transition(stepOf(row), 'accept_rules');
    if (!res.ok) return r.update(await this.currentScreen(row, locale));
    const next = res.changed
      ? ((await this.repo.updateMember(row.id, {
          onboardingStep: res.next,
          rulesAcceptedAt: this.ctx.clock.now().toISOString(),
        })) ?? row)
      : row;
    await r.update(await this.currentScreen(next, locale));
  }

  async chooseOrigin(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.loadOrCreate(i.userId);
    const origin = i.values?.[0];
    const res = transition(stepOf(row), 'choose_origin');
    if (!res.ok)
      return r.update(await this.currentScreen(row, locale, this.t('errors.continue', {}, locale)));
    if (!this.isVisibleOrigin(origin))
      return r.update(await this.currentScreen(row, locale, this.t('errors.invalid_choice', {}, locale)));
    const changed = origin !== row.pendingOrigin;
    const next =
      (await this.repo.updateMember(row.id, {
        onboardingStep: res.next,
        pendingOrigin: origin,
        ...(changed ? { pendingPowers: null, pendingArchetype: null } : {}),
      })) ?? row;
    if (this.ctx.config.squads.enabled) return r.update(await this.squadOffer(next, locale));
    await r.update(await this.currentScreen(next, locale));
  }

  /** Squad step after origin. Skip clears the invite hint and continues the normal flow. */
  private async squadOffer(row: MemberRow, locale: Locale, prefix?: string): Promise<OutgoingMessage> {
    const hinted = row.pendingSquadId ? await this.squads.byId(row.pendingSquadId) : null;
    const live = hinted?.status === 'active' ? hinted : null;
    return this.ui.squadOffer(locale, {
      prefix,
      hint: live ? { name: live.name, team: this.ui.factionLabel(live.baseFaction, locale) } : undefined,
    });
  }

  async acceptSquadHint(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.loadOrCreate(i.userId);
    if (!this.ctx.config.squads.enabled || stepOf(row) !== 'origin_chosen')
      return r.update(await this.currentScreen(row, locale, this.t('errors.continue', {}, locale)));
    const outcome = await this.squads.join({
      discordUserId: i.userId,
      squadId: row.pendingSquadId ?? undefined,
      via: 'link',
    });
    await this.afterSquadChoice(i.userId, r, locale, outcome);
  }

  async skipSquad(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.loadOrCreate(i.userId);
    if (row.pendingSquadId) await this.repo.updateMember(row.id, { pendingSquadId: null });
    const fresh = (await this.repo.memberById(row.id)) ?? row;
    await r.update(await this.currentScreen(fresh, locale));
  }

  async askSquadCode(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    await r.showModal(this.ui.squadCodeModal(locale));
  }

  async submitSquadCode(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    await r.defer(true);
    const outcome = await this.squads.join({
      discordUserId: i.userId,
      code: i.fields?.codigo ?? '',
      via: 'code',
    });
    await this.afterSquadChoice(i.userId, r, locale, outcome, true);
  }

  private async afterSquadChoice(
    userId: string,
    r: Responder,
    locale: Locale,
    outcome: { ok: boolean; key: string; vars?: Record<string, string | number> },
    modal = false,
  ): Promise<void> {
    const fresh = await this.repo.memberByDiscordId(userId);
    const message = renderSquadOutcome(this.ctx.i18n, outcome, locale);
    const send = async (msg: OutgoingMessage) => (modal ? r.send(msg) : r.update(msg));
    if (!fresh) return send(this.ui.text(message));
    if (outcome.ok || outcome.key === 'origin') return send(await this.currentScreen(fresh, locale, message));
    if (this.ctx.config.squads.enabled && stepOf(fresh) === 'origin_chosen')
      return send(await this.squadOffer(fresh, locale, message));
    return send(this.ui.text(message));
  }

  /** "Trocar origem" on the power picker: back to the origin menu, picks cleared. */
  async backToOrigin(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.loadOrCreate(i.userId);
    if (stepOf(row) !== 'origin_chosen')
      return r.update(await this.currentScreen(row, locale, this.t('errors.continue', {}, locale)));
    const next =
      (await this.repo.updateMember(row.id, {
        onboardingStep: 'rules_accepted',
        pendingPowers: null,
        pendingArchetype: null,
      })) ?? row;
    await r.update(await this.currentScreen(next, locale));
  }

  /** Buttons from before v0.9 (the faction menu): show where the member is now. */
  async legacyButton(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.loadOrCreate(i.userId);
    await r.update(await this.currentScreen(row, locale, this.t('errors.continue', {}, locale)));
  }

  async chooseArchetype(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.loadOrCreate(i.userId);
    const archetype = i.values?.[0] ?? '';
    const res = transition(stepOf(row), 'choose_archetype');
    if (!res.ok)
      return r.update(await this.currentScreen(row, locale, this.t('errors.continue', {}, locale)));
    if (!isArchetype(archetype) || !this.cfg.archetypes.includes(archetype))
      return r.update(await this.currentScreen(row, locale, this.t('errors.invalid_choice', {}, locale)));
    await this.repo.updateMember(row.id, { pendingArchetype: archetype });
    await r.showModal(this.ui.mutantModal(locale));
  }

  /** `cerebro:v1:reopen` — shows the modal again (after an error or a restart). */
  async reopen(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.loadOrCreate(i.userId);
    if (stepOf(row) !== 'origin_chosen' || !row.pendingArchetype)
      return r.reply(await this.currentScreen(row, locale, this.t('errors.continue', {}, locale)));
    await r.showModal(this.ui.mutantModal(locale));
  }

  async submitMutant(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    await r.defer(true);
    const row = await this.loadOrCreate(i.userId);
    const res = transition(stepOf(row), 'submit_mutant');
    if (!res.ok || !row.pendingArchetype || !this.isVisibleOrigin(row.pendingOrigin)) {
      const prefix = res.ok ? this.t('errors.continue', {}, locale) : undefined;
      const screen = await this.currentScreen(
        res.ok ? { ...row, pendingArchetype: null } : row,
        locale,
        prefix,
      );
      return r.send(screen);
    }

    const fields = i.fields ?? {};
    const name = validateCodename(fields.codinome ?? '', this.cfg.codename);
    if (!name.ok) {
      if (name.error === 'canon') await this.trackCanonAttempt(row, name.codename, i.userId);
      const msg =
        name.error === 'canon'
          ? this.t('errors.canon_name', { codename: name.codename }, locale)
          : name.error === 'length'
            ? this.t('errors.codename_length', this.cfg.codename, locale)
            : this.t('errors.codename_chars', {}, locale);
      return r.send(this.ui.modalError(locale, msg));
    }
    const power = z
      .string()
      .trim()
      .min(1)
      .max(100)
      .safeParse(fields.poder ?? '');
    if (!power.success) return r.send(this.ui.modalError(locale, this.t('errors.power_length', {}, locale)));
    const origin = z
      .string()
      .trim()
      .min(1)
      .max(300)
      .safeParse(fields.origem ?? '');
    if (!origin.success)
      return r.send(this.ui.modalError(locale, this.t('errors.origin_length', {}, locale)));
    if (await this.repo.codenameTaken(name.normalized))
      return r.send(
        this.ui.modalError(locale, this.t('errors.codename_taken', { codename: name.codename }, locale)),
      );

    const archetype = row.pendingArchetype;
    const originType = row.pendingOrigin;
    // A faction kept from the old faction step (before v0.9) stays; everyone else starts on startFaction.
    const faction =
      row.faction && this.ctx.config.factions.some((f) => f.key === row.faction)
        ? row.faction
        : this.startFaction();
    const picked = this.powers.enabled ? pendingPowersOf(row) : { main: null, secondary: [] };
    if (picked.main && !this.powers.catalog.get(picked.main, originType)) {
      const cleared = (await this.repo.updateMember(row.id, { pendingPowers: null })) ?? row;
      return r.send(await this.currentScreen(cleared, locale, this.t('errors.power_origin', {}, locale)));
    }
    let result:
      | { member: MemberRow; mutant: Awaited<ReturnType<CerebroRepo['insertMutant']>> }
      | 'already'
      | 'taken';
    try {
      result = await this.ctx.bus.transaction(async (tx) => {
        const fresh = await this.repo.memberById(row.id, tx);
        if (!fresh || fresh.onboardingStep === 'registered') return 'already' as const;
        const mutant = await this.repo.insertMutant(
          {
            memberId: row.id,
            codename: name.codename,
            codenameNormalized: name.normalized,
            power: power.data,
            archetype,
            origin: origin.data,
            originType,
          },
          tx,
        );
        const main = picked.main ? this.powers.catalog.get(picked.main, originType) : undefined;
        if (main)
          await this.repo.insertPowers(
            mutant.id,
            {
              main: main.id,
              secondary: picked.secondary
                .filter((id) => id !== main.id && this.powers.catalog.get(id, originType))
                .slice(0, this.cfg.powers.maxSecondary),
            },
            tx,
          );
        const member = await this.repo.updateMember(
          row.id,
          {
            onboardingStep: 'registered',
            rank: 'recruta',
            faction,
            pendingArchetype: null,
            pendingPowers: null,
            pendingOrigin: null,
            pendingSquadId: null,
          },
          tx,
        );
        if (!member) throw new Error('member vanished');
        // A squad join already recorded the team. A second change from null would be a lie.
        if (!fresh.factionChangedAt)
          await this.repo.insertFactionChange(
            {
              memberId: member.id,
              from: null,
              to: faction,
              reason: 'onboarding',
              sourceKey: `onboarding:${member.id}`,
              by: null,
            },
            tx,
          );
        await this.ctx.bus.emit(tx, 'player.created', {
          memberId: member.id,
          discordUserId: member.discordUserId,
          mutantId: mutant.id,
          codename: mutant.codename,
          archetype: mutant.archetype,
          faction,
          originType: mutant.originType,
        });
        return { member, mutant };
      });
    } catch (err) {
      // A concurrent registration took the codename (unique index) between the check and the insert.
      if (await this.repo.codenameTaken(name.normalized)) result = 'taken';
      else throw err;
    }
    if (result === 'taken')
      return r.send(
        this.ui.modalError(locale, this.t('errors.codename_taken', { codename: name.codename }, locale)),
      );
    if (result === 'already') {
      const fresh = (await this.repo.memberById(row.id)) ?? row;
      return r.send(await this.currentScreen(fresh, locale));
    }

    const { member, mutant } = result;
    this.ctx.log.info({ userId: i.userId, memberId: member.id }, 'hero registered');
    const rolesOk = await this.applyExpectedRoles(member);
    const header = this.ui.registeredEmbed(locale, mutant.codename);
    const reply = this.ui.optIns(locale, [], header);
    if (!rolesOk) reply.content = this.t('errors.role_permission', {}, locale);
    await r.send(reply);
    if (this.cfg.publicRegistryCard) {
      const channel = this.ctx.config.channels.registry ?? this.ctx.config.channels.welcome;
      if (channel) await this.safeSend(channel, this.ui.publicRegistryCard(member, mutant));
    }
  }

  private async trackCanonAttempt(row: MemberRow, attempted: string, userId: string) {
    const { count, windowMinutes } = this.cfg.canonAttemptFlag;
    const n = await this.repo.recordCanonAttempt(row.id, attempted, windowMinutes);
    if (n !== count) return;
    await this.ctx.bus.transaction((tx) =>
      this.ctx.bus.emit(tx, 'report.flagged', {
        reportId: this.ctx.newId(),
        reporter: 'cerebro',
        reporterDiscordUserId: null,
        subjectDiscordUserId: userId,
        reason: 'canon_name_attempts',
        severity: 'low',
        details: `${n} canon-name attempts in ${windowMinutes} min; last: ${attempted}`.slice(0, 500),
        refs: { memberId: row.id },
      }),
    );
  }

  // ---------- opt-ins, visual, profile ----------

  async toggleOptIn(i: IncomingInteraction, r: Responder, roleKey: string): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.repo.memberByDiscordId(i.userId);
    if (row?.onboardingStep !== 'registered') return r.reply(await this.notRegisteredSelf(locale));
    if (!this.cfg.optInRoles.includes(roleKey))
      return r.update(this.ui.optIns(locale, toMemberView(row).optIns));
    const current = toMemberView(row).optIns;
    const enabling = !current.includes(roleKey);
    const optIns = enabling ? [...current, roleKey] : current.filter((k) => k !== roleKey);
    await this.ctx.bus.transaction(async (tx) => {
      await this.repo.updateMember(row.id, { optIns: JSON.stringify(optIns) }, tx);
      await this.ctx.bus.emit(tx, 'player.optins_changed', { memberId: row.id, optIns });
    });
    try {
      if (enabling) await this.ctx.roles.assign(i.userId, roleKey, 'Legion: preferência');
      else await this.ctx.roles.remove(i.userId, roleKey, 'Legion: preferência');
    } catch (err) {
      this.ctx.log.warn({ err, roleKey }, 'opt-in role change failed');
      await this.applyExpectedRoles({ ...row, optIns: JSON.stringify(optIns) });
    }
    await r.update(this.ui.optIns(locale, optIns));
  }

  async preferences(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.repo.memberByDiscordId(i.userId);
    if (row?.onboardingStep !== 'registered') return r.reply(await this.notRegisteredSelf(locale));
    await r.reply(this.ui.optIns(locale, toMemberView(row).optIns));
  }

  /** Opens the supporter frame/title picker (`/cerebro visual`). */
  async visual(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.repo.memberByDiscordId(i.userId);
    if (row?.onboardingStep !== 'registered') return r.reply(await this.notRegisteredSelf(locale));
    if (!(await this.sheet.hasSupporterRole(i.userId)))
      return r.reply(this.ui.text(this.t('visual.need_supporter', {}, locale)));
    await r.reply(this.ui.visual(locale, cosmeticsOf(row)));
  }

  /** Saves a frame or title pick from the visual selects. */
  async pickCosmetic(i: IncomingInteraction, r: Responder, kind: CosmeticKind): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.repo.memberByDiscordId(i.userId);
    if (row?.onboardingStep !== 'registered') return r.reply(await this.notRegisteredSelf(locale));
    if (!(await this.sheet.hasSupporterRole(i.userId)))
      return r.update(this.ui.text(this.t('visual.need_supporter', {}, locale)));

    const raw = i.values?.[0] ?? '';
    const id = raw === COSMETIC_NONE || raw === '' ? null : resolveCosmeticId(raw, kind);
    if (raw !== COSMETIC_NONE && raw !== '' && !id)
      return r.update(this.ui.visual(locale, cosmeticsOf(row), this.t('errors.invalid_choice', {}, locale)));

    const updated =
      kind === 'frame'
        ? await this.repo.setCosmetics(row.id, { frameId: id })
        : await this.repo.setCosmetics(row.id, { titleId: id });
    const picks = cosmeticsOf(updated ?? row);
    const label = id
      ? this.t(`visual.${kind}_set`, { name: this.ui.cosmeticName(id, locale) }, locale)
      : this.t(`visual.${kind}_cleared`, {}, locale);
    await r.update(this.ui.visual(locale, picks, label));
  }

  private async notRegisteredSelf(locale: Locale) {
    const channel = channelMention(
      this.ctx.config.channels.welcome,
      this.t('errors.no_welcome_channel', {}, locale),
    );
    return this.ui.text(this.t('errors.not_registered_self', { channel }, locale));
  }

  async profile(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.locale(i.userId);
    const targetId = typeof i.options?.membro === 'string' ? i.options.membro : i.userId;
    const row = await this.repo.memberByDiscordId(targetId);
    const mutant =
      row && row.onboardingStep === 'registered' ? await this.repo.mutantByMemberId(row.id) : null;
    if (!row || !mutant) {
      return r.reply(
        targetId === i.userId
          ? await this.notRegisteredSelf(locale)
          : this.ui.text(this.t('profile.not_registered', {}, locale)),
      );
    }
    const extra = await this.ctx.profile.render(
      { memberId: row.id, discordUserId: row.discordUserId },
      locale,
      (bot, err) => this.ctx.log.warn({ err, section: bot }, 'profile section failed'),
    );
    const msg = this.ui.profile(row, mutant, locale, extra, await this.powersLine(mutant, locale));
    const hint = targetId === i.userId ? this.originHint(mutant, locale) : null;
    await r.reply(await this.withCard(hint ? { ...msg, content: hint } : msg, row, mutant, locale));
  }

  /** Adds the PNG card to the first embed (faction color, image) when it renders. */
  private async withCard(msg: OutgoingMessage, row: MemberRow, mutant: MutantRow, locale?: Locale) {
    const color = this.sheet.factionColor(row.faction);
    const [first, ...rest] = msg.embeds ?? [];
    const embed = first && color ? { ...first, color: Number.parseInt(color.slice(1), 16) } : first;
    const file = await this.sheet.file(row, mutant, locale);
    if (!embed) return msg;
    return {
      ...msg,
      embeds: [file ? { ...embed, image: { url: `attachment://${CARD_FILE}` } } : embed, ...rest],
      ...(file ? { files: [file] } : {}),
    };
  }

  async share(i: IncomingInteraction, r: Responder, memberId: string): Promise<void> {
    const locale = await this.locale(i.userId);
    const row = await this.repo.memberById(memberId);
    const mutant = row ? await this.repo.mutantByMemberId(row.id) : null;
    if (!row || !mutant) return r.reply(this.ui.text(this.t('profile.not_registered', {}, locale)));
    const extra = await this.ctx.profile.render(
      { memberId: row.id, discordUserId: row.discordUserId },
      this.ctx.i18n.defaultLocale,
    );
    try {
      await this.ctx.gateway.sendMessage(
        i.channelId,
        await this.withCard(
          {
            persona: 'cerebro',
            embeds: [this.ui.profileEmbed(row, mutant, undefined, extra, await this.powersLine(mutant))],
          },
          row,
          mutant,
        ),
      );
      await r.reply(this.ui.text(this.t('profile.shared', {}, locale)));
    } catch (err) {
      if (!(err instanceof GatewayError)) throw err;
      this.ctx.log.warn({ err }, 'could not share profile');
      await r.reply(this.ui.text(this.ctx.i18n.t('core.errors.generic', {}, locale)));
    }
  }
}
