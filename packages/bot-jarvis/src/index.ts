import type { LegionBot } from '@legion/core';
import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { type JarvisConfig, jarvisConfigSchema } from './config.js';
import { progressReadModel, registerConsumers } from './consumers.js';
import { JARVIS_LOCALES_DIR, JARVIS_MIGRATIONS_DIR } from './paths.js';
import { jarvisServices } from './services.js';

export * from './config.js';
export * from './consumers.js';
export * from './db/repo.js';
export * from './db/tables.js';
export * from './domain/xp.js';
export * from './services.js';
export * from './xp-service.js';

/** J.A.R.V.I.S.: trivia, XP, levels, ranks, leaderboard and streaks (v1). */
export const jarvis: LegionBot<JarvisConfig> = {
  id: 'jarvis',
  version: '0.2.0',
  configSchema: jarvisConfigSchema,
  intents: [GatewayIntentBits.Guilds],
  permissions: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.UseApplicationCommands,
  ],
  localesDir: JARVIS_LOCALES_DIR,
  migrationsDir: JARVIS_MIGRATIONS_DIR,
  commands: () => [],
  register: (ctx) => {
    const s = jarvisServices(ctx);
    ctx.provide('progress', progressReadModel(s));
    registerConsumers(ctx, s);
  },
};

export default jarvis;
