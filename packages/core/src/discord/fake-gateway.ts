import type { DiscordGateway, SentMessage } from './gateway.js';
import { GatewayError } from './gateway.js';
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

export interface RecordedCall {
  method: keyof DiscordGateway;
  args: unknown[];
}

export interface StoredMessage extends SentMessage {
  msg: OutgoingMessage;
  dm: boolean;
}

/**
 * In-memory Discord for tests: records every call and simulates roles, members, channels,
 * messages and interaction responses. Configure failures with `failNext` or `closedDms`.
 */
export class FakeDiscordGateway implements DiscordGateway {
  readonly calls: RecordedCall[] = [];
  readonly roles = new Map<string, GuildRole>();
  readonly members = new Map<string, GuildMember>();
  readonly channels = new Map<string, GuildChannel>();
  readonly messages: StoredMessage[] = [];
  readonly interactionReplies = new Map<string, { kind: string; msg?: OutgoingMessage; modal?: Modal }[]>();
  readonly closedDms = new Set<string>();
  registeredCommands: unknown[] | null = null;
  /** Rejects the next call to `method` with this error. */
  private readonly failures = new Map<string, Error>();
  private seq = 1000;

  constructor(
    readonly botUserId = '900000000000000001',
    readonly guildId = '100000000000000001',
  ) {
    this.addRole({ id: guildId, name: '@everyone', position: 0 });
    this.addRole({ id: '900000000000000099', name: 'Legion', position: 100, managed: true });
    this.addMember({ userId: botUserId, isBot: true, roleIds: ['900000000000000099'] });
  }

  private nextId(): string {
    return String(++this.seq).padStart(18, '9');
  }

  // ---- test helpers ----
  addRole(r: Partial<GuildRole> & { name: string }): GuildRole {
    const role: GuildRole = { id: r.id ?? this.nextId(), color: 0, position: 1, managed: false, ...r };
    this.roles.set(role.id, role);
    return role;
  }
  roleByName(name: string): GuildRole | undefined {
    return [...this.roles.values()].find((r) => r.name === name);
  }
  addMember(m: Partial<GuildMember> & { userId: string }): GuildMember {
    const member: GuildMember = {
      roleIds: [],
      isBot: false,
      joinedAt: '2026-01-01T00:00:00.000Z',
      accountCreatedAt: '2020-01-01T00:00:00.000Z',
      displayName: `user${m.userId.slice(-4)}`,
      ...m,
    };
    this.members.set(member.userId, member);
    return member;
  }
  memberRoleNames(userId: string): string[] {
    return (this.members.get(userId)?.roleIds ?? []).map((id) => this.roles.get(id)?.name ?? id).sort();
  }
  addChannel(c: Partial<GuildChannel> & { id: string; name: string }): GuildChannel {
    const ch: GuildChannel = { kind: 'text', parentId: null, overwrites: [], ...c };
    this.channels.set(ch.id, ch);
    return ch;
  }
  failNext(
    method: keyof DiscordGateway,
    error: Error = new GatewayError('Missing Permissions', 50013),
  ): void {
    this.failures.set(method, error);
  }
  repliesTo(interactionId: string) {
    return this.interactionReplies.get(interactionId) ?? [];
  }
  lastReply(interactionId: string): OutgoingMessage | undefined {
    return this.repliesTo(interactionId)
      .filter((r) => r.msg)
      .at(-1)?.msg;
  }
  callsOf(method: keyof DiscordGateway): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  private record(method: keyof DiscordGateway, args: unknown[]): void {
    this.calls.push({ method, args });
    const err = this.failures.get(method);
    if (err) {
      this.failures.delete(method);
      throw err;
    }
  }
  private respond(id: string, entry: { kind: string; msg?: OutgoingMessage; modal?: Modal }) {
    const list = this.interactionReplies.get(id) ?? [];
    list.push(entry);
    this.interactionReplies.set(id, list);
  }

  // ---- messages ----
  async sendMessage(channelId: string, msg: OutgoingMessage): Promise<SentMessage> {
    this.record('sendMessage', [channelId, msg]);
    const sent = { channelId, messageId: this.nextId() };
    this.messages.push({ ...sent, msg, dm: false });
    return sent;
  }
  async editMessage(channelId: string, messageId: string, msg: OutgoingMessage): Promise<void> {
    this.record('editMessage', [channelId, messageId, msg]);
    const m = this.messages.find((x) => x.messageId === messageId);
    if (!m) throw new GatewayError('Unknown Message', 10008);
    m.msg = msg;
  }
  async sendDm(userId: string, msg: OutgoingMessage): Promise<SentMessage> {
    this.record('sendDm', [userId, msg]);
    if (this.closedDms.has(userId)) throw new GatewayError('Cannot send messages to this user', 50007);
    const sent = { channelId: `dm:${userId}`, messageId: this.nextId() };
    this.messages.push({ ...sent, msg, dm: true });
    return sent;
  }
  async createThread(channelId: string, name: string, fromMessageId?: string) {
    this.record('createThread', [channelId, name, fromMessageId]);
    // Like Discord: a thread cannot hold another thread.
    if (this.channels.get(channelId)?.kind === 'thread')
      throw new GatewayError('Channel cannot host threads', 50024);
    const threadId = this.nextId();
    this.addChannel({ id: threadId, name, kind: 'thread', parentId: channelId });
    return { threadId };
  }

