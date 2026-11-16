import type { ComponentDefinition, LegionBot } from '@legion/core';
import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { cerebroCommands } from './commands.js';
import { type CerebroConfig, cerebroConfigSchema } from './config.js';
import { cerebroDoctorChecks } from './doctor.js';
import { CerebroFlow, RECONCILE_JOB } from './flow.js';
import { CEREBRO_LOCALES_DIR, CEREBRO_MIGRATIONS_DIR } from './paths.js';
import { membersReadModel, mutantsReadModel } from './read-models.js';
import { CerebroSetup } from './setup.js';
import { V } from './ui.js';

export * from './config.js';
export * from './db/repo.js';
export * from './domain/channels.js';
export * from './domain/codename.js';
export * from './domain/onboarding.js';
export { CerebroFlow, RECONCILE_JOB } from './flow.js';
export { CerebroSetup, LAST_ROLE_SYNC_KEY, PERSISTENT_WELCOME_KEY } from './setup.js';
export { ids as cerebroIds } from './ui.js';

const state = new WeakMap<object, { flow: CerebroFlow; setup: CerebroSetup }>();
const services = (ctx: Parameters<LegionBot<CerebroConfig>['register']>[0]) => {
  let s = state.get(ctx);
  if (!s) {
    const flow = new CerebroFlow(ctx);
    s = { flow, setup: new CerebroSetup(flow) };
    state.set(ctx, s);
  }
  return s;
};

/** Cérebro: onboarding, factions, mutant creation and the server role set (v0). */
export const cerebro: LegionBot<CerebroConfig> = {
  id: 'cerebro',
  version: '0.1.0',
  configSchema: cerebroConfigSchema,
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  permissions: [
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.UseApplicationCommands,
  ],
  localesDir: CEREBRO_LOCALES_DIR,
  migrationsDir: CEREBRO_MIGRATIONS_DIR,

  commands: (ctx) => {
    const { flow, setup } = services(ctx);
    return cerebroCommands(ctx, flow, setup);
  },

  components: (ctx): ComponentDefinition[] => {
    const { flow } = services(ctx);
    return [
      { action: 'start', version: V, handle: (i, r) => flow.start(i, r) },
      { action: 'rules', version: V, handle: (i, r) => flow.acceptRules(i, r) },
      { action: 'faction', version: V, handle: (i, r) => flow.chooseFaction(i, r) },
      { action: 'archetype', version: V, handle: (i, r) => flow.chooseArchetype(i, r) },
      { action: 'reopen', version: V, handle: (i, r) => flow.reopen(i, r) },
      { action: 'mutant', version: V, handle: (i, r) => flow.submitMutant(i, r) },
      { action: 'optin', version: V, handle: (i, r, [key]) => flow.toggleOptIn(i, r, key ?? '') },
      { action: 'share', version: V, handle: (i, r, [memberId]) => flow.share(i, r, memberId ?? '') },
    ];
  },

  register: (ctx) => {
    const { flow } = services(ctx);
    ctx.provide('members', membersReadModel(flow.repo));
    ctx.provide('mutants', mutantsReadModel(flow.repo));
    ctx.guildEvents.onMemberAdd((m) => flow.memberJoined(m));
    ctx.guildEvents.onMemberRemove((userId) => flow.memberLeft(userId));
    ctx.bus.on('rank.changed', 'cerebro.rank-roles', (e) =>
      flow.onRankChanged(e.payload.memberId, e.payload.to),
    );
    ctx.scheduler.define<{ memberId: string }>(RECONCILE_JOB, (p) => flow.reconcileJob(p));
    ctx.help.add({ bot: 'cerebro', command: '/perfil', descriptionKey: 'cerebro.help.perfil' });
    ctx.help.add({
      bot: 'cerebro',
      command: '/cerebro preferencias',
      descriptionKey: 'cerebro.help.preferencias',
    });
    ctx.help.add({
      bot: 'cerebro',
      command: '/cerebro setup',
      descriptionKey: 'cerebro.help.setup',
      adminOnly: true,
    });
    ctx.help.add({
      bot: 'cerebro',
      command: '/cerebro status',
      descriptionKey: 'cerebro.help.status',
      adminOnly: true,
    });
  },

  onReady: async (ctx) => {
    const { setup } = services(ctx);
    await setup.syncRoles(true);
    const warn = setup.hierarchyLine(await setup.hierarchyProblems());
    if (warn) ctx.log.warn({ hint: 'Server Settings → Roles: drag the bot role up' }, warn);
  },

  doctorChecks: (ctx) => cerebroDoctorChecks(ctx, services(ctx).setup),
};

export default cerebro;
