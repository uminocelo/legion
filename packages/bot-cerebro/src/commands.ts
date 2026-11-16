import type { BotContext, I18n, IncomingInteraction, Responder, SlashCommandDefinition } from '@legion/core';
import type { CerebroConfig } from './config.js';
import type { CerebroFlow } from './flow.js';
import { type CerebroSetup, LAST_ROLE_SYNC_KEY, type LastRoleSync } from './setup.js';

const desc = (i18n: I18n, key: string) => ({
  description: i18n.t(key, {}, 'pt-BR').slice(0, 100),
  description_localizations: { 'en-US': i18n.t(key, {}, 'en').slice(0, 100) },
});

export function cerebroCommands(
  ctx: BotContext<CerebroConfig>,
  flow: CerebroFlow,
  setup: CerebroSetup,
): SlashCommandDefinition[] {
  const { i18n } = ctx;
  const staffOnly = async (i: IncomingInteraction, r: Responder) => {
    if (await ctx.isStaff(i)) return true;
    const locale = await i18n.localeFor(i.userId);
    await r.reply(flow.ui.text(i18n.t('cerebro.errors.not_staff', {}, locale)));
    return false;
  };

  return [
    {
      name: 'perfil',
      json: {
        name: 'perfil',
        name_localizations: { 'en-US': 'profile' },
        ...desc(i18n, 'cerebro.commands.perfil.description'),
        options: [
          {
            type: 6,
            name: 'membro',
            name_localizations: { 'en-US': 'member' },
            required: false,
            ...desc(i18n, 'cerebro.commands.perfil.membro'),
          },
        ],
      },
      execute: (i, r) => flow.profile(i, r),
    },
    {
      name: 'cerebro',
      json: {
        name: 'cerebro',
        ...desc(i18n, 'cerebro.commands.cerebro.description'),
        options: [
          {
            type: 1,
            name: 'preferencias',
            name_localizations: { 'en-US': 'preferences' },
            ...desc(i18n, 'cerebro.commands.cerebro.preferencias'),
          },
          {
            type: 1,
            name: 'setup',
            ...desc(i18n, 'cerebro.commands.cerebro.setup'),
            options: [
              {
                type: 5,
                name: 'aplicar',
                name_localizations: { 'en-US': 'apply' },
                required: false,
                ...desc(i18n, 'cerebro.commands.cerebro.aplicar'),
              },
              {
                type: 5,
                name: 'canais',
                name_localizations: { 'en-US': 'channels' },
                required: false,
                ...desc(i18n, 'cerebro.commands.cerebro.canais'),
              },
            ],
          },
          { type: 1, name: 'status', ...desc(i18n, 'cerebro.commands.cerebro.status') },
        ],
      },
      execute: async (i, r) => {
        switch (i.subcommand) {
          case 'preferencias':
            return flow.preferences(i, r);
          case 'setup': {
            if (!(await staffOnly(i, r))) return;
            await r.defer(true);
            const text = await setup.run({
              apply: i.options?.aplicar === true,
              channels: i.options?.canais === true,
            });
            return r.send(flow.ui.text(text));
          }
          case 'status': {
            if (!(await staffOnly(i, r))) return;
            await r.defer(true);
            return r.send(await statusMessage(ctx, flow, setup, await i18n.localeFor(i.userId)));
          }
          default:
            return flow.preferences(i, r);
        }
      },
    },
  ];
}

async function statusMessage(
  ctx: BotContext<CerebroConfig>,
  flow: CerebroFlow,
  setup: CerebroSetup,
  locale: 'pt-BR' | 'en',
) {
  const t = (k: string, v: Record<string, string | number> = {}) =>
    ctx.i18n.t(`cerebro.status.${k}`, v, locale);
  const counts = await flow.repo.countsByStep();
  const steps = ['signal', 'rules_accepted', 'faction_chosen', 'registered']
    .map((s) => `${s}: **${counts[s] ?? 0}**`)
    .join('\n');
  const last = await ctx.kv.get<LastRoleSync>(LAST_ROLE_SYNC_KEY);
  const missing = await setup.membersMissingRoles();
  const regName = ctx.roles.configFor('registered')?.name ?? 'registered';
  const warn = setup.hierarchyLine(await setup.hierarchyProblems());
  return {
    persona: 'cerebro' as const,
    ephemeral: true,
    ...(warn ? { content: warn } : {}),
    embeds: [
      {
        title: t('title'),
        fields: [
          { name: t('steps'), value: steps },
          { name: t('left'), value: String(await flow.repo.countLeft()), inline: true },
          {
            name: t('last_sync'),
            value: last ? `<t:${Math.floor(new Date(last.at).getTime() / 1000)}:R>` : t('never'),
            inline: true,
          },
          {
            name: t('missing_roles', { role: regName }),
            value: missing.length ? String(missing.length) : t('none'),
            inline: true,
          },
        ],
      },
    ],
  };
}
