import type { GuildChannel, PermissionOverwrite } from '@legion/core';

const VIEW = 'ViewChannel';

export interface ChannelChange {
  channelId: string;
  channelName: string;
  /** What the change does, for the dry-run list. */
  kind: 'keep_bot_access' | 'show_to_registered' | 'hide_from_everyone';
  overwrite: PermissionOverwrite;
}

export interface ChannelPlanInput {
  channels: readonly GuildChannel[];
  everyoneRoleId: string;
  registeredRoleId: string;
  /** The bot's own user id: it keeps View/Send/Embed through a member overwrite. */
  botUserId: string;
  welcomeId: string | null;
  rulesId: string | null;
  excludeIds: readonly string[];
}

const has = (o: PermissionOverwrite | undefined, list: 'allow' | 'deny') => o?.[list].includes(VIEW) ?? false;

const withView = (
  base: PermissionOverwrite | undefined,
  id: string,
  type: 'role' | 'member',
  mode: 'allow' | 'deny',
) => {
  const allow = (base?.allow ?? []).filter((p) => p !== VIEW);
  const deny = (base?.deny ?? []).filter((p) => p !== VIEW);
  (mode === 'allow' ? allow : deny).push(VIEW);
  return { id, type, allow, deny };
};

const MANAGED_KINDS = new Set<GuildChannel['kind']>(['text', 'voice', 'announcement', 'forum']);
const BOT_PERMS = [VIEW, 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'];

/**
 * Pure plan for `/cerebro setup canais:true` (Part B): `@everyone` loses View Channel everywhere
 * except welcome and rules; `Herói Registrado` gets View Channel on community channels.
 *
 * Per channel the order matters: first the bot gets its own member overwrite (otherwise hiding the
 * channel from `@everyone` would lock the bot out mid-way), then Registered is allowed, and only then
 * `@everyone` is denied. Skips threads, categories (their channels are handled one by one), unknown channel kinds, excluded
 * channels, and staff channels: hidden from `@everyone`, not opened to Registered, and never touched by
 * the bot (no bot overwrite). Keeps every other permission bit. Already-correct channels produce no change.
 */
export function planChannelVisibility(input: ChannelPlanInput): ChannelChange[] {
  const changes: ChannelChange[] = [];
  const open = new Set([input.welcomeId, input.rulesId].filter(Boolean));
  for (const ch of input.channels) {
    // Only channel kinds we understand. Threads follow their parent, categories would cascade to synced
    // children (Discord copies a category's overwrites to them), and unknown kinds (Discord-managed hubs,
    // new types) are left alone.
    if (!MANAGED_KINDS.has(ch.kind) || open.has(ch.id) || input.excludeIds.includes(ch.id)) continue;
    const everyone = ch.overwrites.find((o) => o.id === input.everyoneRoleId);
    const registered = ch.overwrites.find((o) => o.id === input.registeredRoleId);
    const bot = ch.overwrites.find((o) => o.id === input.botUserId);
    if (has(everyone, 'deny') && !has(registered, 'allow') && !bot) continue; // staff channel
    const add = (kind: ChannelChange['kind'], overwrite: PermissionOverwrite) =>
      changes.push({ channelId: ch.id, channelName: ch.name, kind, overwrite });
    const botMissing = BOT_PERMS.filter((p) => !(bot?.allow ?? []).includes(p));
    if (botMissing.length)
      add('keep_bot_access', {
        id: input.botUserId,
        type: 'member',
        allow: [...new Set([...(bot?.allow ?? []), ...BOT_PERMS])],
        deny: (bot?.deny ?? []).filter((p) => !BOT_PERMS.includes(p)),
      });
    if (!has(registered, 'allow'))
      add('show_to_registered', withView(registered, input.registeredRoleId, 'role', 'allow'));
    if (!has(everyone, 'deny'))
      add('hide_from_everyone', withView(everyone, input.everyoneRoleId, 'role', 'deny'));
  }
  return changes;
}
