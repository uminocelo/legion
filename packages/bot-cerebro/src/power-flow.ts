import {
  type ActionRow,
  customId,
  type Embed,
  type IncomingInteraction,
  type Locale,
  type OutgoingMessage,
  type Responder,
} from '@legion/core';
import type { MemberRow } from './db/repo.js';
import { type PendingPowers, pendingPowersOf } from './db/repo.js';
import type { CerebroFlow } from './flow.js';
import { type Power, PowerCatalog, powerDescription, powerName } from './powers.js';
import { V } from './ui.js';

/** `r` = registration (before the codename form), `e` = `/mutante poderes` for an existing mutant. */
export type PickMode = 'r' | 'e';
export const powerIds = {
  main: (mode: PickMode, group: number) => customId('cerebro', V, 'pmain', mode, group),
  secondary: (mode: PickMode, group: number) => customId('cerebro', V, 'psec', mode, group),
  next: (mode: PickMode) => customId('cerebro', V, 'pnext', mode),
  back: (mode: PickMode) => customId('cerebro', V, 'pback', mode),
};

const MAX_GROUPS = 4;
const clip = (s: string, n = 100) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Picking powers from the catalog: one main power (its type sets the archetype) and up to
 * `maxSecondary` secondary ones. The choice is kept in `members.pending_powers` until saved.
 */
export class PowerFlow {
  readonly catalog: PowerCatalog;

  constructor(private readonly flow: CerebroFlow) {
    const cfg = flow.ctx.botConfig.powers;
    this.catalog = new PowerCatalog(cfg.typeToArchetype, flow.ctx.botConfig.archetypes);
  }

  private get cfg() {
    return this.flow.ctx.botConfig.powers;
  }
  get enabled() {
    return this.cfg.enabled && this.catalog.all().length > 0;
  }
  private t(key: string, vars: Record<string, string | number> = {}, locale?: Locale) {
    return this.flow.ctx.i18n.t(`cerebro.powers.${key}`, vars, locale);
  }

  load() {
    const res = this.catalog.load();
    if (res.errors.length)
      this.flow.ctx.log.warn(
        { errors: res.errors },
        'power catalog has errors; keeping the previous catalog',
      );
    return res;
  }

  typeLabel(p: Power, locale?: Locale) {
    return this.t(`type.${p.type}`, {}, locale);
  }
  label(id: string, locale?: Locale) {
    const p = this.catalog.get(id);
    return p ? powerName(p, locale) : id;
  }

  /** "★ Telecinese · Voo · Criocinese" for the sheet. */
  sheetLine(powers: { main: string | null; secondary: string[] }, locale?: Locale): string | null {
    if (!powers.main) return null;
    return [
      `★ ${this.label(powers.main, locale)}`,
      ...powers.secondary.map((id) => this.label(id, locale)),
    ].join(' · ');
  }

  // ---------- screen ----------

