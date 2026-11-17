import type { LegionBot } from '@legion/core';
import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { herbieCommands } from './commands.js';
import { type HerbieConfig, herbieConfigSchema } from './config.js';
import { registerConsumers } from './consumers.js';
import { HERBIE_LOCALES_DIR, HERBIE_MIGRATIONS_DIR } from './paths.js';
import { herbieServices } from './services.js';
import { V } from './tutorial.js';

export * from './config.js';
export * from './content.js';
export * from './db/repo.js';
export * from './db/tables.js';
export * from './domain/quest.js';
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
    ];
  },
  register: (ctx) => {
    const s = herbieServices(ctx);
    s.tutorial.reload();
    registerConsumers(ctx, s);
    ctx.help.add({ bot: 'herbie', command: '/tutorial', descriptionKey: 'herbie.help.tutorial' });
  },
};

export default herbie;
