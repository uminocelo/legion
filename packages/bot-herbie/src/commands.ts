import type { BotContext, I18n, Locale, OutgoingMessage, SlashCommandDefinition } from '@legion/core';
import type { HerbieConfig } from './config.js';
import type { HerbieServices } from './services.js';

export const desc = (i18n: I18n, key: string) => ({
  description: i18n.t(key, {}, 'pt-BR').slice(0, 100),
  description_localizations: { 'en-US': i18n.t(key, {}, 'en').slice(0, 100) },
});

export function herbieCommands(ctx: BotContext<HerbieConfig>, s: HerbieServices): SlashCommandDefinition[] {
  const { i18n } = ctx;
  const staffOnly = async (
    i: Parameters<SlashCommandDefinition['execute']>[0],
    r: Parameters<SlashCommandDefinition['execute']>[1],
  ) => {
    if (await ctx.isStaff(i)) return true;
    await r.reply({
      persona: 'herbie',
      ephemeral: true,
      content: i18n.t('herbie.errors.not_staff', {}, await i18n.localeFor(i.userId)),
    });
    return false;
  };
  return [
    {
      name: 'ajuda',
      json: {
        name: 'ajuda',
        name_localizations: { 'en-US': 'help' },
        ...desc(i18n, 'herbie.commands.ajuda.description'),
        options: [
          {
            type: 3,
            name: 'topico',
            name_localizations: { 'en-US': 'topic' },
            required: false,
            autocomplete: true,
            ...desc(i18n, 'herbie.commands.ajuda.topico'),
          },
        ],
      },
      execute: (i, r) => s.help.ajuda(i, r),
      autocomplete: (i, r) => s.help.ajudaAutocomplete(i, r),
    },
    {
      name: 'regras',
      json: {
        name: 'regras',
        name_localizations: { 'en-US': 'rules' },
        ...desc(i18n, 'herbie.commands.regras.description'),
        options: [
          {
            type: 3,
            name: 'termo',
            name_localizations: { 'en-US': 'term' },
            required: false,
            autocomplete: true,
            ...desc(i18n, 'herbie.commands.regras.termo'),
          },
        ],
      },
      execute: (i, r) => s.help.regras(i, r),
      autocomplete: (i, r) => s.help.regrasAutocomplete(i, r),
    },
    {
      name: 'idioma',
      json: {
        name: 'idioma',
        name_localizations: { 'en-US': 'language' },
        ...desc(i18n, 'herbie.commands.idioma.description'),
        options: [
          {
            type: 3,
            name: 'idioma',
            name_localizations: { 'en-US': 'language' },
            required: true,
            choices: [
              { name: 'Português (Brasil)', value: 'pt-BR' },
              { name: 'English', value: 'en' },
            ],
            ...desc(i18n, 'herbie.commands.idioma.idioma'),
          },
        ],
      },
      execute: (i, r) => s.help.idioma(i, r),
    },
    {
      name: 'herbie',
      json: {
        name: 'herbie',
        ...desc(i18n, 'herbie.commands.herbie.description'),
        default_member_permissions: '0',
        options: [
          {
            type: 1,
            name: 'dica-agora',
            name_localizations: { 'en-US': 'tip-now' },
            ...desc(i18n, 'herbie.commands.herbie.dica'),
          },
          { type: 1, name: 'status', ...desc(i18n, 'herbie.commands.herbie.status') },
        ],
      },
      execute: async (i, r) => {
        if (!(await staffOnly(i, r))) return;
        const l = await i18n.localeFor(i.userId);
        if (i.subcommand === 'dica-agora') {
          const id = await s.help.postTip();
          return r.reply({
            persona: 'herbie',
            ephemeral: true,
            content: id
              ? i18n.t('herbie.staff.tip_posted', { id }, l)
              : i18n.t('herbie.staff.tip_none', {}, l),
          });
        }
        return r.reply(await herbieStatus(ctx, s, l));
      },
    },
    {
      name: 'tutorial',
      json: {
        name: 'tutorial',
        ...desc(i18n, 'herbie.commands.tutorial.description'),
        options: [
          {
            type: 5,
            name: 'reiniciar',
            name_localizations: { 'en-US': 'restart' },
            required: false,
            ...desc(i18n, 'herbie.commands.tutorial.reiniciar'),
          },
        ],
      },
      execute: (i, r) => s.tutorial.command(i, r, i.options?.reiniciar === true),
    },
  ];
}

/** Tutorial funnel for staff: started, per step, completed, skipped, DM fallbacks. */
async function herbieStatus(
  ctx: BotContext<HerbieConfig>,
  s: HerbieServices,
  l: Locale,
): Promise<OutgoingMessage> {
  const t = (k: string, v: Record<string, string | number> = {}) => ctx.i18n.t(k, v, l);
  const all = await s.repo.allProgress();
  const counts = new Map((await s.repo.stepCounts()).map((c) => [c.stepId, c.n]));
  const steps = s.tutorial.steps().map((st, n) => `${n + 1}. ${t(st.titleKey)}: ${counts.get(st.id) ?? 0}`);
  const by = (status: string) => all.filter((p) => p.status === status).length;
  return {
    persona: 'herbie',
    ephemeral: true,
    embeds: [
      {
        title: t('herbie.staff.status_title'),
        fields: [
          { name: t('herbie.staff.started'), value: String(all.length), inline: true },
          { name: t('herbie.staff.completed'), value: String(by('completed')), inline: true },
          { name: t('herbie.staff.skipped'), value: String(by('skipped')), inline: true },
          {
            name: t('herbie.staff.fallback'),
            value: String(all.filter((p) => p.deliveryFallback).length),
            inline: true,
          },
          { name: t('herbie.staff.per_step'), value: steps.join('\n') || '—' },
          {
            name: t('herbie.staff.tips'),
            value: ctx.botConfig.tips.enabled
              ? t('herbie.staff.tips_on', {
                  channel: ctx.botConfig.tips.channelId ? `<#${ctx.botConfig.tips.channelId}>` : '—',
                })
              : t('herbie.staff.tips_off'),
          },
        ],
      },
    ],
  };
}
