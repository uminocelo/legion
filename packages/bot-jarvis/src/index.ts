import { type LegionBot, staffCommandsCheck } from '@legion/core';
import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { jarvisCommands } from './commands.js';
import { type JarvisConfig, jarvisConfigSchema } from './config.js';
import { progressReadModel, registerConsumers } from './consumers.js';
import { jarvisActions, jarvisPanels } from './dashboard.js';
import { jarvisDoctorChecks } from './doctor.js';
import { displayedStreak, levelFor, progressBar } from './domain/xp.js';
import { MISSION_TIMEOUT_JOB } from './missions.js';
import { JARVIS_LOCALES_DIR, JARVIS_MIGRATIONS_DIR } from './paths.js';
import { SEASON_JOBS } from './season.js';
import { jarvisServices } from './services.js';
import { squadContentImportApi } from './squad-content-import.js';
import { V } from './ui.js';

export { campaignImportIds, JarvisCampaigns } from './campaigns.js';
export * from './config.js';
export * from './consumers.js';
export * from './content.js';
export * from './db/repo.js';
export * from './db/season-repo.js';
export * from './db/tables.js';
export { jarvisDoctorChecks } from './doctor.js';
export * from './domain/campaign.js';
export * from './domain/mission.js';
export * from './domain/periods.js';
export * from './domain/season-window.js';
export * from './domain/selection.js';
export * from './domain/xp.js';
export { inventoryIds, JarvisInventory } from './inventory-ui.js';
export { ItemImports, itemImportIds } from './item-imports.js';
export * from './items.js';
export { JarvisLeaderboard } from './leaderboard.js';
export * from './mission-content.js';
export { IMPORT_MAX_BYTES, MissionImports, missionImportIds, parseMissionYaml } from './mission-imports.js';
export { combatMissionId, JarvisMissions, MISSION_TIMEOUT_JOB, missionIds } from './missions.js';
export { SEASON_JOBS, SeasonService } from './season.js';
export * from './services.js';
export { JarvisShop, SHOP_PAGE, shopIds, shopStock } from './shop-ui.js';
export { StaffTrivia, staffTriviaIds, statusOf } from './staff-trivia.js';
export { contentDirs, JarvisTrivia } from './trivia.js';
export { TRIVIA_IMPORT_MAX, TriviaImports, triviaImportIds } from './trivia-imports.js';
export { ids as jarvisIds } from './ui.js';
export * from './wallet.js';
export { JarvisWalletUi, STAFF_CREDITS_MAX } from './wallet-ui.js';
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
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.SendMessagesInThreads,
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
      {
        action: 'mission',
        version: V,
        handle: (i, r, [runId, sceneId, choice]) =>
          s.missions.choose(i, r, runId ?? '', sceneId ?? '', Number(choice)),
      },
      { action: 'trivia-new', version: V, handle: (i, r, args) => s.staffTrivia.submitCreate(i, r, args) },
      { action: 'trivia-edit', version: V, handle: (i, r, args) => s.staffTrivia.submitEdit(i, r, args) },
      { action: 'trivia-review', version: V, handle: (i, r, args) => s.staffTrivia.review(i, r, args) },
      { action: 'mission-import', version: V, handle: (i, r, args) => s.imports.decide(i, r, args) },
      { action: 'campaign-import', version: V, handle: (i, r, args) => s.campaigns.decide(i, r, args) },
      { action: 'trivia-import', version: V, handle: (i, r, args) => s.triviaImports.decide(i, r, args) },
      { action: 'item-import', version: V, handle: (i, r, args) => s.itemImports.decide(i, r, args) },
      { action: 'inv', version: V, handle: (i, r, args) => s.inventoryUi.component(i, r, args) },
      { action: 'shop', version: V, handle: (i, r, args) => s.shop.component(i, r, args) },
      {
        action: 'lobby',
        version: V,
        handle: (i, r, [runId, action]) => s.missions.lobbyAction(i, r, runId ?? '', action ?? ''),
      },
    ];
  },
  register: async (ctx) => {
    const s = jarvisServices(ctx);
    ctx.provide('progress', progressReadModel(s));
    ctx.provide('gear', s.inventory.gearReadModel());
    ctx.provide('squadContentImport', squadContentImportApi(ctx, s));
    registerConsumers(ctx, s);
    for (const panel of jarvisPanels(ctx)) ctx.dashboard.panel(panel);
    for (const action of jarvisActions(ctx, s)) ctx.dashboard.action(action);
    const res = await s.trivia.reload();
    ctx.log.info({ ...res, errors: res.errors.length }, 'trivia content loaded');
    const ms = await s.missions.reload();
    ctx.log.info({ ...ms, errors: ms.errors.length }, 'mission content loaded');
    const items = await s.items.reload();
    if (items.errors.length) ctx.log.warn({ errors: items.errors }, 'item content has errors');
    ctx.log.info({ ...items, errors: items.errors.length }, 'item content loaded');
    ctx.scheduler.define<{ runId: string; version: number }>(MISSION_TIMEOUT_JOB, (p) =>
      s.missions.onTimeout(p),
    );
    ctx.scheduler.define<{ id: string }>(SEASON_JOBS.start, (p) => s.season.startJob(p.id));
    ctx.scheduler.define<{ id: string }>(SEASON_JOBS.end, (p) => s.season.end(p.id));
    ctx.scheduler.every(SEASON_JOBS.plan, '27 * * * *', () => s.season.planNext());
    ctx.bus.on('combat.resolved', 'jarvis.mission-combat', (e) => s.missions.onCombatResolved(e));
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
    ctx.help.add({ bot: 'jarvis', command: '/temporada', descriptionKey: 'jarvis.help.temporada' });
    ctx.help.add({ bot: 'jarvis', command: '/sequencia', descriptionKey: 'jarvis.help.sequencia' });
    ctx.help.add({ bot: 'jarvis', command: '/missao', descriptionKey: 'jarvis.help.missao' });
    ctx.help.add({ bot: 'jarvis', command: '/campanha', descriptionKey: 'jarvis.help.campanha' });
    ctx.help.add({ bot: 'jarvis', command: '/inventario', descriptionKey: 'jarvis.help.inventario' });
    ctx.help.add({ bot: 'jarvis', command: '/carteira', descriptionKey: 'jarvis.help.carteira' });
    ctx.help.add({ bot: 'jarvis', command: '/loja', descriptionKey: 'jarvis.help.loja' });
  },
  doctorChecks: (ctx) => [...jarvisDoctorChecks(ctx), staffCommandsCheck(ctx, ['jarvis'])],
  onReady: async (ctx) => {
    const s = jarvisServices(ctx);
    const n = await s.missions.recover();
    if (n) ctx.log.info({ runs: n }, 'open missions restored');
    await s.season.planNext();
  },
};

export default jarvis;
export { JARVIS_CONTENT_DIR, JARVIS_LOCALES_DIR, JARVIS_MIGRATIONS_DIR } from './paths.js';
