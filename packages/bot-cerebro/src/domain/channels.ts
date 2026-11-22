import type { GuildChannel, PermissionOverwrite } from '@legion/core';

const VIEW = 'ViewChannel';

export interface ChannelChange {
  channelId: string;
  channelName: string;
  /** What the change does, for the dry-run list. */
  kind:
    | 'keep_bot_access'
    | 'show_to_registered'
    | 'hide_from_everyone'
    | 'show_to_faction'
    | 'show_to_staff'
    | 'close_to_registered';
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
  /** v1.1 faction areas: each team's category and its channels open only to that team and staff. */
  factionAreas?: readonly { categoryId: string; roleId: string }[];
  /** Staff roles that must keep seeing faction areas (Administrators see them anyway). */
  staffRoleIds?: readonly string[];
}

/** A View-only overwrite without View in either list (other bits kept). */
const withoutView = (base: PermissionOverwrite): PermissionOverwrite => ({
  ...base,
  allow: base.allow.filter((p) => p !== VIEW),
  deny: base.deny.filter((p) => p !== VIEW),
});

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
  const areaRole = new Map((input.factionAreas ?? []).map((a) => [a.categoryId, a.roleId]));
  for (const ch of input.channels) {
    const roleId = areaRole.get(ch.kind === 'category' ? ch.id : (ch.parentId ?? ''));
    if (
      roleId &&
      (ch.kind === 'category' || MANAGED_KINDS.has(ch.kind)) &&
      !input.excludeIds.includes(ch.id)
    ) {
      planArea(input, ch, roleId, changes);
      continue;
    }
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

/**
 * A faction area (the category and each of its channels): the bot keeps access, the team role and
 * the staff roles get View, Registered loses a View allow, and `@everyone` is denied View last.
 * The category is set too so channels created in it later start private.
 */
function planArea(input: ChannelPlanInput, ch: GuildChannel, roleId: string, changes: ChannelChange[]) {
  const find = (id: string) => ch.overwrites.find((o) => o.id === id);
  const add = (kind: ChannelChange['kind'], overwrite: PermissionOverwrite) =>
    changes.push({ channelId: ch.id, channelName: ch.name, kind, overwrite });
  const bot = find(input.botUserId);
  if (BOT_PERMS.some((p) => !(bot?.allow ?? []).includes(p)))
    add('keep_bot_access', {
      id: input.botUserId,
      type: 'member',
      allow: [...new Set([...(bot?.allow ?? []), ...BOT_PERMS])],
      deny: (bot?.deny ?? []).filter((p) => !BOT_PERMS.includes(p)),
    });
  if (!has(find(roleId), 'allow')) add('show_to_faction', withView(find(roleId), roleId, 'role', 'allow'));
  for (const staff of input.staffRoleIds ?? [])
    if (!has(find(staff), 'allow')) add('show_to_staff', withView(find(staff), staff, 'role', 'allow'));
  const registered = find(input.registeredRoleId);
  if (registered && has(registered, 'allow')) add('close_to_registered', withoutView(registered));
  const everyone = find(input.everyoneRoleId);
  if (!has(everyone, 'deny'))
    add('hide_from_everyone', withView(everyone, input.everyoneRoleId, 'role', 'deny'));
}

export interface AreaProblem {
  level: 'fail' | 'warn';
  faction: string;
  /** i18n-free code; the doctor turns it into text. */
  code:
    | 'missing'
    | 'not_category'
    | 'team_cannot_view'
    | 'open_to_everyone'
    | 'open_to_registered'
    | 'open_to_other_team';
  channelName?: string;
}

/**
 * `legion doctor` audit of the faction areas (pure): the category exists and is a category, its team
 * can see it, and nobody else can (`@everyone`, Registered, another team), on the category (❌) and
 * on each of its channels (⚠️, the owner may have changed one on purpose).
 */
export function auditFactionAreas(o: {
  channels: readonly GuildChannel[];
  everyoneRoleId: string;
  registeredRoleId: string | null;
  areas: readonly { faction: string; categoryId: string; roleId: string | null }[];
  /** Every team role, with or without an area. */
  teamRoleIds: readonly string[];
}): AreaProblem[] {
  const out: AreaProblem[] = [];
  const teamRoles = o.teamRoleIds;
  const leaks = (ch: GuildChannel, roleId: string | null): AreaProblem['code'][] => {
    const ow = (id: string | null) => ch.overwrites.find((x) => x.id === id);
    const codes: AreaProblem['code'][] = [];
    if (roleId && !has(ow(roleId), 'allow')) codes.push('team_cannot_view');
    if (!has(ow(o.everyoneRoleId), 'deny')) codes.push('open_to_everyone');
    if (o.registeredRoleId && has(ow(o.registeredRoleId), 'allow')) codes.push('open_to_registered');
    if (teamRoles.some((r) => r !== roleId && has(ow(r), 'allow'))) codes.push('open_to_other_team');
    return codes;
  };
  for (const a of o.areas) {
    const cat = o.channels.find((c) => c.id === a.categoryId);
    if (!cat) {
      out.push({ level: 'fail', faction: a.faction, code: 'missing' });
      continue;
    }
    if (cat.kind !== 'category') {
      out.push({ level: 'fail', faction: a.faction, code: 'not_category', channelName: cat.name });
      continue;
    }
    for (const code of leaks(cat, a.roleId))
      out.push({ level: 'fail', faction: a.faction, code, channelName: cat.name });
    for (const ch of o.channels.filter((c) => c.parentId === cat.id && MANAGED_KINDS.has(c.kind)))
      for (const code of leaks(ch, a.roleId))
        out.push({ level: 'warn', faction: a.faction, code, channelName: ch.name });
  }
  return out;
}
