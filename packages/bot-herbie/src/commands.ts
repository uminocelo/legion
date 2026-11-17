import type { BotContext, I18n, SlashCommandDefinition } from '@legion/core';
import type { HerbieConfig } from './config.js';
import type { HerbieServices } from './services.js';

export const desc = (i18n: I18n, key: string) => ({
  description: i18n.t(key, {}, 'pt-BR').slice(0, 100),
  description_localizations: { 'en-US': i18n.t(key, {}, 'en').slice(0, 100) },
});

export function herbieCommands(ctx: BotContext<HerbieConfig>, s: HerbieServices): SlashCommandDefinition[] {
  const { i18n } = ctx;
  return [
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