  screen(
    locale: Locale,
    pending: PendingPowers,
    mode: PickMode,
    prefix?: string,
    archetype?: string,
  ): OutgoingMessage {
    const main = pending.main ? this.catalog.get(pending.main) : undefined;
    const rows: ActionRow[] = [];
    let embed: Embed;
    if (!main) {
      embed = { title: this.t('main_title', {}, locale), description: this.t('main_body', {}, locale) };
      this.catalog
        .groups()
        .slice(0, MAX_GROUPS)
        .forEach((group, g) => {
          rows.push([
            {
              type: 'select',
              customId: powerIds.main(mode, g),
              placeholder: clip(this.placeholder(group, locale), 150),
              options: group.map((p) => ({
                value: p.id,
                label: clip(powerName(p, locale)),
                description: clip(
                  `${this.typeLabel(p, locale)} → ${this.catalog.archetypeOf(p)} · ${powerDescription(p, locale)}`,
                ),
              })),
            },
          ]);
        });
    } else {
      const derived = this.catalog.archetypeOf(main);
      const keeps = mode === 'e' && !this.cfg.allowArchetypeChange && archetype && archetype !== derived;
      const lines = [
        this.t(
          'main_chosen',
          { power: powerName(main, locale), archetype: keeps ? archetype : derived },
          locale,
        ),
        ...(keeps ? [this.t('archetype_kept', { archetype }, locale)] : []),
        '',
        this.cfg.maxSecondary
          ? this.t('secondary_body', { max: this.cfg.maxSecondary }, locale)
          : this.t('no_secondary', {}, locale),
        ...(pending.secondary.length
          ? [
              this.t(
                'secondary_chosen',
                { list: pending.secondary.map((id) => this.label(id, locale)).join(', ') },
                locale,
              ),
            ]
          : []),
      ];
      embed = { title: this.t('secondary_title', {}, locale), description: lines.join('\n') };
      if (this.cfg.maxSecondary)
        this.catalog
          .groups([main.id])
          .slice(0, MAX_GROUPS - 1)
          .forEach((group, g) => {
            rows.push([
              {
                type: 'select',
                customId: powerIds.secondary(mode, g),
                placeholder: clip(this.placeholder(group, locale), 150),
                minValues: 0,
                maxValues: Math.min(this.cfg.maxSecondary, group.length),
                options: group.map((p) => ({
                  value: p.id,
                  label: clip(powerName(p, locale)),
                  description: clip(`${this.typeLabel(p, locale)} · ${powerDescription(p, locale)}`),
                  default: pending.secondary.includes(p.id),
                })),
              },
            ]);
          });
      rows.push([
        {
          type: 'button',
          customId: powerIds.next(mode),
          label: this.t(mode === 'r' ? 'next_register' : 'next_save', {}, locale),
          style: 'success',
          emoji: mode === 'r' ? '📝' : '💾',
        },
        {
          type: 'button',
          customId: powerIds.back(mode),
          label: this.t('back', {}, locale),
          style: 'secondary',
        },
      ]);
    }
    return {
      persona: 'cerebro',
      ephemeral: true,
      ...(prefix ? { content: prefix } : {}),
      embeds: [embed],
      components: rows,
    };
  }

  private placeholder(group: Power[], locale: Locale) {
    const types = [...new Set(group.map((p) => this.typeLabel(p, locale)))];
    return this.t('placeholder', { types: types.join(', ') }, locale);
  }

  // ---------- handlers ----------

  /** The member and, for `/mutante poderes`, their mutant, or an error screen already sent. */
  private async context(i: IncomingInteraction, r: Responder, mode: PickMode) {
    const locale = await this.flow.locale(i.userId);
    const row = await this.flow.repo.memberByDiscordId(i.userId);
    if (mode === 'r') {
      if (row?.onboardingStep !== 'faction_chosen' || !this.enabled) {
        const screen = row
          ? await this.flow.currentScreen(
              row,
              locale,
              this.flow.ctx.i18n.t('cerebro.errors.continue', {}, locale),
            )
          : this.flow.ui.text(this.flow.ctx.i18n.t('cerebro.errors.continue', {}, locale));
        await r.update(screen);
        return null;
      }
      return { locale, row, archetype: undefined };
    }
    const mutant =
      row?.onboardingStep === 'registered' ? await this.flow.repo.mutantByMemberId(row.id) : null;
    if (!row || !mutant) {
      await r.update(this.flow.ui.text(this.flow.ctx.i18n.t('cerebro.profile.not_registered', {}, locale)));
      return null;
    }
    if ((await this.flow.repo.powersOf(mutant.id)).main) {
      await r.update({ ...this.flow.ui.text(this.t('already', {}, locale)), embeds: [], components: [] });
      return null;
    }
    return { locale, row, mutant, archetype: mutant.archetype };
  }

  private async save(row: MemberRow, pending: PendingPowers, mode: PickMode) {
    const main = pending.main ? this.catalog.get(pending.main) : undefined;
    const patch: Partial<MemberRow> = { pendingPowers: JSON.stringify(pending) };
    if (mode === 'r') patch.pendingArchetype = main ? this.catalog.archetypeOf(main) : null;
    return (await this.flow.repo.updateMember(row.id, patch)) ?? row;
  }

  async chooseMain(i: IncomingInteraction, r: Responder, mode: PickMode) {
    const c = await this.context(i, r, mode);
    if (!c) return;
    const power = this.catalog.get(i.values?.[0] ?? '');
    if (!power)
      return r.update(
        this.screen(
          c.locale,
          pendingPowersOf(c.row),
          mode,
          this.flow.ctx.i18n.t('cerebro.errors.invalid_choice', {}, c.locale),
          c.archetype,
        ),
      );
    const prev = pendingPowersOf(c.row);
    const pending = { main: power.id, secondary: prev.secondary.filter((id) => id !== power.id) };
    await this.save(c.row, pending, mode);
    await r.update(this.screen(c.locale, pending, mode, undefined, c.archetype));
  }

