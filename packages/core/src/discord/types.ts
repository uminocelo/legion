import type { BotId } from '../config/schema.js';

/** Plain Discord API shapes (JSON), so domain code and tests never need discord.js objects. */
export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}
export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: EmbedField[];
  author?: { name: string; icon_url?: string };
  footer?: { text: string };
  timestamp?: string;
}

export type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger' | 'link';
export interface ButtonComponent {
  type: 'button';
  customId?: string;
  url?: string;
  label: string;
  style: ButtonStyle;
  emoji?: string;
  disabled?: boolean;
}
export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: string;
  default?: boolean;
}
export interface SelectComponent {
  type: 'select';
  customId: string;
  placeholder?: string;
  options: SelectOption[];
  minValues?: number;
  maxValues?: number;
}
export type ActionRow = (ButtonComponent | SelectComponent)[];

export interface AllowedMentions {
  parse?: ('users' | 'roles' | 'everyone')[];
  users?: string[];
  roles?: string[];
}

export interface OutgoingMessage {
  /** Which bot "speaks". Picks the embed author, color and footer (and later a webhook). */
  persona: BotId;
  content?: string;
  embeds?: Embed[];
  components?: ActionRow[];
  ephemeral?: boolean;
  /** Defaults to no pings at all; mention only the addressed member. */
  allowedMentions?: AllowedMentions;
}

export interface ModalTextInput {
  customId: string;
  label: string;
  style: 'short' | 'paragraph';
  minLength?: number;
  maxLength?: number;
  required?: boolean;
  placeholder?: string;
  value?: string;
}
export interface Modal {
  customId: string;
  title: string;
  inputs: ModalTextInput[];
}

export interface GuildRole {
  id: string;
  name: string;
  /** RGB integer, 0 = no color. */
  color: number;
  position: number;
  /** Managed by an integration or a bot (Discord's flag). */
  managed: boolean;
  /** Server-wide permission names (discord.js flag names, e.g. `ModerateMembers`). Unknown when absent. */
  permissions?: string[];
}

export interface GuildMember {
  userId: string;
  roleIds: string[];
  isBot: boolean;
  joinedAt: string | null;
  accountCreatedAt: string;
  displayName: string;
}

export type ChannelKind = 'text' | 'voice' | 'category' | 'forum' | 'announcement' | 'thread' | 'other';
export interface PermissionOverwrite {
  /** Role or member id. The @everyone role id equals the guild id. */
  id: string;
  type: 'role' | 'member';
  allow: string[];
  deny: string[];
}
export interface GuildChannel {
  id: string;
  name: string;
  kind: ChannelKind;
  parentId: string | null;
  overwrites: PermissionOverwrite[];
}

export interface RoleCreate {
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
}

/** One incoming interaction, already normalized from discord.js. */
export interface IncomingInteraction {
  id: string;
  kind: 'command' | 'component' | 'modal' | 'autocomplete' | 'context_menu';
  guildId: string;
  channelId: string;
  userId: string;
  memberRoleIds: string[];
  isGuildOwner: boolean;
  locale: string | null;
  /** A button clicked on a message the bot sent by DM (no guild roles known). */
  inDm?: boolean;
  commandName?: string;
  subcommand?: string | null;
  options?: Record<string, string | number | boolean | null>;
  customId?: string;
  values?: string[];
  fields?: Record<string, string>;
  focused?: { name: string; value: string };
  /** Context-menu target (message commands). */
  target?: { messageId: string; channelId: string; authorId: string };
}
