import { type LegionBot, staffCommandsCheck } from '@legion/core';
import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { ultronCommands } from './commands.js';
import { type UltronConfig, ultronConfigSchema } from './config.js';
import { ultronDoctorChecks } from './doctor.js';
import { ULTRON_LOCALES_DIR, ULTRON_MIGRATIONS_DIR } from './paths.js';
import { ultronServices } from './services.js';
import { JOBS, V } from './world-events.js';

export * from './config.js';
export * from './content.js';
export * from './db/events-repo.js';
export * from './db/repo.js';
export * from './db/tables.js';
export * from './domain/scaling.js';
export * from './domain/when.js';
export { EncounterService, playerCombatantId } from './encounters.js';
export { ENEMY_IMPORT_MAX_BYTES, EnemyImports, enemyImportIds } from './enemy-imports.js';
export { AI_PROVIDER, type AiEnv, type FlavorKind, FlavorText, filterFlavor } from './flavor.js';
export { ULTRON_CONTENT_DIR, ULTRON_LOCALES_DIR, ULTRON_MIGRATIONS_DIR } from './paths.js';
export * from './services.js';
export { JOBS, strikeId, WorldEventService } from './world-events.js';

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
  components: (ctx) => [
    {
      action: 'enemy-import',
      version: V,
      handle: (i, r, args) => ultronServices(ctx).imports.decide(i, r, args),
    },
    {
      action: 'strike',
      version: V,
      handle: (i, r, [id]) => ultronServices(ctx).world.strike(i, r, id ?? ''),
    },
  ],
  register: async (ctx) => {
    const s = ultronServices(ctx);
    await s.encounters.loadContent();
    ctx.bus.on('mission.started', 'ultron.spawner', (e) => s.encounters.onMissionStarted(e));
    ctx.bus.on('combat.resolved', 'ultron.encounter-result', (e) => s.encounters.onCombatResolved(e));
    ctx.bus.on('combat.resolved', 'ultron.raid-result', (e) => s.world.onStrikeResolved(e));
    const w = s.world;
    ctx.scheduler.define<{ id: string }>(JOBS.announce, (p) => w.announce(p.id));
    ctx.scheduler.define<{ id: string }>(JOBS.start, (p) => w.start(p.id));
    ctx.scheduler.define<{ id: string }>(JOBS.end, (p) => w.end(p.id));
    ctx.scheduler.define<{ id: string }>(JOBS.refresh, (p) => w.refresh(p.id));
    // Hourly safety net; the next invasion is also planned on boot and when one ends.
    ctx.scheduler.every(JOBS.plan, '7 * * * *', () => w.planRecurring());
    ctx.help.add({
      bot: 'ultron',
      command: '/ameaca',
      descriptionKey: 'ultron.help.ameaca',
      adminOnly: false,
    });
    ctx.help.add({
      bot: 'ultron',
      command: '/ultron',
      descriptionKey: 'ultron.help.ultron',
      adminOnly: true,
    });
  },
  doctorChecks: (ctx) => [...ultronDoctorChecks(ctx), staffCommandsCheck(ctx, ['ultron'])],
  onReady: async (ctx) => {
    await ultronServices(ctx).world.planRecurring();
  },
};

export default ultron;
