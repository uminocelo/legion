import {
  ApplicationCommandOptionType,
  type Client,
  DiscordAPIError,
  type Guild,
  type Interaction,
  type InteractionReplyOptions,
  MessageFlags,
  PermissionFlagsBits,
  type RepliableInteraction,
} from 'discord.js';
import { type DiscordGateway, GatewayError, type SentMessage } from './gateway.js';
import type {
  ActionRow,
  ChannelKind,
  GuildChannel,
  GuildMember,
  GuildRole,
  IncomingInteraction,
  Modal,
  OutgoingMessage,
  PermissionOverwrite,
  RoleCreate,
} from './types.js';

const BUTTON_STYLE = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 } as const;
const INTERACTION_TTL_MS = 15 * 60_000;

const toApiRows = (rows: ActionRow[] | undefined) =>
  rows?.map((row) => ({
    type: 1,
    components: row.map((c) =>
      c.type === 'button'
        ? {
            type: 2,
            style: BUTTON_STYLE[c.style],
            label: c.label,
            ...(c.style === 'link' ? { url: c.url } : { custom_id: c.customId }),
            ...(c.emoji ? { emoji: { name: c.emoji } } : {}),
            disabled: c.disabled ?? false,
          }
        : {
            type: 3,
            custom_id: c.customId,
            placeholder: c.placeholder,
            min_values: c.minValues ?? 1,
            max_values: c.maxValues ?? 1,
            options: c.options.map((o) => ({ ...o, ...(o.emoji ? { emoji: { name: o.emoji } } : {}) })),
          },
    ),
  }));