  /** Files the fake CDN serves (url → text), and command permission overwrites by command name. */
  readonly cdn = new Map<string, string>();
  commandPermissions: Record<string, CommandPermissionOverwrite[]> = {};

  async fetchAttachment(url: string, maxBytes: number): Promise<string> {
    this.record('fetchAttachment', [url, maxBytes]);
    const text = this.cdn.get(url);
    if (text === undefined) throw new GatewayError('Download failed: HTTP 404', 404);
    if (Buffer.byteLength(text) > maxBytes) throw new GatewayError('Attachment too large', null);
    return text;
  }

  async fetchCommandPermissions(): Promise<Record<string, CommandPermissionOverwrite[]>> {
    this.record('fetchCommandPermissions', []);
    return this.commandPermissions;
  }

  // ---- interactions ----
  async reply(id: string, msg: OutgoingMessage) {
    this.record('reply', [id, msg]);
    this.respond(id, { kind: 'reply', msg });
  }
  async deferReply(id: string, ephemeral: boolean) {
    this.record('deferReply', [id, ephemeral]);
    this.respond(id, { kind: 'deferReply' });
  }
  async deferUpdate(id: string) {
    this.record('deferUpdate', [id]);
    this.respond(id, { kind: 'deferUpdate' });
  }
  async editReply(id: string, msg: OutgoingMessage) {
    this.record('editReply', [id, msg]);
    this.respond(id, { kind: 'editReply', msg });
  }
  async followUp(id: string, msg: OutgoingMessage) {
    this.record('followUp', [id, msg]);
    this.respond(id, { kind: 'followUp', msg });
  }
  async updateMessage(id: string, msg: OutgoingMessage) {
    this.record('updateMessage', [id, msg]);
    this.respond(id, { kind: 'updateMessage', msg });
  }
  async showModal(id: string, modal: Modal) {
    this.record('showModal', [id, modal]);
    this.respond(id, { kind: 'showModal', modal });
  }
  async respondAutocomplete(id: string, choices: { name: string; value: string }[]) {
    this.record('respondAutocomplete', [id, choices]);
    this.respond(id, { kind: 'autocomplete' });
  }

  // ---- guild ----
  async fetchRoles(): Promise<GuildRole[]> {
    this.record('fetchRoles', []);
    return [...this.roles.values()].map((r) => ({ ...r }));
  }
  async createRole(role: RoleCreate): Promise<GuildRole> {
    this.record('createRole', [role]);
    return this.addRole({ name: role.name, color: role.color, position: 1 });
  }
  async editRole(roleId: string, patch: Partial<RoleCreate>): Promise<void> {
    this.record('editRole', [roleId, patch]);
    const r = this.roles.get(roleId);
    if (!r) throw new GatewayError('Unknown Role', 10011);
    Object.assign(
      r,
      patch.name ? { name: patch.name } : {},
      patch.color !== undefined ? { color: patch.color } : {},
    );
  }
  async fetchMember(userId: string): Promise<GuildMember | null> {
    this.record('fetchMember', [userId]);
    const m = this.members.get(userId);
    return m ? { ...m, roleIds: [...m.roleIds] } : null;
  }
  async addMemberRole(userId: string, roleId: string, reason?: string): Promise<void> {
    this.record('addMemberRole', [userId, roleId, reason]);
    const m = this.members.get(userId);
    if (!m) throw new GatewayError('Unknown Member', 10007);
    if (!m.roleIds.includes(roleId)) m.roleIds.push(roleId);
  }
  async removeMemberRole(userId: string, roleId: string, reason?: string): Promise<void> {
    this.record('removeMemberRole', [userId, roleId, reason]);
    const m = this.members.get(userId);
    if (!m) throw new GatewayError('Unknown Member', 10007);
    m.roleIds = m.roleIds.filter((r) => r !== roleId);
  }
  async fetchChannels(): Promise<GuildChannel[]> {
    this.record('fetchChannels', []);
    return [...this.channels.values()].map((c) => ({
      ...c,
      overwrites: c.overwrites.map((o) => ({ ...o })),
    }));
  }
  async setChannelPermissionOverwrite(channelId: string, overwrite: PermissionOverwrite): Promise<void> {
    this.record('setChannelPermissionOverwrite', [channelId, overwrite]);
    const ch = this.channels.get(channelId);
    if (!ch) throw new GatewayError('Unknown Channel', 10003);
    ch.overwrites = [...ch.overwrites.filter((o) => o.id !== overwrite.id), overwrite];
  }
  async timeoutMember(userId: string, durationMs: number, reason?: string): Promise<void> {
    this.record('timeoutMember', [userId, durationMs, reason]);
  }
  async registerCommands(commands: unknown[]): Promise<void> {
    this.record('registerCommands', [commands]);
    this.registeredCommands = commands;
  }
}
