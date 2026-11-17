import type {
  CommandPermissionOverwrite,
  GuildChannel,
  GuildMember,
  GuildRole,
  Modal,
  OutgoingMessage,
  PermissionOverwrite,
  RoleCreate,
} from './types.js';

export interface SentMessage {
  channelId: string;
  messageId: string;
}

/** Discord error raised by the gateway, with the API code when known (e.g. 50007 = DMs closed). */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/**
 * Every Discord side effect goes through this interface (main prompt §5.2).
 * The real implementation wraps discord.js; tests use FakeDiscordGateway.
 */
export interface DiscordGateway {
  readonly botUserId: string;
  // messages
  sendMessage(channelId: string, msg: OutgoingMessage): Promise<SentMessage>;
  editMessage(channelId: string, messageId: string, msg: OutgoingMessage): Promise<void>;
  sendDm(userId: string, msg: OutgoingMessage): Promise<SentMessage>;
  createThread(channelId: string, name: string, fromMessageId?: string): Promise<{ threadId: string }>;
  // interactions
  reply(interactionId: string, msg: OutgoingMessage): Promise<void>;
  deferReply(interactionId: string, ephemeral: boolean): Promise<void>;
  deferUpdate(interactionId: string): Promise<void>;
  editReply(interactionId: string, msg: OutgoingMessage): Promise<void>;
  followUp(interactionId: string, msg: OutgoingMessage): Promise<void>;
  updateMessage(interactionId: string, msg: OutgoingMessage): Promise<void>;
  showModal(interactionId: string, modal: Modal): Promise<void>;
  respondAutocomplete(interactionId: string, choices: { name: string; value: string }[]): Promise<void>;
  // guild
  fetchRoles(): Promise<GuildRole[]>;
  createRole(role: RoleCreate): Promise<GuildRole>;
  editRole(roleId: string, patch: Partial<RoleCreate>): Promise<void>;
  fetchMember(userId: string): Promise<GuildMember | null>;
  addMemberRole(userId: string, roleId: string, reason?: string): Promise<void>;
  removeMemberRole(userId: string, roleId: string, reason?: string): Promise<void>;
  fetchChannels(): Promise<GuildChannel[]>;
  setChannelPermissionOverwrite(channelId: string, overwrite: PermissionOverwrite): Promise<void>;
  timeoutMember(userId: string, durationMs: number, reason?: string): Promise<void>;
  /**
   * Downloads an attachment as text. Only Discord's CDN, at most `maxBytes`.
   * Throws a GatewayError on other hosts, oversize files or network errors.
   */
  fetchAttachment(url: string, maxBytes: number): Promise<string>;
  /** Command permission overwrites by command name; `*` holds the app-wide ones. */
  fetchCommandPermissions(): Promise<Record<string, CommandPermissionOverwrite[]>>;
  /** Registers the guild's slash commands (replaces the whole set). */
  registerCommands(commands: unknown[]): Promise<void>;
}
