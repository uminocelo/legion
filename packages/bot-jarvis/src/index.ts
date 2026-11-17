import type { LegionBot } from '@legion/core';
import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { jarvisCommands } from './commands.js';
import { type JarvisConfig, jarvisConfigSchema } from './config.js';
import { progressReadModel, registerConsumers } from './consumers.js';
import { displayedStreak, levelFor, progressBar } from './domain/xp.js';
import { JARVIS_LOCALES_DIR, JARVIS_MIGRATIONS_DIR } from './paths.js';
import { jarvisServices } from './services.js';
import { V } from './ui.js';

export * from './config.js';
export * from './consumers.js';
export * from './content.js';
export * from './db/repo.js';
export * from './db/tables.js';
export * from './domain/periods.js';
export * from './domain/selection.js';
export * from './domain/xp.js';
export { JarvisLeaderboard } from './leaderboard.js';
export * from './services.js';
export { contentDirs, JarvisTrivia } from './trivia.js';
export { ids as jarvisIds } from './ui.js';
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
  commands: (ctx) => {
    const s = jarvisServices(ctx);
    return jarvisCommands(ctx, s, s.trivia, s.board);
  },
  components: (ctx) => {
    const s = jarvisServices(ctx);
    return [
      {
        action: 'trivia',
        version: V,
        handle: (i, r, [attemptId, index]) => s.trivia.answer(i, r, attemptId ?? '', Number(index)),
      },
      { action: 'trivia-next', version: V, handle: (i, r) => s.trivia.ask(i, r, null) },
    ];
  },
  register: async (ctx) => {
    const s = jarvisServices(ctx);
    ctx.provide('progress', progressReadModel(s));
    registerConsumers(ctx, s);
    const res = await s.trivia.reload();
    ctx.log.info({ ...res, errors: res.errors.length }, 'trivia content loaded');
    ctx.profile.add('jarvis', async ({ memberId }, l) => {
      const p = await s.repo.progress(memberId);
      if (!p) return [];
      const t = (k: string, v: Record<string, string | number> = {}) => ctx.i18n.t(k, v, l);
      const lv = ctx.botConfig.levels;
      return [
        { name: t('jarvis.profile.level'), value: String(levelFor(p.xp, lv)), inline: true },
        { name: t('jarvis.profile.xp'), value: `${p.xp} ${progressBar(p.xp, lv)}`, inline: true },
        {
          name: t('jarvis.profile.streak'),
          value: t('jarvis.profile.streak_value', {
            current: displayedStreak(p, s.xp.today()),
            best: p.bestStreak,
          }),
          inline: true,
        },
      ];
    });
    ctx.help.add({ bot: 'jarvis', command: '/trivia', descriptionKey: 'jarvis.help.trivia' });
    ctx.help.add({ bot: 'jarvis', command: '/ranking', descriptionKey: 'jarvis.help.ranking' });
    ctx.help.add({ bot: 'jarvis', command: '/sequencia', descriptionKey: 'jarvis.help.sequencia' });
  },
};

export default jarvis;
export { JARVIS_CONTENT_DIR, JARVIS_LOCALES_DIR, JARVIS_MIGRATIONS_DIR } from './paths.js';
