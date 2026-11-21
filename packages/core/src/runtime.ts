import type { AnyLegionBot, BotContext, GuildEvents, LegionBot } from './bot.js';
import type { BotId, LegionConfig } from './config/schema.js';
import { AuditLog } from './dashboard/audit.js';
import { membersPanel } from './dashboard/core-panels.js';
import { IdempotencyKeys } from './dashboard/idempotency.js';
import { type DashboardOAuth, DiscordOAuth } from './dashboard/oauth.js';
import { DashboardRegistry } from './dashboard/registry.js';
import { DashboardServer } from './dashboard/server.js';
import { DashboardSessionStore } from './dashboard/sessions.js';
import { GuildStaffChecker } from './dashboard/staff.js';
import type { LegionDb } from './db/db.js';
import { KvStore } from './db/kv.js';
import { syncCommands } from './discord/command-sync.js';
import type { DiscordGateway } from './discord/gateway.js';
import { missingGuildPermissions, permissionNames } from './discord/guild-permissions.js';
import { InteractionRouter, MAIN_APP, type RouterLimits } from './discord/router.js';
import type { GuildMember, IncomingInteraction } from './discord/types.js';
import { withPersonas } from './discord/with-personas.js';
import { InProcessEventBus } from './events/bus.js';
import type { RandomSource } from './game/random.js';
import { I18n } from './i18n/i18n.js';
import { createIdGenerator } from './ids/ids.js';
import type { Logger } from './log/logger.js';
import { CORE_LOCALES_DIR, CORE_MIGRATIONS_DIR } from './paths.js';
import { InMemoryRateLimiter } from './ratelimit/rate-limiter.js';
import { HelpRegistry, ProfileRegistry } from './registries/help.js';
import { ProviderRegistry } from './registries/read-models.js';
import { RoleService } from './roles/role-service.js';
import { DbScheduler } from './scheduler/scheduler.js';
import type { Clock } from './time/clock.js';

export const STAFF_ROLE_KEYS = ['staff_owner', 'staff_council'] as const;

/** Fan-out of guild member events with an error boundary per handler. */
export class GuildEventHub implements GuildEvents {
  private readonly adds: ((m: GuildMember) => Promise<void>)[] = [];
  private readonly removes: ((userId: string) => Promise<void>)[] = [];
  constructor(private readonly log: Logger) {}
  onMemberAdd(h: (m: GuildMember) => Promise<void>): void {
    this.adds.push(h);
  }
  onMemberRemove(h: (userId: string) => Promise<void>): void {
    this.removes.push(h);
  }
  async memberAdded(m: GuildMember): Promise<void> {
    await this.run(
      this.adds.map((h) => () => h(m)),
      { userId: m.userId, event: 'memberAdd' },
    );
  }
  async memberRemoved(userId: string): Promise<void> {
    await this.run(
      this.removes.map((h) => () => h(userId)),
      { userId, event: 'memberRemove' },
    );
  }
  private async run(fns: (() => Promise<void>)[], ctx: object) {
    for (const fn of fns) {
      try {
        await fn();
      } catch (err) {
        this.log.error({ err, ...ctx }, 'guild event handler failed');
      }
    }
  }
}

export interface CoreRuntimeOptions {
  config: LegionConfig;
  db: LegionDb;
  /** Raw gateway; the runtime wraps it with persona styling. */
  gateway: DiscordGateway;
  clock: Clock;
  random: RandomSource;
  log: Logger;
  guildId: string;
  /** Owner overrides folder (`./locales`), loaded last. */
  localesOverrideDir?: string;
  roleGuard?: 'throw' | 'skip';
  routerLimits?: RouterLimits;
  /**
   * Extra Discord apps for bots with their own token. `gateway` above is the `main` app (the one hosting
   * Cérebro): it manages roles and receives member events. Bots not listed here use `main`.
   */
  apps?: { key: string; gateway: DiscordGateway; bots: BotId[] }[];
}

/** Shared services plus the bot loading/boot steps used by the runner and by tests. */
export class CoreRuntime {
  readonly i18n: I18n;
  readonly kv: KvStore;
  readonly scheduler: DbScheduler;
  readonly bus: InProcessEventBus;
  readonly providers = new ProviderRegistry();
  readonly help = new HelpRegistry();
  readonly profile = new ProfileRegistry();
  readonly roles: RoleService;
  readonly router: InteractionRouter;
  readonly guildEvents: GuildEventHub;
  readonly gateway: DiscordGateway;
  /** Persona-wrapped gateway per app key (`main` included). */
  readonly gateways = new Map<string, DiscordGateway>();
  private readonly botApps = new Map<BotId, string>();
  readonly newId: () => string;
  readonly bots: { bot: AnyLegionBot; ctx: BotContext<unknown> }[] = [];
  readonly dashboardSessions: DashboardSessionStore;
  readonly dashboard = new DashboardRegistry();
  readonly audit: AuditLog;
  private readonly idempotency: IdempotencyKeys;

