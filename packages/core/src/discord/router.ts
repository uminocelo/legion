import type { Logger } from 'pino';
import type { ComponentDefinition, SlashCommandDefinition } from '../bot.js';
import type { BotId } from '../config/schema.js';
import type { I18n } from '../i18n/i18n.js';
import type { RateLimiter } from '../ratelimit/rate-limiter.js';
import { parseCustomId } from './custom-id.js';
import type { DiscordGateway } from './gateway.js';
import { Responder } from './responder.js';
import type { IncomingInteraction } from './types.js';

export interface RouterLimits {
  commandsPerMinute: number;
  componentsPer10Seconds: number;
}

export interface InteractionRouterOptions {
  gateway: DiscordGateway;
  i18n: I18n;
  log: Logger;
  rateLimiter: () => RateLimiter;
  limits?: RouterLimits;
  /** Called after a slash command handler succeeds (core emits `command.executed`). */
  onCommandExecuted?: (i: IncomingInteraction, bot: BotId) => Promise<void>;
  /** Requests that skip rate limiting (e.g. staff commands, decided by Sentinel later). */
  bypassRateLimit?: (i: IncomingInteraction) => boolean;
  /** Several Discord apps: the app key of each bot (default: every bot on `main`). */
  appOf?: (bot: BotId) => string;
  /** Several Discord apps: the gateway that answers interactions received by an app. */
  gatewayFor?: (appKey: string) => DiscordGateway;
}

export const MAIN_APP = 'main';

/** Routes interactions to bots, inside an error boundary (main prompt §5.3–§5.4). */
export class InteractionRouter {
  private readonly commands = new Map<string, { bot: BotId; def: SlashCommandDefinition }>();
  private readonly components = new Map<string, ComponentDefinition>();
  private readonly componentBots = new Set<BotId>();

  constructor(private readonly o: InteractionRouterOptions) {}

  addCommand(bot: BotId, def: SlashCommandDefinition): void {
    const prev = this.commands.get(def.name);
    if (prev) throw new Error(`Command "/${def.name}" is defined by both ${prev.bot} and ${bot}`);
    if (def.json.name !== def.name) throw new Error(`Command "${def.name}" JSON name mismatch`);
    this.commands.set(def.name, { bot, def });
  }

  addComponent(bot: BotId, def: ComponentDefinition): void {
    const key = `${bot}:v${def.version}:${def.action}`;
    if (this.components.has(key)) throw new Error(`Component ${key} registered twice`);
    this.components.set(key, def);
    this.componentBots.add(bot);
  }

  /** Command JSON for one app (all commands when `appKey` is omitted). */
  commandJson(appKey?: string): Record<string, unknown>[] {
    return [...this.commands.values()]
      .filter((c) => appKey === undefined || this.appOf(c.bot) === appKey)
      .map((c) => c.def.json)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  ownerOf(commandName: string): BotId | undefined {
    return this.commands.get(commandName)?.bot;
  }

  private appOf(bot: BotId): string {
    return this.o.appOf?.(bot) ?? MAIN_APP;
  }

  /** Handles an interaction received by app `appKey` and answers through that app. */
  async handle(i: IncomingInteraction, appKey: string = MAIN_APP): Promise<void> {
    const r = new Responder(this.o.gatewayFor?.(appKey) ?? this.o.gateway, i.id);
    // A command or button of a bot that lives on another app (e.g. stale after moving a bot) is treated as expired.
    const elsewhere = (b: BotId) => this.appOf(b) !== appKey;
    const log = this.o.log.child({ interactionId: i.id, userId: i.userId });
    let bot: BotId | undefined;
    try {
      if (i.kind === 'autocomplete') {
        const found = i.commandName ? this.commands.get(i.commandName) : undefined;
        const entry = found && !elsewhere(found.bot) ? found : undefined;
        bot = entry?.bot;
        await (entry?.def.autocomplete?.(i, r) ?? r.autocomplete([]));
        return;
      }
      if (i.kind === 'command' || i.kind === 'context_menu') {
        const entry = i.commandName ? this.commands.get(i.commandName) : undefined;
        if (!entry || elsewhere(entry.bot)) return await this.expired(i, r);
        bot = entry.bot;
        if (!(await this.allowed(i, r, `cmd:${i.userId}`, this.limits.commandsPerMinute, 60_000))) return;
        await entry.def.execute(i, r);
        if (i.kind === 'command')
          await this.o
            .onCommandExecuted?.(i, entry.bot)
            .catch((err) => log.error({ err }, 'command.executed failed'));
        return;
      }
      const parsed = i.customId ? parseCustomId(i.customId) : null;
      const def = parsed && this.components.get(`${parsed.bot}:v${parsed.version}:${parsed.action}`);
      if (!parsed || !def || elsewhere(parsed.bot)) return await this.expired(i, r);
      bot = parsed.bot;
      if (!(await this.allowed(i, r, `cmp:${i.userId}`, this.limits.componentsPer10Seconds, 10_000))) return;
      await def.handle(i, r, parsed.args);
    } catch (err) {
      log.error({ err, bot }, 'interaction handler failed');
      if (i.kind === 'autocomplete') return;
      try {
        const locale = await this.o.i18n.localeFor(i.userId);
        await r.send({
          persona: bot ?? 'cerebro',
          content: this.o.i18n.t('core.errors.generic', {}, locale),
          ephemeral: true,
        });
      } catch (replyErr) {
        log.warn({ err: replyErr }, 'could not send the error reply');
      }
    }
  }

  private get limits(): RouterLimits {
    return this.o.limits ?? { commandsPerMinute: 20, componentsPer10Seconds: 15 };
  }

  private async allowed(i: IncomingInteraction, r: Responder, key: string, limit: number, windowMs: number) {
    if (this.o.bypassRateLimit?.(i)) return true;
    const res = await this.o.rateLimiter().consume(key, limit, windowMs);
    if (res.allowed) return true;
    const locale = await this.o.i18n.localeFor(i.userId);
    const seconds = Math.max(1, Math.ceil(res.retryAfterMs / 1000));
    await r.reply({
      persona: 'sentinel',
      content: this.o.i18n.t('core.errors.rate_limited', { seconds }, locale),
      ephemeral: true,
    });
    return false;
  }

  private async expired(i: IncomingInteraction, r: Responder) {
    const locale = await this.o.i18n.localeFor(i.userId);
    const bot = (i.customId && parseCustomId(i.customId)?.bot) || 'cerebro';
    await r.reply({
      persona: bot,
      content: this.o.i18n.t('core.errors.expired_component', {}, locale),
      ephemeral: true,
    });
  }
}
