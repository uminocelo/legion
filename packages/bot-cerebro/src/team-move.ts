import { factionAllowsOrigin, type IncomingInteraction, type Responder } from '@legion/core';
import { recordFactionChange } from './faction-join.js';
import type { CerebroFlow } from './flow.js';

/**
 * `/cerebro equipe mover membro equipe motivo` (staff, checked by the command). Moves a hero to an
 * enabled team, bypassing the cooldown and the origin rule, and records who did it and why.
 */
export class TeamMove {
  constructor(private readonly flow: CerebroFlow) {}

  async command(i: IncomingInteraction, r: Responder): Promise<void> {
    const { ctx, repo, ui } = this.flow;
    const locale = await ctx.i18n.localeFor(i.userId);
    const t = (k: string, v: Record<string, string | number> = {}) =>
      ctx.i18n.t(`cerebro.team_move.${k}`, v, locale);
    const targetId = typeof i.options?.membro === 'string' ? i.options.membro : '';
    const to = typeof i.options?.equipe === 'string' ? i.options.equipe : '';
    const reason = (typeof i.options?.motivo === 'string' ? i.options.motivo : '').trim();
    const team = ctx.config.factions.find((f) => f.key === to);
    if (!team) return r.reply(ui.text(t('unknown_team')));
    if (!reason || reason.length > 200) return r.reply(ui.text(t('reason_length')));
    const row = await repo.memberByDiscordId(targetId);
    const mutant = row?.onboardingStep === 'registered' ? await repo.mutantByMemberId(row.id) : null;
    if (!row || !mutant) return r.reply(ui.text(t('not_registered')));
    const label = (k: string | null) => ui.factionLabel(k, locale);
    if (row.faction === to) return r.reply(ui.text(t('same', { codename: mutant.codename, to: label(to) })));

    const sourceKey = `staff:${i.id}`;
    const updated = await ctx.bus.transaction((tx) =>
      recordFactionChange(this.flow, tx, { memberId: row.id, to, reason: 'staff', sourceKey, by: i.userId }),
    );
    if (!updated) return r.reply(ui.text(t('same', { codename: mutant.codename, to: label(to) })));
    ctx.log.info({ staff: i.userId, memberId: row.id, from: row.faction, to, reason }, 'team move by staff');
    const rolesOk = await this.flow.applyExpectedRoles(updated);
    const lines = [t('moved', { codename: mutant.codename, to: label(to), from: label(row.faction) })];
    if (!factionAllowsOrigin(team, mutant.originType)) lines.push(t('origin_note'));
    if (!rolesOk) lines.push(ctx.i18n.t('cerebro.errors.role_permission', {}, locale));
    await r.reply(ui.text(lines.join('\n')));
  }
}
