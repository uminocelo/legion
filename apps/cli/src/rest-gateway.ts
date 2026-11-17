import type {
  CommandPermissionOverwrite,
  DiscordGateway,
  GuildChannel,
  GuildMember,
  GuildRole,
} from '@legion/core';
import { PermissionsBitField } from 'discord.js';
import type { DiscordRest } from './rest.js';

const names = (bits: string) => new PermissionsBitField(BigInt(bits)).toArray();

const kinds: Record<number, GuildChannel['kind']> = {
  0: 'text',
  2: 'voice',
  4: 'category',
  5: 'announcement',
  15: 'forum',
};

/** Read-only DiscordGateway over REST, so the CLI can run bot doctor checks and register commands. */
export function createRestGateway(
  rest: DiscordRest,
  guildId: string,
  botUserId: string,
  applicationId: string,
): DiscordGateway {
  const unsupported = async (): Promise<never> => {
    throw new Error('not available from the CLI');
  };
  return {
    botUserId,
    fetchRoles: async (): Promise<GuildRole[]> =>
      (await rest.guildRoles(guildId)).map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        position: r.position,
        managed: r.managed,
        permissions: names(r.permissions),
      })),
    fetchChannels: async (): Promise<GuildChannel[]> =>
      (await rest.guildChannels(guildId)).map((c) => ({
        id: c.id,
        name: c.name,
        kind: kinds[c.type] ?? 'other',
        parentId: c.parent_id ?? null,
        overwrites: (c.permission_overwrites ?? []).map((o) => ({
          id: o.id,
          type: o.type === 0 ? 'role' : 'member',
          allow: names(o.allow),
          deny: names(o.deny),
        })),
      })),
    fetchMember: async (userId: string): Promise<GuildMember | null> => {
      const m = await rest.guildMember(guildId, userId);
      if (!m) return null;
      return {
        userId,
        roleIds: m.roles,
        isBot: Boolean(m.user?.bot),
        joinedAt: m.joined_at ?? null,
        accountCreatedAt: new Date(0).toISOString(),
        displayName: userId,
      };
    },
    registerCommands: (commands) => rest.putGuildCommands(applicationId, guildId, commands),
    fetchCommandPermissions: async () => {
      if (!rest.guildCommands || !rest.guildCommandPermissions) return {};
      const byId = new Map((await rest.guildCommands(applicationId, guildId)).map((c) => [c.id, c.name]));
      const out: Record<string, CommandPermissionOverwrite[]> = {};
      for (const entry of await rest.guildCommandPermissions(applicationId, guildId)) {
        const key = entry.id === applicationId ? '*' : byId.get(entry.id);
        if (!key) continue;
        out[key] = entry.permissions.map((p) => ({
          id: p.id,
          type: p.type === 1 ? 'role' : p.type === 2 ? 'user' : 'channel',
          allow: p.permission,
        }));
      }
      return out;
    },
    fetchAttachment: unsupported,
    sendMessage: unsupported,
    editMessage: unsupported,
    sendDm: unsupported,
    createThread: unsupported,
    pinMessage: unsupported,
    reply: unsupported,
    deferReply: unsupported,
    deferUpdate: unsupported,
    editReply: unsupported,
    followUp: unsupported,
    updateMessage: unsupported,
    showModal: unsupported,
    respondAutocomplete: unsupported,
    createRole: unsupported,
    editRole: unsupported,
    addMemberRole: unsupported,
    removeMemberRole: unsupported,
    setChannelPermissionOverwrite: unsupported,
    timeoutMember: unsupported,
  };
}
