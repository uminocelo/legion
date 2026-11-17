import type { BotContext, IncomingInteraction, Responder } from '@legion/core';
import type { UltronConfig } from './config.js';
import type { EventsRepo } from './db/events-repo.js';
import type { UltronRepo } from './db/repo.js';
import type { EncounterService } from './encounters.js';
import type { FlavorText } from './flavor.js';

/** /ultron status: next events, last results, adaptive multiplier, AI provider. */
export class StatusService {
  constructor(
    private readonly ctx: BotContext<UltronConfig>,
    private readonly repo: UltronRepo,
    private readonly events: EventsRepo,
    private readonly encounters: EncounterService,
    private readonly flavor: FlavorText,
  ) {}

  async reply(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const t = (k: string, v: Record<string, string | number> = {}) => this.ctx.i18n.t(k, v, l);
    const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
    const name = async (id: string) => (await this.repo.template(id))?.name ?? id;
    const open = await this.events.openEvents();
    const next = await Promise.all(
      open
        .slice(0, 5)
        .map(
          async (e) =>
            `• ${t(`ultron.kinds.${e.kind}`)} · ${await name(e.templateId)} · ${t(`ultron.status.state_${e.status}`)} · <t:${unix(e.startsAt)}:f>`,
        ),
    );
    const last = await Promise.all(
      (await this.events.lastEnded(null, 3)).map(
        async (e) =>
          `• ${t(`ultron.kinds.${e.kind}`)} · ${await name(e.templateId)} · ${t(`ultron.events.outcome_${e.outcome ?? 'defeat'}`)} · <t:${unix(e.endsAt)}:d>`,
      ),
    );
    const a = await this.encounters.currentAdaptive();
    const cfg = this.ctx.botConfig;
    const adaptive = cfg.adaptive.enabled
      ? t('ultron.status.adaptive_on', {
          m: a.multiplier.toFixed(3),
          n: a.sample,
          min: cfg.adaptive.minSample,
        })
      : t('ultron.status.adaptive_off');
    const hourAgo = new Date(this.ctx.clock.now().getTime() - 3_600_000).toISOString();
    const stats = await this.repo.flavorStats(hourAgo);
    const ai =
      this.flavor.provider === 'none'
        ? t('ultron.status.ai_none')
        : t('ultron.status.ai_on', { calls: stats.calls, ok: stats.ok, max: cfg.ai.maxCallsPerHour });
    const encounters = await this.repo.recentEncounters(3);
    const enc = encounters.map(
      (e) =>
        `• ${t(`ultron.difficulty.${e.difficulty}`)} · ${t('ultron.status.level', { n: e.partyLevel })} · ×${e.partySize} · ${e.outcome ? t(`ultron.status.outcome_${e.outcome}`) : t('ultron.status.in_progress')}`,
    );
    await r.reply({
      persona: 'ultron',
      ephemeral: true,
      embeds: [
        {
          title: t('ultron.status.title'),
          color: 0xc0392b,
          fields: [
            { name: t('ultron.status.next'), value: next.join('\n') || '—' },
            { name: t('ultron.status.last'), value: last.join('\n') || '—' },
            { name: t('ultron.status.encounters'), value: enc.join('\n') || '—' },
            { name: t('ultron.status.adaptive'), value: adaptive, inline: true },
            { name: t('ultron.status.ai'), value: ai, inline: true },
          ],
        },
      ],
    });
  }
}
