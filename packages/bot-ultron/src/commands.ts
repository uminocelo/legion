import type { BotContext, I18n, SlashCommandDefinition } from '@legion/core';
import { DIFFICULTIES, type UltronConfig } from './config.js';
import type { UltronServices } from './services.js';

export const desc = (i18n: I18n, key: string) => ({
  description: i18n.t(key, {}, 'pt-BR').slice(0, 100),
  description_localizations: { 'en-US': i18n.t(key, {}, 'en').slice(0, 100) },
});

const choicesOf = (i18n: I18n, values: readonly string[], prefix: string) =>
  values.map((v) => ({
    name: i18n.t(`${prefix}.${v}`, {}, 'pt-BR'),
    name_localizations: { 'en-US': i18n.t(`${prefix}.${v}`, {}, 'en') },
    value: v,
  }));

export function ultronCommands(ctx: BotContext<UltronConfig>, s: UltronServices): SlashCommandDefinition[] {
  const { i18n } = ctx;
  return [
    {
      name: 'ultron',
      json: {
        name: 'ultron',
        ...desc(i18n, 'ultron.commands.ultron.description'),
        default_member_permissions: '0',
        options: [
          {
            type: 1,
            name: 'spawn',
            ...desc(i18n, 'ultron.commands.ultron.spawn'),
            options: [
              {
                type: 3,
                name: 'dificuldade',
                name_localizations: { 'en-US': 'difficulty' },
                required: true,
                choices: choicesOf(i18n, DIFFICULTIES, 'ultron.difficulty'),
                ...desc(i18n, 'ultron.commands.ultron.dificuldade'),
              },
              ...[1, 2, 3, 4].map((n) => ({
                type: 6,
                name: `membro${n}`,
                name_localizations: { 'en-US': `member${n}` },
                required: false,
                ...desc(i18n, 'ultron.commands.ultron.membro'),
              })),
            ],
          },
        ],
      },
      execute: async (i, r) => {
        if (!(await ctx.isStaff(i)))
          return r.reply({
            persona: 'ultron',
            ephemeral: true,
            content: i18n.t('ultron.errors.not_staff', {}, await i18n.localeFor(i.userId)),
          });
        return s.encounters.spawnCommand(i, r);
      },
    },
  ];
}
