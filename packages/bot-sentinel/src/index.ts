import type { LegionBot } from '@legion/core';
import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { ROUND_JOB, V } from './combat.js';
import { sentinelCommands } from './commands.js';
import { type SentinelConfig, sentinelConfigSchema } from './config.js';
import { sentinelDoctorChecks } from './doctor.js';
import { SENTINEL_LOCALES_DIR, SENTINEL_MIGRATIONS_DIR } from './paths.js';
import { sentinelServices } from './services.js';

export { CombatService, combatIds, hpBar, ROUND_JOB } from './combat.js';
export * from './config.js';
export * from './db/repo.js';
export * from './db/safety-repo.js';
export * from './db/tables.js';
export * from './domain/combat/index.js';
export { MOTIVOS, ModerationService, modIds } from './moderation.js';
export { SENTINEL_LOCALES_DIR, SENTINEL_MIGRATIONS_DIR } from './paths.js';
export { SafetyService } from './safety.js';
export * from './services.js';

/** Sentinel: deterministic combat referee and guard (v3). */
export const sentinel: LegionBot<SentinelConfig> = {
  id: 'sentinel',
  version: '0.4.0',
  configSchema: sentinelConfigSchema,
  intents: [GatewayIntentBits.Guilds],
  permissions: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.UseApplicationCommands,
    PermissionFlagsBits.ModerateMembers,
  ],
  localesDir: SENTINEL_LOCALES_DIR,
  migrationsDir: SENTINEL_MIGRATIONS_DIR,
  commands: (ctx) => sentinelCommands(ctx, sentinelServices(ctx)),
  components: (ctx) => {
    const s = sentinelServices(ctx);
    return [
      {
        action: 'act',
        version: V,
        handle: (i, r, [id, round, action]) => s.combat.choose(i, r, id ?? '', Number(round), action ?? ''),
      },
      {
        action: 'mod',
        version: V,
        handle: (i, r, [id, action]) => s.moderation.staffAction(i, r, id ?? '', action ?? ''),
      },
      {
        action: 'report-msg',
        version: V,
        handle: (i, r, args) => s.moderation.reportMessageSubmit(i, r, args),
      },
      {
        action: 'log',
        version: V,
        handle: async (i, r, [id, page, nav]) => {
          const l = await ctx.i18n.localeFor(i.userId);
          const msg = await s.combat.logPage(id ?? '', Number(page), l);
          if (!msg)
            return r.reply({
              persona: 'sentinel',
              ephemeral: true,
              content: ctx.i18n.t('sentinel.errors.combat_not_found', {}, l),
            });
          // From the final embed: a new ephemeral message; the log's own arrows turn the page in place.
          return nav === 'n' ? r.update(msg) : r.reply(msg);
        },
      },
    ];
  },
  register: (ctx) => {
    const s = sentinelServices(ctx);
    ctx.bus.on('combat.requested', 'sentinel.combat-start', (e) => s.combat.onRequested(e));
    ctx.scheduler.define<{ combatId: string; round: number }>(ROUND_JOB, (p) =>
      s.combat.resolve(p.combatId, p.round),
    );
    ctx.provide('rateLimiter', s.safety);
    ctx.bus.on('report.flagged', 'sentinel.reports', (e) => s.moderation.onFlagged(e));
    ctx.bus.on('xp.awarded', 'sentinel.xp-watch', (e) => s.safety.onXp(e));
    ctx.bus.on('member.joined', 'sentinel.join-watch', (e) => s.safety.onJoin(e));
    ctx.scheduler.every('sentinel.prune', '30 4 * * *', () => s.safety.prune());
    for (const [command, key, adminOnly] of [
      ['/treino', 'treino', false],
      ['/combate', 'combate', false],
      ['/denunciar', 'denunciar', false],
      ['/sentinel', 'sentinel', true],
    ] as const)
      ctx.help.add({ bot: 'sentinel', command, descriptionKey: `sentinel.help.${key}`, adminOnly });
  },
  doctorChecks: (ctx) => sentinelDoctorChecks(ctx),
  onReady: async (ctx) => {
    const n = await sentinelServices(ctx).combat.recover();
    if (n) ctx.log.info({ combats: n }, 'combat round timeouts restored');
  },
};

export default sentinel;
