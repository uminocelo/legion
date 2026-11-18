import { type LegionBot, staffCommandsCheck } from '@legion/core';
import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { announceOrigins } from './announcements.js';
import { herbieCommands } from './commands.js';
import { type HerbieConfig, herbieConfigSchema } from './config.js';
import { registerConsumers } from './consumers.js';
import { herbieDoctorChecks } from './doctor.js';
import { HERBIE_LOCALES_DIR, HERBIE_MIGRATIONS_DIR } from './paths.js';
import { herbieServices } from './services.js';
import { V } from './tutorial.js';

export { announceOrigins, ORIGINS_ANNOUNCEMENT_KEY } from './announcements.js';
export * from './config.js';
export * from './content.js';
export * from './db/repo.js';
export * from './db/tables.js';
export * from './domain/quest.js';
export * from './domain/search.js';
export { GUIDE_KEY, type GuideSection, guideSchema, HerbieGuide, packEmbeds } from './guide.js';
export { HerbieHelp, helpIds } from './help.js';
export { HERBIE_CONTENT_DIR, HERBIE_LOCALES_DIR, HERBIE_MIGRATIONS_DIR } from './paths.js';
export * from './services.js';
export { HerbieTutorial, tutorialIds } from './tutorial.js';

/** H.E.R.B.I.E.: tutorial quests, help, glossary, language and tips (v2). */
export const herbie: LegionBot<HerbieConfig> = {
  id: 'herbie',
  version: '0.3.0',
  configSchema: herbieConfigSchema,
  intents: [GatewayIntentBits.Guilds],
  permissions: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.PinMessages,
    PermissionFlagsBits.UseApplicationCommands,
  ],
  localesDir: HERBIE_LOCALES_DIR,
  migrationsDir: HERBIE_MIGRATIONS_DIR,
  commands: (ctx) => herbieCommands(ctx, herbieServices(ctx)),
  components: (ctx) => {
    const s = herbieServices(ctx);
    return [
      { action: 'tutorial', version: V, handle: (i, r) => s.tutorial.command(i, r, false) },
      { action: 'skip', version: V, handle: (i, r) => s.tutorial.askSkip(i, r) },
      { action: 'skip-confirm', version: V, handle: (i, r) => s.tutorial.skip(i, r) },
      { action: 'glossary', version: V, handle: (i, r, [page]) => s.help.glossaryPage(i, r, Number(page)) },
    ];
  },
  register: (ctx) => {
    const s = herbieServices(ctx);
    s.tutorial.reload();
    s.help.reload();
    registerConsumers(ctx, s);
    ctx.provide('localeResolver', s.help.localeResolver);
    if (ctx.botConfig.tips.enabled)
      ctx.scheduler.every('herbie.daily-tip', ctx.botConfig.tips.cron, async () => {
        await s.help.postTip();
      });
    for (const [command, key, adminOnly] of [
      ['/ajuda', 'ajuda', false],
      ['/regras', 'regras', false],
      ['/tutorial', 'tutorial', false],
      ['/idioma', 'idioma', false],
      ['/herbie', 'herbie', true],
    ] as const)
      ctx.help.add({ bot: 'herbie', command, descriptionKey: `herbie.help.${key}`, adminOnly });
  },
  onReady: async (ctx) => {
    await announceOrigins(ctx);
  },
  doctorChecks: (ctx) => [...herbieDoctorChecks(ctx), staffCommandsCheck(ctx, ['herbie'])],
  doctorChannels: (cfg) => [
    { key: 'herbie.tips.channelId', id: cfg.tips.enabled ? cfg.tips.channelId : null },
  ],
};

export default herbie;
