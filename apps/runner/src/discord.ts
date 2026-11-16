import type { AnyLegionBot, CoreRuntime, DiscordJsGateway, Logger } from '@legion/core';
import {
  Client,
  type GuildMember as DjsMember,
  Events,
  GatewayIntentBits,
  type PartialGuildMember,
} from 'discord.js';

export function intentsFor(bots: AnyLegionBot[]): GatewayIntentBits[] {
  return [...new Set([GatewayIntentBits.Guilds, ...bots.flatMap((b) => b.intents)])];
}

export function createClient(bots: AnyLegionBot[]): Client {
  return new Client({ intents: intentsFor(bots), allowedMentions: { parse: [] } });
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
) {
  client.on(Events.InteractionCreate, (interaction) => {
    const rt = runtime();
    if (!rt) return;
    gateway.track(interaction);
    const normalized = gateway.normalize(interaction);
    if (!normalized) return;
    rt.router.handle(normalized).catch((err) => log.error({ err }, 'router crashed'));
  });
  client.on(Events.GuildMemberAdd, (m) => {
    if (m.guild.id === guildId) runtime()?.guildEvents.memberAdded(toMember(m));
  });
  client.on(Events.GuildMemberRemove, (m: DjsMember | PartialGuildMember) => {
    if (m.guild.id === guildId) runtime()?.guildEvents.memberRemoved(m.id);
  });
  client.on(Events.Error, (err) => log.error({ err }, 'discord client error'));
  client.on(Events.Warn, (msg) => log.warn({ msg }, 'discord client warning'));
}