/** Converts an OutgoingMessage into discord.js send/reply options (raw API JSON is accepted). */
export function toDiscordPayload(msg: OutgoingMessage) {
  return {
    content: msg.content ?? '',
    embeds: msg.embeds ?? [],
    components: toApiRows(msg.components) ?? [],
    allowedMentions: msg.allowedMentions ?? { parse: [] },
    ...(msg.ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
    // biome-ignore lint/suspicious/noExplicitAny: raw API JSON accepted by discord.js
  } as any;
}

const wrapError = (err: unknown): never => {
  if (err instanceof DiscordAPIError)
    throw new GatewayError(err.message, typeof err.code === 'number' ? err.code : null);
  throw err;
};

const channelKind = (type: number): ChannelKind =>
  (
    ({
      0: 'text',
      2: 'voice',
      4: 'category',
      5: 'announcement',
      15: 'forum',
      10: 'thread',
      11: 'thread',
      12: 'thread',
    }) as Record<number, ChannelKind>
  )[type] ?? 'other';

/** The discord.js implementation of DiscordGateway for one guild. */
export class DiscordJsGateway implements DiscordGateway {
  private readonly live = new Map<string, { i: Interaction; at: number }>();

  constructor(
    private readonly client: Client,
    private readonly guildId: string,
  ) {}

  get botUserId(): string {
    return this.client.user?.id ?? '';
  }

  private async guild(): Promise<Guild> {
    return this.client.guilds.cache.get(this.guildId) ?? this.client.guilds.fetch(this.guildId);
  }

  /** Remembers a live interaction so later gateway calls can respond to it. */
  track(i: Interaction): void {
    const now = Date.now();
    this.live.set(i.id, { i, at: now });
    for (const [id, v] of this.live) if (now - v.at > INTERACTION_TTL_MS) this.live.delete(id);
  }

  private interaction(id: string): RepliableInteraction {
    const entry = this.live.get(id);
    if (!entry?.i.isRepliable()) throw new GatewayError(`Unknown interaction ${id}`, 10062);
    return entry.i;
  }

  /** Normalizes a discord.js interaction for the router; returns null for unsupported kinds. */
  normalize(i: Interaction): IncomingInteraction | null {
    if (!i.inGuild() || i.guildId !== this.guildId) return null;
    const memberRoles = i.member && 'roles' in i.member ? i.member.roles : [];
    const roleIds = Array.isArray(memberRoles) ? memberRoles : [...memberRoles.cache.keys()];
    const base = {
      id: i.id,
      guildId: i.guildId,
      channelId: i.channelId ?? '',
      userId: i.user.id,
      memberRoleIds: roleIds,
      isGuildOwner: i.guild?.ownerId === i.user.id,
      locale: i.locale ?? null,
    };
    if (i.isChatInputCommand() || i.isAutocomplete()) {
      const options: Record<string, string | number | boolean | null> = {};
      let subcommand: string | null = null;
      const collect = (
        data: readonly { name: string; type: number; value?: unknown; options?: readonly unknown[] }[],
      ) => {
        for (const o of data) {
          if (
            o.type === ApplicationCommandOptionType.Subcommand ||
            o.type === ApplicationCommandOptionType.SubcommandGroup
          ) {
            subcommand = subcommand ? `${subcommand} ${o.name}` : o.name;
            collect((o.options ?? []) as typeof data);
          } else options[o.name] = (o.value as string | number | boolean | undefined) ?? null;
        }
      };
      collect(i.options.data);
      if (i.isAutocomplete()) {
        const f = i.options.getFocused(true);
        return {
          ...base,
          kind: 'autocomplete',
          commandName: i.commandName,
          subcommand,
          options,
          focused: { name: f.name, value: String(f.value) },
        };
      }
      return { ...base, kind: 'command', commandName: i.commandName, subcommand, options };
    }
    if (i.isMessageContextMenuCommand()) {
      return {
        ...base,
        kind: 'context_menu',
        commandName: i.commandName,
        target: {
          messageId: i.targetMessage.id,
          channelId: i.targetMessage.channelId,
          authorId: i.targetMessage.author.id,
        },
      };
    }
    if (i.isButton()) return { ...base, kind: 'component', customId: i.customId };
    if (i.isStringSelectMenu())
      return { ...base, kind: 'component', customId: i.customId, values: [...i.values] };
    if (i.isModalSubmit()) {
      const fields: Record<string, string> = {};
      for (const row of i.fields.fields.values())
        if ('value' in row) fields[row.customId] = String(row.value);
      return { ...base, kind: 'modal', customId: i.customId, fields };
    }
    return null;
  }

  async sendMessage(channelId: string, msg: OutgoingMessage): Promise<SentMessage> {
    try {
      const ch = await this.client.channels.fetch(channelId);
      if (!ch?.isSendable()) throw new GatewayError(`Channel ${channelId} is not sendable`, 50001);
      const sent = await ch.send(toDiscordPayload({ ...msg, ephemeral: false }));
      return { channelId, messageId: sent.id };
    } catch (err) {
      return wrapError(err);
    }
  }
  async editMessage(channelId: string, messageId: string, msg: OutgoingMessage): Promise<void> {
    try {
      const ch = await this.client.channels.fetch(channelId);
      if (!ch?.isTextBased()) throw new GatewayError(`Channel ${channelId} is not text based`, 50001);
      const m = await ch.messages.fetch(messageId);
      await m.edit(toDiscordPayload({ ...msg, ephemeral: false }));
    } catch (err) {
      wrapError(err);
    }
  }
  async sendDm(userId: string, msg: OutgoingMessage): Promise<SentMessage> {
    try {
      const user = await this.client.users.fetch(userId);
      const sent = await user.send(toDiscordPayload({ ...msg, ephemeral: false }));
      return { channelId: sent.channelId, messageId: sent.id };
    } catch (err) {
      return wrapError(err);
    }
  }
  async createThread(channelId: string, name: string, fromMessageId?: string) {
    try {
      const ch = await this.client.channels.fetch(channelId);
      if (!ch || !('threads' in ch) || !ch.isTextBased())
        throw new GatewayError('Channel cannot host threads', 50024);
      if (fromMessageId) {
        const m = await ch.messages.fetch(fromMessageId);
        const t = await m.startThread({ name });
        return { threadId: t.id };
      }
      // biome-ignore lint/suspicious/noExplicitAny: text and announcement channels share this API
      const t = await (ch.threads as any).create({ name });
      return { threadId: t.id as string };
    } catch (err) {
      return wrapError(err);
    }
  }

  async reply(id: string, msg: OutgoingMessage) {
    await this.interaction(id)
      .reply(toDiscordPayload(msg) as InteractionReplyOptions)
      .catch(wrapError);
  }
  async deferReply(id: string, ephemeral: boolean) {
    await this.interaction(id)
      .deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {})
      .catch(wrapError);
  }
  async deferUpdate(id: string) {
    const i = this.interaction(id);
    if (!i.isMessageComponent() && !i.isModalSubmit())
      throw new GatewayError('deferUpdate needs a component', null);
    await i.deferUpdate().catch(wrapError);
  }
  async editReply(id: string, msg: OutgoingMessage) {
    const { flags: _f, ...payload } = toDiscordPayload(msg);
    await this.interaction(id).editReply(payload).catch(wrapError);
  }
  async followUp(id: string, msg: OutgoingMessage) {
    await this.interaction(id).followUp(toDiscordPayload(msg)).catch(wrapError);
  }
  async updateMessage(id: string, msg: OutgoingMessage) {
    const i = this.interaction(id);
    const { flags: _f, ...payload } = toDiscordPayload(msg);
    if (i.isMessageComponent() || (i.isModalSubmit() && i.isFromMessage()))
      await i.update(payload).catch(wrapError);
    else await i.editReply(payload).catch(wrapError);
  }
  async showModal(id: string, modal: Modal) {
    const i = this.interaction(id);
    if (!('showModal' in i)) throw new GatewayError('This interaction cannot show a modal', null);
    await i
      .showModal({
        custom_id: modal.customId,
        title: modal.title,
        components: modal.inputs.map((f) => ({
          type: 1,
          components: [
            {
              type: 4,
              custom_id: f.customId,
              label: f.label,
              style: f.style === 'short' ? 1 : 2,
              min_length: f.minLength,
              max_length: f.maxLength,
              required: f.required ?? true,
              placeholder: f.placeholder,
              value: f.value,
            },
          ],
        })),
        // biome-ignore lint/suspicious/noExplicitAny: raw modal JSON
      } as any)
      .catch(wrapError);
  }
  async respondAutocomplete(id: string, choices: { name: string; value: string }[]) {
    const entry = this.live.get(id);
    if (!entry?.i.isAutocomplete()) return;
    await entry.i.respond(choices.slice(0, 25)).catch(wrapError);
  }

  async fetchRoles(): Promise<GuildRole[]> {
    const guild = await this.guild();
    const roles = await guild.roles.fetch().catch(wrapError);
    return [...roles.values()].map((r) => ({
      id: r.id,
      name: r.name,
      color: r.colors?.primaryColor ?? r.color ?? 0,
      position: r.position,
      managed: r.managed,
    }));
  }
  async createRole(role: RoleCreate): Promise<GuildRole> {
    const guild = await this.guild();
    const r = await guild.roles
      .create({
        name: role.name,
        colors: { primaryColor: role.color },
        hoist: role.hoist,
        mentionable: role.mentionable,
        reason: 'Legion role sync',
      })
      .catch(wrapError);
    return { id: r.id, name: r.name, color: role.color, position: r.position, managed: r.managed };
  }
  async editRole(roleId: string, patch: Partial<RoleCreate>): Promise<void> {
    const guild = await this.guild();
    await guild.roles
      .edit(roleId, {
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.color !== undefined ? { colors: { primaryColor: patch.color } } : {}),
        reason: 'Legion role sync',
      })
      .catch(wrapError);
  }
  async fetchMember(userId: string): Promise<GuildMember | null> {
    const guild = await this.guild();
    try {
      const m = await guild.members.fetch(userId);
      return {
        userId: m.id,
        roleIds: [...m.roles.cache.keys()].filter((id) => id !== guild.id),
        isBot: m.user.bot,
        joinedAt: m.joinedAt?.toISOString() ?? null,
        accountCreatedAt: m.user.createdAt.toISOString(),
        displayName: m.displayName,
      };
    } catch (err) {
      if (err instanceof DiscordAPIError && (err.code === 10007 || err.code === 10013)) return null;
      return wrapError(err);
    }
  }
  async addMemberRole(userId: string, roleId: string, reason?: string) {
    const guild = await this.guild();
    await guild.members
      .addRole({ user: userId, role: roleId, ...(reason ? { reason } : {}) })
      .catch(wrapError);
  }
  async removeMemberRole(userId: string, roleId: string, reason?: string) {
    const guild = await this.guild();
    await guild.members
      .removeRole({ user: userId, role: roleId, ...(reason ? { reason } : {}) })
      .catch(wrapError);
  }
  async fetchChannels(): Promise<GuildChannel[]> {
    const guild = await this.guild();
    const channels = await guild.channels.fetch().catch(wrapError);
    return [...channels.values()].flatMap((c) =>
      c
        ? [
            {
              id: c.id,
              name: c.name,
              kind: channelKind(c.type),
              parentId: c.parentId,
              overwrites: [...c.permissionOverwrites.cache.values()].map((o) => ({
                id: o.id,
                type: o.type === 0 ? ('role' as const) : ('member' as const),
                allow: o.allow.toArray(),
                deny: o.deny.toArray(),
              })),
            },
          ]
        : [],
    );
  }
  async setChannelPermissionOverwrite(channelId: string, ow: PermissionOverwrite) {
    const guild = await this.guild();
    const ch = await guild.channels.fetch(channelId).catch(wrapError);
    if (!ch || !('permissionOverwrites' in ch)) throw new GatewayError('Unknown Channel', 10003);
    const perms: Record<string, boolean> = {};
    for (const p of ow.allow) if (p in PermissionFlagsBits) perms[p] = true;
    for (const p of ow.deny) if (p in PermissionFlagsBits) perms[p] = false;
    await ch.permissionOverwrites
      .edit(ow.id, perms, { type: ow.type === 'role' ? 0 : 1, reason: 'Legion /cerebro setup' })
      .catch(wrapError);
  }
  async timeoutMember(userId: string, durationMs: number, reason?: string) {
    const guild = await this.guild();
    const m = await guild.members.fetch(userId).catch(wrapError);
    await m.timeout(durationMs, reason).catch(wrapError);
  }
  async registerCommands(commands: unknown[]) {
    const guild = await this.guild();
    // biome-ignore lint/suspicious/noExplicitAny: command JSON is validated by Discord
    await guild.commands.set(commands as any).catch(wrapError);
  }
}
