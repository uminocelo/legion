import type { AnyLegionBot, CoreRuntime, DiscordJsGateway, Logger } from '@legion/core';
import {
  Client,
  type GuildMember as DjsMember,
  Events,
  GatewayIntentBits,
  type PartialGuildMember,
} from 'discord.js';

/**
 * Union of the enabled bots' intents. `GuildInvites` is added only when `squads.enabled`,
 * because invite create/delete events are how a squad link is guessed.
 */
export function intentsFor(bots: AnyLegionBot[], squadsEnabled = false): GatewayIntentBits[] {
  const bits = [GatewayIntentBits.Guilds, ...bots.flatMap((b) => b.intents)];
  if (squadsEnabled) bits.push(GatewayIntentBits.GuildInvites);
  return [...new Set(bits)];
}

export function createClient(bots: AnyLegionBot[], squadsEnabled = false): Client {
  return new Client({ intents: intentsFor(bots, squadsEnabled), allowedMentions: { parse: [] } });
}

const toMember = (m: DjsMember) => ({
  userId: m.id,
  roleIds: [...m.roles.cache.keys()].filter((id) => id !== m.guild.id),
  isBot: m.user.bot,
  joinedAt: m.joinedAt?.toISOString() ?? null,
  accountCreatedAt: m.user.createdAt.toISOString(),
  displayName: m.displayName,
});

/** Wires discord.js events into the runtime (interactions and member join/leave). */
export function wireClient(
  client: Client,
  gateway: DiscordJsGateway,
  runtime: () => CoreRuntime | null,
  guildId: string,
  log: Logger,
  /** App key of this client; only `main` (Cérebro's app) forwards member join/leave. */
  appKey = 'main',
) {
  client.on(Events.InteractionCreate, (interaction) => {
    const rt = runtime();
    if (!rt) return;
    gateway.track(interaction);
    const normalized = gateway.normalize(interaction);
    if (!normalized) return;
    rt.router.handle(normalized, appKey).catch((err) => log.error({ err }, 'router crashed'));
  });
  client.on(Events.Error, (err) => log.error({ err, discordApp: appKey }, 'discord client error'));
  client.on(Events.Warn, (msg) => log.warn({ msg, discordApp: appKey }, 'discord client warning'));
  if (appKey !== 'main') return;
  client.on(Events.GuildMemberAdd, (m) => {
    if (m.guild.id === guildId) runtime()?.guildEvents.memberAdded(toMember(m));
  });
  client.on(Events.GuildMemberRemove, (m: DjsMember | PartialGuildMember) => {
    if (m.guild.id === guildId) runtime()?.guildEvents.memberRemoved(m.id);
  });
}