  constructor(private readonly o: CoreRuntimeOptions) {
    const { config, db, clock, log } = o;
    this.newId = createIdGenerator(clock);
    this.i18n = new I18n(config.locale, log);
    this.i18n.addDir(CORE_LOCALES_DIR);
    this.gateway = withPersonas(o.gateway, this.i18n);
    this.gateways.set(MAIN_APP, this.gateway);
    for (const app of o.apps ?? []) {
      if (app.key === MAIN_APP) throw new Error('extra apps cannot use the key "main"');
      this.gateways.set(app.key, withPersonas(app.gateway, this.i18n));
      for (const b of app.bots) this.botApps.set(b, app.key);
    }
    this.kv = new KvStore(db, () => clock.now());
    this.scheduler = new DbScheduler({
      db,
      clock,
      newId: this.newId,
      log: log.child({ component: 'scheduler' }),
      timezone: config.timezone,
      pollIntervalMs: config.scheduler.pollIntervalMs,
    });
    this.bus = new InProcessEventBus({
      db,
      scheduler: this.scheduler,
      clock,
      newId: this.newId,
      guildId: o.guildId,
      log: log.child({ component: 'bus' }),
      replayLookbackDays: config.events.replayLookbackDays,
    });
    this.providers.provide('rateLimiter', new InMemoryRateLimiter(clock));
    this.roles = new RoleService(
      this.gateway,
      config.roles,
      log.child({ component: 'roles' }),
      o.roleGuard ?? 'skip',
    );
    this.guildEvents = new GuildEventHub(log.child({ component: 'guild-events' }));
    this.dashboard.panel('core', membersPanel(this.providers.readModels(), config, this.i18n));
    this.audit = new AuditLog(db, o.guildId, () => clock.now(), this.newId);
    this.idempotency = new IdempotencyKeys(db, () => clock.now());
    this.dashboardSessions = new DashboardSessionStore(db, clock, config.dashboard.sessionHours);
    if (config.dashboard.enabled)
      this.scheduler.every('core.dashboard-sessions-purge', '23 4 * * *', async () => {
        const purged = await this.dashboardSessions.purgeExpired();
        const keys = await this.idempotency.purge();
        const audit = await this.audit.purgeOlderThan(config.dashboard.auditDays);
        if (purged || keys || audit) log.info({ purged, keys, audit }, 'dashboard housekeeping');
      });
    const read = this.providers.readModels();
    this.router = new InteractionRouter({
      gateway: this.gateway,
      i18n: this.i18n,
      log: log.child({ component: 'router' }),
      rateLimiter: () => this.providers.get('rateLimiter') ?? new InMemoryRateLimiter(clock),
      appOf: (bot) => this.appOf(bot),
      gatewayFor: (key) => this.gateways.get(key) ?? this.gateway,
      ...(o.routerLimits ? { limits: o.routerLimits } : {}),
      onCommandExecuted: async (i, bot) => {
        const member = await read.members.getByDiscordId(i.userId);
        await this.bus.emit(this.o.db.orm, 'command.executed', {
          discordUserId: i.userId,
          memberId: member?.id ?? null,
          bot,
          command: i.commandName ?? '',
          subcommand: i.subcommand ?? null,
        });
      },
    });
  }

  /** The app key a bot talks through (`main` unless it has its own app). */
  appOf(bot: BotId): string {
    return this.botApps.get(bot) ?? MAIN_APP;
  }

  get db(): LegionDb {
    return this.o.db;
  }

  async close(): Promise<void> {
    await this.o.db.close();
  }

  async migrateCore(): Promise<void> {
    await this.o.db.migrate('core', CORE_MIGRATIONS_DIR);
  }

  async isStaff(i: Pick<IncomingInteraction, 'isGuildOwner' | 'memberRoleIds'>): Promise<boolean> {
    if (i.isGuildOwner) return true;
    const ids = await this.roles.idsFor(STAFF_ROLE_KEYS);
    return [...ids.values()].some((id) => i.memberRoleIds.includes(id));
  }

  /**
   * The staff dashboard server (not started). `clientId`/`clientSecret` are Cérebro's app OAuth2
   * credentials; tests pass a fake `oauth`.
   */
  dashboardServer(o: {
    clientId: string;
    clientSecret: string;
    oauth?: DashboardOAuth;
    host?: string;
    port?: number;
  }): DashboardServer {
    const { config, clock, log } = this.o;
    return new DashboardServer({
      config: config.dashboard,
      oauth: o.oauth ?? new DiscordOAuth({ clientId: o.clientId, clientSecret: o.clientSecret }),
      sessions: this.dashboardSessions,
      staff: new GuildStaffChecker({
        gateway: this.gateway,
        guildId: this.o.guildId,
        clock,
        isStaff: (i) => this.isStaff(i),
      }),
      i18n: this.i18n,
      registry: this.dashboard,
      db: this.o.db,
      audit: this.audit,
      idempotency: this.idempotency,
      timezone: config.timezone,
      clock,
      log: log.child({ component: 'dashboard' }),
      ...(o.host ? { host: o.host } : {}),
      ...(o.port !== undefined ? { port: o.port } : {}),
    });
  }

