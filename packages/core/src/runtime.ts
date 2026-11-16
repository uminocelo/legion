import type { AnyLegionBot, BotContext, GuildEvents, LegionBot } from './bot.js';
import type { BotId, LegionConfig } from './config/schema.js';
import type { LegionDb } from './db/db.js';
import { KvStore } from './db/kv.js';
import { syncCommands } from './discord/command-sync.js';
import type { DiscordGateway } from './discord/gateway.js';
import { InteractionRouter, type RouterLimits } from './discord/router.js';
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
  readonly newId: () => string;
  readonly bots: { bot: AnyLegionBot; ctx: BotContext<unknown> }[] = [];

  constructor(private readonly o: CoreRuntimeOptions) {
    const { config, db, clock, log } = o;
    this.newId = createIdGenerator(clock);
    this.i18n = new I18n(config.locale, log);
    this.i18n.addDir(CORE_LOCALES_DIR);
    this.gateway = withPersonas(o.gateway, this.i18n);
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
    const read = this.providers.readModels();
    this.router = new InteractionRouter({
      gateway: this.gateway,
      i18n: this.i18n,
      log: log.child({ component: 'router' }),
      rateLimiter: () => this.providers.get('rateLimiter') ?? new InMemoryRateLimiter(clock),
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
      gateway: this.gateway,
      roles: this.roles,
      help: this.help,
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

  /** After the Discord client is ready: commands, replay, recurring jobs, polling, onReady. */
  async ready(opts: { startPolling?: boolean } = {}): Promise<void> {
    const res = await syncCommands(this.gateway, this.kv, this.router.commandJson());
    this.o.log.info({ changed: res.changed }, 'slash commands checked');
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
