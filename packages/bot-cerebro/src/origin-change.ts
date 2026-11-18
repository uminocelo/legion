import type { IncomingInteraction, Locale, OutgoingMessage, Responder } from '@legion/core';
import type { MemberRow, MutantRow } from './db/repo.js';
import type { CerebroFlow } from './flow.js';

/**
 * `/heroi origem`: heroes created before v0.9 (`origin_rechoice = 1`) may pick their origin once
 * (ADR 0031, D15). Powers that still fit are kept; otherwise the power picker opens in mode `o`.
 * Cancelling changes nothing and keeps the flag; finishing (even on the same origin) clears it.
 */
export class OriginChange {
  constructor(private readonly flow: CerebroFlow) {}

  private t(key: string, vars: Record<string, string | number> = {}, locale?: Locale) {
    return this.flow.ctx.i18n.t(`cerebro.origin_change.${key}`, vars, locale);
  }
  private done(content: string): OutgoingMessage {
    return { ...this.flow.ui.text(content), embeds: [], components: [] };
  }

  /** The member and their hero, or null after replying with the reason. */
  private async load(i: IncomingInteraction, r: Responder, reply: 'reply' | 'update') {
    const locale = await this.flow.locale(i.userId);
    const row = await this.flow.repo.memberByDiscordId(i.userId);
    const mutant =
      row?.onboardingStep === 'registered' ? await this.flow.repo.mutantByMemberId(row.id) : null;
    const send = (msg: OutgoingMessage) => (reply === 'reply' ? r.reply(msg) : r.update(msg));
    if (!row || !mutant) {
      await send(this.done(this.flow.ctx.i18n.t('cerebro.profile.not_registered', {}, locale)));
      return null;
    }
    if (mutant.originRechoice !== 1) {
      await send(this.done(this.t('used', {}, locale)));
      return null;
    }
    return { locale, row, mutant };
  }

  /** `/heroi origem`. */
  async command(i: IncomingInteraction, r: Responder): Promise<void> {
    const c = await this.load(i, r, 'reply');
    if (!c) return;
    const current = this.flow.ui.originLabel(c.mutant.originType, c.locale);
    await r.reply(
      this.flow.ui.origin(
        c.locale,
        this.flow.visibleOrigins(),
        c.mutant.originType,
        this.t('current', { origin: current }, c.locale),
        true,
      ),
    );
  }

  /** The origin menu of `/heroi origem`. */
  async choose(i: IncomingInteraction, r: Responder): Promise<void> {
    const c = await this.load(i, r, 'update');
    if (!c) return;
    const origin = i.values?.[0];
    if (!this.flow.isVisibleOrigin(origin))
      return r.update(
        this.flow.ui.origin(
          c.locale,
          this.flow.visibleOrigins(),
          c.mutant.originType,
          this.flow.ctx.i18n.t('cerebro.errors.invalid_choice', {}, c.locale),
          true,
        ),
      );
    const { catalog } = this.flow.powers;
    const have = await this.flow.repo.powersOf(c.mutant.id);
    const fits = (id: string) => Boolean(catalog.get(id, origin));
    const allFit = !have.main || ![have.main, ...have.secondary].some((id) => !fits(id));
    if (allFit || !this.flow.powers.enabled) return this.finish(i, r, c.row, c.mutant, origin, null);
    // Some powers do not fit: keep the ones that do and open the picker.
    const pending = {
      main: fits(have.main ?? '') ? have.main : null,
      secondary: have.secondary.filter(fits),
    };
    await this.flow.repo.updateMember(c.row.id, {
      pendingOrigin: origin,
      pendingPowers: JSON.stringify(pending),
    });
    await r.update(
      this.flow.powers.screen(
        c.locale,
        pending,
        'o',
        this.t('pick_powers', { origin: this.flow.ui.originLabel(origin, c.locale) }, c.locale),
        c.mutant.archetype,
        origin,
      ),
    );
  }

  /** "Cancelar" on the origin menu or the picker: nothing changes, the flag stays. */
  async cancel(i: IncomingInteraction, r: Responder): Promise<void> {
    const locale = await this.flow.locale(i.userId);
    const row = await this.flow.repo.memberByDiscordId(i.userId);
    if (row && (row.pendingOrigin || row.pendingPowers) && row.onboardingStep === 'registered')
      await this.flow.repo.updateMember(row.id, { pendingOrigin: null, pendingPowers: null });
    await r.update(this.done(this.t('cancelled', {}, locale)));
  }

  /** Saves the new origin (and new powers, when the picker ran) and clears the flag, once. */
  async finish(
    i: IncomingInteraction,
    r: Responder,
    row: MemberRow,
    mutant: MutantRow,
    origin: string,
    powers: { main: string; secondary: string[] } | null,
  ): Promise<void> {
    const locale = await this.flow.locale(i.userId);
    const cfg = this.flow.ctx.botConfig.powers;
    const main = powers ? this.flow.powers.catalog.get(powers.main, origin) : undefined;
    const derived = main ? this.flow.powers.catalog.archetypeOf(main) : null;
    const archetype = derived && cfg.allowArchetypeChange ? derived : mutant.archetype;
    const saved = await this.flow.ctx.db.transaction(async (tx) => {
      const fresh = await this.flow.repo.mutantByMemberId(mutant.memberId, tx);
      if (fresh?.originRechoice !== 1) return false;
      if (powers) await this.flow.repo.replacePowers(fresh.id, powers, tx);
      await this.flow.repo.updateMutant(fresh.id, { originType: origin, originRechoice: 0, archetype }, tx);
      await this.flow.repo.updateMember(row.id, { pendingOrigin: null, pendingPowers: null }, tx);
      return true;
    });
    if (!saved) return r.update(this.done(this.t('used', {}, locale)));
    this.flow.ctx.log.info(
      { userId: i.userId, from: mutant.originType, to: origin, powersChanged: Boolean(powers) },
      'hero origin changed',
    );
    const label = this.flow.ui.originLabel(origin, locale);
    const line = powers ? this.flow.powers.sheetLine(powers, locale) : null;
    await r.update(
      this.done(
        line
          ? this.t('saved_powers', { origin: label, powers: line }, locale)
          : this.t('saved', { origin: label }, locale),
      ),
    );
  }
}
