import type { GatewayIntentBits } from 'discord.js';
import type { z } from 'zod';
import type { BotId, LegionConfig } from './config/schema.js';
import type { LegionDb } from './db/db.js';
import type { KvStore } from './db/kv.js';
import type { DiscordGateway } from './discord/gateway.js';
import type { Responder } from './discord/responder.js';
import type { GuildMember, IncomingInteraction } from './discord/types.js';
import type { EventBus } from './events/bus.js';
import type { RandomSource } from './game/random.js';
import type { I18n } from './i18n/i18n.js';
import type { Logger } from './log/logger.js';
import type { RateLimiter } from './ratelimit/rate-limiter.js';
import type { HelpRegistry, ProfileRegistry } from './registries/help.js';
import type { Providers, ReadModels } from './registries/read-models.js';
import type { RoleService } from './roles/role-service.js';
import type { Scheduler } from './scheduler/scheduler.js';
import type { Clock } from './time/clock.js';

export type { BotId };

export interface SlashCommandDefinition {
  /** Top-level command name (pt-BR). Must be unique across bots. */
  name: string;
  /** Full Discord application-command JSON (name, description, localizations, options, type). */
  json: Record<string, unknown>;
  execute(i: IncomingInteraction, r: Responder): Promise<void>;
  autocomplete?(i: IncomingInteraction, r: Responder): Promise<void>;
}

/** Handles custom ids `<bot>:v<version>:<action>:...`. */
export interface ComponentDefinition {
  action: string;
  version: number;
  handle(i: IncomingInteraction, r: Responder, args: string[]): Promise<void>;
}

/** `info` (ℹ️) is a tip that needs no action; only `fail` makes `legion doctor` exit non-zero. */
export type DoctorStatus = 'ok' | 'info' | 'warn' | 'fail';
export interface DoctorResult {
  status: DoctorStatus;
  message: string;
  /** One-line fix shown next to ⚠️/❌. */
  fix?: string;
}
export interface DoctorCheck {
  id: string;
  title: string;
  run(): Promise<DoctorResult>;
}

/** Guild member events from the gateway connection (Cérebro needs joins and leaves). */
export interface GuildEvents {
  onMemberAdd(handler: (member: GuildMember) => Promise<void>): void;
  onMemberRemove(handler: (userId: string) => Promise<void>): void;
}

export interface BotContext<C = unknown> {
  id: BotId;
  config: LegionConfig;
  botConfig: C;
  db: LegionDb;
  kv: KvStore;
  bus: EventBus;
  scheduler: Scheduler;
  i18n: I18n;
  log: Logger;
  gateway: DiscordGateway;
  roles: RoleService;
  help: HelpRegistry;
  profile: ProfileRegistry;
  /** Resolved at call time, so Sentinel can replace it later. */
  readonly rateLimiter: RateLimiter;
  clock: Clock;
  random: RandomSource;
  read: ReadModels;
  guildEvents: GuildEvents;
  guildId: string;
  newId: () => string;
  /** True when the member is the guild owner or holds `staff_owner`/`staff_council`. */
  isStaff(i: Pick<IncomingInteraction, 'isGuildOwner' | 'memberRoleIds'>): Promise<boolean>;
  provide<K extends keyof Providers>(key: K, impl: Providers[K]): void;
}

export interface LegionBot<C = unknown> {
  id: BotId;
  version: string;
  /** Validates `config[id]`; every key must have a default. */
  configSchema: z.ZodType<C>;
  intents: GatewayIntentBits[];
  permissions: bigint[];
  /** Folder with this bot's pt-BR.json / en.json. */
  localesDir?: string;
  /** Folder with `sqlite/` and `pg/` migrations for this bot's tables. */
  migrationsDir?: string;
  commands: (ctx: BotContext<C>) => SlashCommandDefinition[];
  components?: (ctx: BotContext<C>) => ComponentDefinition[];
  register: (ctx: BotContext<C>) => void | Promise<void>;
  onReady?: (ctx: BotContext<C>) => Promise<void>;
  doctorChecks?: (ctx: BotContext<C>) => DoctorCheck[];
  /**
   * Channels this bot posts to beyond `config.channels` (e.g. a tips channel). `legion doctor` checks
   * that the app hosting the bot can view, send and embed there.
   */
  doctorChannels?: (botConfig: C) => { key: string; id: string | null }[];
  shutdown?: () => Promise<void>;
}

/** A bot with any config type (for lists of heterogeneous bots). */
// biome-ignore lint/suspicious/noExplicitAny: config type is erased in bot lists
export type AnyLegionBot = LegionBot<any>;