  contextFor<C>(bot: LegionBot<C>): BotContext<C> {
    const { config, db, clock, random } = this.o;
    const providers = this.providers;
    return {
      id: bot.id,
      config,
      botConfig: config[bot.id] as C,
      db,
      kv: this.kv,
      bus: this.bus.forSource(bot.id),
      scheduler: this.scheduler,
      i18n: this.i18n,
      log: this.o.log.child({ bot: bot.id }),
      gateway: this.gateways.get(this.appOf(bot.id)) ?? this.gateway,
      roles: this.roles,
      help: this.help,
      dashboard: this.dashboard.forBot(bot.id),
      profile: this.profile,
      get rateLimiter() {
        return providers.get('rateLimiter') ?? new InMemoryRateLimiter(clock);
      },
      clock,
      random,
      read: providers.readModels(),
      guildEvents: this.guildEvents,
      guildId: this.o.guildId,
      newId: this.newId,
      isStaff: (i) => this.isStaff(i),
      provide: (key, impl) => {
        providers.provide(key, impl, bot.id);
        if (key === 'localeResolver') this.i18n.setResolver(impl as never);
      },
    };
  }

  /** Migrations, locales, commands, components and `register()` for every enabled bot. */
  async loadBots(bots: AnyLegionBot[]): Promise<void> {
    for (const bot of bots) {
      if (bot.migrationsDir) await this.o.db.migrate(bot.id, bot.migrationsDir);
      if (bot.localesDir) this.i18n.addDir(bot.localesDir);
    }
    if (this.o.localesOverrideDir) this.i18n.addDir(this.o.localesOverrideDir);
    for (const bot of bots) {
      const ctx = this.contextFor(bot);
      for (const cmd of bot.commands(ctx)) this.router.addCommand(bot.id, cmd);
      for (const cmp of bot.components?.(ctx) ?? []) this.router.addComponent(bot.id, cmp);
      await bot.register(ctx);
      this.bots.push({ bot, ctx });
    }
  }

  enabledBotIds(): BotId[] {
    return this.bots.map((b) => b.bot.id);
  }

  /** Server-wide permissions each app's bots need (from their `permissions`). */
  appPermissions(key: string): string[] {
    return permissionNames(
      this.bots.filter((b) => this.appOf(b.bot.id) === key).flatMap((b) => b.bot.permissions),
    );
  }

  /** Warns when an app's bot role lacks permissions its bots need (e.g. a bot gained one in an update). */
  private async checkAppPermissions(key: string, gateway: DiscordGateway): Promise<void> {
    try {
      const [me, roles] = await Promise.all([gateway.fetchMember(gateway.botUserId), gateway.fetchRoles()]);
      if (!me) return;
      const missing = missingGuildPermissions(this.o.guildId, me, roles, this.appPermissions(key));
      if (missing?.length)
        this.o.log.warn(
          { discordApp: key, missing },
          'the bot role lacks permissions its bots need; open the invite link again (legion invite-url) or edit the role',
        );
    } catch (err) {
      this.o.log.warn({ err, discordApp: key }, 'could not check the bot permissions');
    }
  }

  /** After the Discord client is ready: commands, replay, recurring jobs, polling, onReady. */
  async ready(opts: { startPolling?: boolean } = {}): Promise<void> {
    for (const [key, gateway] of this.gateways) {
      const res = await syncCommands(gateway, this.kv, this.router.commandJson(key), false, key);
      this.o.log.info({ discordApp: key, changed: res.changed }, 'slash commands checked');
      await this.checkAppPermissions(key, gateway);
    }
    const replayed = await this.bus.replayPending();
    if (replayed) this.o.log.info({ replayed }, 'replayed pending events');
    await this.scheduler.ensureRecurring();
    if (opts.startPolling ?? true) this.scheduler.start();
    for (const { bot, ctx } of this.bots) {
      try {
        await bot.onReady?.(ctx);
      } catch (err) {
        this.o.log.error({ err, bot: bot.id }, 'onReady failed');
      }
    }
  }

  async stop(timeoutMs = 10_000): Promise<void> {
    const done = (async () => {
      await this.scheduler.stop();
      await this.bus.drain();
      for (const { bot } of this.bots) await bot.shutdown?.();
    })();
    await Promise.race([done, new Promise((r) => setTimeout(r, timeoutMs).unref())]);
  }
}
