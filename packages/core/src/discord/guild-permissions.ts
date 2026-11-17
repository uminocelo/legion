import { PermissionsBitField } from 'discord.js';
import type { GuildMember, GuildRole } from './types.js';

/** Permission names for a list of bits (e.g. a bot's `permissions`). */
export const permissionNames = (bits: readonly bigint[]): string[] =>
  new PermissionsBitField(bits.reduce((a, b) => a | b, 0n)).toArray();

/** Server-wide permissions of a member: @everyone plus every role (Administrator grants all). */
export function guildPermissionsOf(
  guildId: string,
  member: Pick<GuildMember, 'roleIds'>,
  roles: readonly GuildRole[],
): Set<string> | null {
  const byId = new Map(roles.map((r) => [r.id, r]));
  const out = new Set<string>();
  for (const id of [guildId, ...member.roleIds]) {
    const perms = byId.get(id)?.permissions;
    if (!perms) {
      if (id === guildId) continue;
      return null; // permissions unknown (fake gateway or old data)
    }
    for (const p of perms) out.add(p);
  }
  return out;
}

/** Permissions from `needed` the member lacks server-wide ([] when Administrator; null when unknown). */
export function missingGuildPermissions(
  guildId: string,
  member: Pick<GuildMember, 'roleIds'>,
  roles: readonly GuildRole[],
  needed: readonly string[],
): string[] | null {
  const have = guildPermissionsOf(guildId, member, roles);
  if (!have) return null;
  if (have.has('Administrator')) return [];
  return needed.filter((p) => !have.has(p));
}

/** Highest role position of a member (0 = only @everyone). */
export function topRolePosition(member: Pick<GuildMember, 'roleIds'>, roles: readonly GuildRole[]): number {
  const byId = new Map(roles.map((r) => [r.id, r]));
  return Math.max(0, ...member.roleIds.map((id) => byId.get(id)?.position ?? 0));
}
