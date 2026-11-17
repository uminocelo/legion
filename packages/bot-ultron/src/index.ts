import type { LegionBot } from '@legion/core';
import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { ultronCommands } from './commands.js';
import { type UltronConfig, ultronConfigSchema } from './config.js';
import { ULTRON_LOCALES_DIR, ULTRON_MIGRATIONS_DIR } from './paths.js';
import { ultronServices } from './services.js';

export * from './config.js';
export * from './content.js';
export * from './db/repo.js';
export * from './db/tables.js';
export * from './domain/scaling.js';
export { EncounterService, playerCombatantId } from './encounters.js';
export { type FlavorKind, FlavorText } from './flavor.js';
export { ULTRON_CONTENT_DIR, ULTRON_LOCALES_DIR, ULTRON_MIGRATIONS_DIR } from './paths.js';
export * from './services.js';

/** ULTRON: scaled enemies, world events and raids (v3). Never resolves combat itself. */
export const ultron: LegionBot<UltronConfig> = {
  id: 'ultron',
  version: '0.4.0',
  configSchema: ultronConfigSchema,
  intents: [GatewayIntentBits.Guilds],
  permissions: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.UseApplicationCommands,
  ],
  localesDir: ULTRON_LOCALES_DIR,
  migrationsDir: ULTRON_MIGRATIONS_DIR,
  commands: (ctx) => ultronCommands(ctx, ultronServices(ctx)),
  register: async (ctx) => {
    const s = ultronServices(ctx);
    await s.encounters.loadContent();
    ctx.bus.on('mission.started', 'ultron.spawner', (e) => s.encounters.onMissionStarted(e));
    ctx.bus.on('combat.resolved', 'ultron.encounter-result', (e) => s.encounters.onCombatResolved(e));
    ctx.help.add({
      bot: 'ultron',
      command: '/ultron',
      descriptionKey: 'ultron.help.ultron',
      adminOnly: true,
    });
  },
};

export default ultron;
