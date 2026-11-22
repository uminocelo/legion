import type { ComponentDefinition, LegionBot } from '@legion/core';
import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { cerebroCommands } from './commands.js';
import { type CerebroConfig, cerebroConfigSchema } from './config.js';
import { cerebroDoctorChecks } from './doctor.js';
import { FACTION_JOIN } from './faction-join.js';
import { CerebroFlow, RECONCILE_JOB } from './flow.js';
import { CEREBRO_LOCALES_DIR, CEREBRO_MIGRATIONS_DIR } from './paths.js';
import type { PickMode } from './power-flow.js';
import { membersReadModel, mutantsReadModel } from './read-models.js';
import { CerebroSetup } from './setup.js';
import { squadActions, squadComponents, squadPanels } from './squad-commands.js';
import { V } from './ui.js';

export * from './config.js';
export * from './db/repo.js';
export * from './db/tables.js';
export * from './domain/channels.js';
export * from './domain/codename.js';
export * from './domain/onboarding.js';
export { CerebroFlow, RECONCILE_JOB } from './flow.js';
export { CEREBRO_CONTENT_DIR } from './paths.js';
export { type PickMode, PowerFlow, powerIds } from './power-flow.js';
export * from './powers.js';
export { CerebroSetup, LAST_ROLE_SYNC_KEY, PERSISTENT_WELCOME_KEY } from './setup.js';
export { ids as cerebroIds } from './ui.js';

const pickMode = (m: string | undefined): PickMode => (m === 'e' || m === 'o' ? m : 'r');
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

/** Cérebro: onboarding, origins, factions, hero creation and the server role set. */
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
      { action: 'faction', version: V, handle: (i, r) => flow.legacyButton(i, r) },
      { action: 'origin', version: V, handle: (i, r) => flow.chooseOrigin(i, r) },
      { action: 'oback', version: V, handle: (i, r) => flow.backToOrigin(i, r) },
      { action: 'rorigin', version: V, handle: (i, r) => flow.originChange.choose(i, r) },
      { action: 'rcancel', version: V, handle: (i, r) => flow.originChange.cancel(i, r) },
      { action: 'archetype', version: V, handle: (i, r) => flow.chooseArchetype(i, r) },
      { action: 'reopen', version: V, handle: (i, r) => flow.reopen(i, r) },
      { action: 'mutant', version: V, handle: (i, r) => flow.submitMutant(i, r) },
      { action: 'optin', version: V, handle: (i, r, [key]) => flow.toggleOptIn(i, r, key ?? '') },
      { action: 'share', version: V, handle: (i, r, [memberId]) => flow.share(i, r, memberId ?? '') },
      { action: 'pmain', version: V, handle: (i, r, [mode]) => flow.powers.chooseMain(i, r, pickMode(mode)) },
      {
        action: 'psec',
        version: V,
        handle: (i, r, [mode, g]) => flow.powers.chooseSecondary(i, r, pickMode(mode), Number(g ?? 0)),
      },
      { action: 'pnext', version: V, handle: (i, r, [mode]) => flow.powers.next(i, r, pickMode(mode)) },
      { action: 'pback', version: V, handle: (i, r, [mode]) => flow.powers.back(i, r, pickMode(mode)) },
      ...squadComponents(ctx, flow),
    ];
  },

  register: (ctx) => {
    const { flow } = services(ctx);
    flow.powers.load();
    ctx.provide('members', membersReadModel(flow.repo));
    ctx.provide('mutants', mutantsReadModel(flow.repo));
    ctx.guildEvents.onMemberAdd((m) => flow.memberJoined(m));
    ctx.guildEvents.onMemberRemove((userId) => flow.memberLeft(userId));
    ctx.guildEvents.onInviteCreate(async (invite) => {
      flow.invites.remember(invite.code, invite.uses);
    });
    ctx.guildEvents.onInviteDelete(async (code) => {
      flow.invites.forget(code);
    });
    ctx.bus.on('faction.join_requested', FACTION_JOIN, (e) => flow.factionJoin.onRequest(e));
    ctx.bus.on('player.faction_changed', 'cerebro.squad-team', async (e) => {
      if (e.payload.reason === 'squad' || e.payload.reason === 'onboarding') return;
      await flow.squads.onTeamSwitched(e.payload.discordUserId);
    });
    ctx.bus.on('rank.changed', 'cerebro.rank-roles', (e) =>
      flow.onRankChanged(e.payload.memberId, e.payload.to),
    );
    ctx.scheduler.define<{ memberId: string }>(RECONCILE_JOB, (p) => flow.reconcileJob(p));
    ctx.help.add({ bot: 'cerebro', command: '/perfil', descriptionKey: 'cerebro.help.perfil' });
    ctx.help.add({ bot: 'cerebro', command: '/heroi poderes', descriptionKey: 'cerebro.help.heroi_poderes' });
    ctx.help.add({ bot: 'cerebro', command: '/heroi origem', descriptionKey: 'cerebro.help.heroi_origem' });
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
      command: '/cerebro equipe mover',
      descriptionKey: 'cerebro.help.equipe_mover',
      adminOnly: true,
    });
    ctx.help.add({
      bot: 'cerebro',
      command: '/cerebro status',
      descriptionKey: 'cerebro.help.status',
      adminOnly: true,
    });
    ctx.help.add({
      bot: 'cerebro',
      command: '/esquadrao criar',
      descriptionKey: 'cerebro.help.esquadrao_criar',
    });
    ctx.help.add({
      bot: 'cerebro',
      command: '/esquadrao entrar',
      descriptionKey: 'cerebro.help.esquadrao_entrar',
    });
    ctx.help.add({
      bot: 'cerebro',
      command: '/esquadrao sair',
      descriptionKey: 'cerebro.help.esquadrao_sair',
    });
    ctx.help.add({ bot: 'cerebro', command: '/esquadrao ver', descriptionKey: 'cerebro.help.esquadrao_ver' });
    ctx.help.add({
      bot: 'cerebro',
      command: '/cerebro esquadrao aprovar',
      descriptionKey: 'cerebro.help.esquadrao_aprovar',
      adminOnly: true,
    });
    ctx.help.add({
      bot: 'cerebro',
      command: '/cerebro esquadrao recusar',
      descriptionKey: 'cerebro.help.esquadrao_recusar',
      adminOnly: true,
    });
    ctx.help.add({
      bot: 'cerebro',
      command: '/cerebro esquadrao arquivar',
      descriptionKey: 'cerebro.help.esquadrao_arquivar',
      adminOnly: true,
    });
    for (const panel of squadPanels(ctx, flow)) ctx.dashboard.panel(panel);
    for (const action of squadActions(ctx, flow)) ctx.dashboard.action(action);
  },

  onReady: async (ctx) => {
    const { setup, flow } = services(ctx);
    await setup.syncRoles(true);
    const warn = setup.hierarchyLine(await setup.hierarchyProblems());
    if (warn) ctx.log.warn({ hint: 'Server Settings → Roles: drag the bot role up' }, warn);
    await flow.invites.baseline();
  },

  doctorChecks: (ctx) => cerebroDoctorChecks(ctx, services(ctx).setup),
};

export default cerebro;