  /** One secondary menu changed: replaces the picks from that menu, keeps the others. */
  async chooseSecondary(i: IncomingInteraction, r: Responder, mode: PickMode, group: number) {
    const c = await this.context(i, r, mode);
    if (!c) return;
    const prev = pendingPowersOf(c.row);
    if (!prev.main) return r.update(this.screen(c.locale, prev, mode, undefined, c.archetype));
    const inMenu = new Set((this.catalog.groups([prev.main])[group] ?? []).map((p) => p.id));
    const picked = (i.values ?? []).filter((id) => inMenu.has(id) && this.catalog.get(id));
    const secondary = [...prev.secondary.filter((id) => !inMenu.has(id)), ...picked];
    if (secondary.length > this.cfg.maxSecondary)
      return r.update(
        this.screen(
          c.locale,
          prev,
          mode,
          this.t('too_many', { max: this.cfg.maxSecondary }, c.locale),
          c.archetype,
        ),
      );
    const pending = { main: prev.main, secondary };
    await this.save(c.row, pending, mode);
    await r.update(this.screen(c.locale, pending, mode, undefined, c.archetype));
  }

  async back(i: IncomingInteraction, r: Responder, mode: PickMode) {
    const c = await this.context(i, r, mode);
    if (!c) return;
    const pending = { main: null, secondary: [] };
    await this.save(c.row, pending, mode);
    await r.update(this.screen(c.locale, pending, mode, undefined, c.archetype));
  }

  /** Registration: open the codename form. `/mutante poderes`: save once. */
  async next(i: IncomingInteraction, r: Responder, mode: PickMode) {
    const c = await this.context(i, r, mode);
    if (!c) return;
    const pending = pendingPowersOf(c.row);
    const main = pending.main ? this.catalog.get(pending.main) : undefined;
    if (!main)
      return r.update(this.screen(c.locale, pending, mode, this.t('pick_main', {}, c.locale), c.archetype));
    if (mode === 'r') return r.showModal(this.flow.ui.mutantModal(c.locale));
    const mutant = c.mutant;
    if (!mutant) return;
    const secondary = pending.secondary
      .filter((id) => id !== main.id && this.catalog.get(id))
      .slice(0, this.cfg.maxSecondary);
    const derived = this.catalog.archetypeOf(main);
    const changes = this.cfg.allowArchetypeChange && derived !== mutant.archetype;
    const saved = await this.flow.ctx.db.transaction(async (tx) => {
      if ((await this.flow.repo.powersOf(mutant.id, tx)).main) return false;
      await this.flow.repo.insertPowers(mutant.id, { main: main.id, secondary }, tx);
      if (changes) await this.flow.repo.updateMutant(mutant.id, { archetype: derived }, tx);
      await this.flow.repo.updateMember(c.row.id, { pendingPowers: null }, tx);
      return true;
    });
    if (!saved)
      return r.update({ ...this.flow.ui.text(this.t('already', {}, c.locale)), embeds: [], components: [] });
    this.flow.ctx.log.info(
      { userId: i.userId, main: main.id, secondary, archetypeChanged: changes },
      'mutant powers set',
    );
    const line = this.sheetLine({ main: main.id, secondary }, c.locale) ?? '';
    await r.update({
      ...this.flow.ui.text(
        this.t(
          changes ? 'saved_changed' : 'saved',
          { powers: line, archetype: changes ? derived : mutant.archetype },
          c.locale,
        ),
      ),
      embeds: [],
      components: [],
    });
  }

  /** `/mutante poderes`. */
  async command(i: IncomingInteraction, r: Responder) {
    const locale = await this.flow.locale(i.userId);
    if (!this.enabled) return r.reply(this.flow.ui.text(this.t('disabled', {}, locale)));
    const row = await this.flow.repo.memberByDiscordId(i.userId);
    const mutant =
      row?.onboardingStep === 'registered' ? await this.flow.repo.mutantByMemberId(row.id) : null;
    if (!row || !mutant)
      return r.reply(this.flow.ui.text(this.flow.ctx.i18n.t('cerebro.profile.not_registered', {}, locale)));
    const have = await this.flow.repo.powersOf(mutant.id);
    if (have.main)
      return r.reply(
        this.flow.ui.text(this.t('already_list', { powers: this.sheetLine(have, locale) ?? '' }, locale)),
      );
    await r.reply(this.screen(locale, pendingPowersOf(row), 'e', undefined, mutant.archetype));
  }
}
