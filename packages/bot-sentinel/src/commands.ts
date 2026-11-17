import type { BotContext, I18n, IncomingInteraction, Responder, SlashCommandDefinition } from '@legion/core';
import type { SentinelConfig } from './config.js';
import type { SentinelServices } from './services.js';

export const desc = (i18n: I18n, key: string) => ({
  description: i18n.t(key, {}, 'pt-BR').slice(0, 100),
  description_localizations: { 'en-US': i18n.t(key, {}, 'en').slice(0, 100) },
});

export function sentinelCommands(
  ctx: BotContext<SentinelConfig>,
  s: SentinelServices,
): SlashCommandDefinition[] {
  const { i18n } = ctx;
  const reply = async (
    i: IncomingInteraction,
    r: Responder,
    key: string,
    v: Record<string, string | number> = {},
  ) =>
    r.reply({
      persona: 'sentinel',
      ephemeral: true,
      content: i18n.t(key, v, await i18n.localeFor(i.userId)),
    });
  return [
    {
      name: 'treino',
      json: {
        name: 'treino',
        name_localizations: { 'en-US': 'training' },
        ...desc(i18n, 'sentinel.commands.treino'),
      },
      execute: (i, r) => s.combat.training(i, r),
    },
    {
      name: 'combate',
      json: {
        name: 'combate',
        name_localizations: { 'en-US': 'combat' },
        ...desc(i18n, 'sentinel.commands.combate.description'),
        options: [
          { type: 1, name: 'status', ...desc(i18n, 'sentinel.commands.combate.status') },
          {
            type: 1,
            name: 'log',
            ...desc(i18n, 'sentinel.commands.combate.log'),
            options: [{ type: 3, name: 'id', required: true, ...desc(i18n, 'sentinel.commands.combate.id') }],
          },
        ],
      },
      execute: async (i, r) => {
        if (i.subcommand === 'status') return s.combat.statusOf(i, r);
        const page = await s.combat.logPage(
          String(i.options?.id ?? '').trim(),
          0,
          await i18n.localeFor(i.userId),
        );
        return page ? r.reply(page) : reply(i, r, 'sentinel.errors.combat_not_found');
      },
    },
    {
      name: 'sentinel',
      json: {
        name: 'sentinel',
        ...desc(i18n, 'sentinel.commands.sentinel.description'),
        default_member_permissions: '0',
        options: [
          {
            type: 1,
            name: 'replay',
            ...desc(i18n, 'sentinel.commands.sentinel.replay'),
            options: [
              {
                type: 3,
                name: 'combate',
                name_localizations: { 'en-US': 'combat' },
                required: true,
                ...desc(i18n, 'sentinel.commands.combate.id'),
              },
            ],
          },
        ],
      },
      execute: async (i, r) => {
        if (!(await ctx.isStaff(i))) return reply(i, r, 'sentinel.errors.not_staff');
        const id = String(i.options?.combate ?? '').trim();
        const v = await s.combat.verify(id);
        if (!v) return reply(i, r, 'sentinel.errors.combat_not_found');
        return reply(i, r, v.ok ? 'sentinel.replay.ok' : 'sentinel.replay.mismatch', {
          id,
          stored: v.stored?.slice(0, 16) ?? '—',
          computed: v.computed.slice(0, 16),
        });
      },
    },
  ];
}
