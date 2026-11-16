import { PermissionFlagsBits } from 'discord.js';
import type { ApiChannel, ApiMember, ApiRole } from './rest.js';

const ALL = (1n << 53n) - 1n;

/** Effective permissions of a member in a channel (Discord's documented algorithm). */
export function channelPermissions(
  guildId: string,
  member: ApiMember & { id: string },
  roles: ApiRole[],
  channel: ApiChannel,
): bigint {
  const byId = new Map(roles.map((r) => [r.id, r]));
  let perms = BigInt(byId.get(guildId)?.permissions ?? '0');
  for (const id of member.roles) perms |= BigInt(byId.get(id)?.permissions ?? '0');
  if (perms & PermissionFlagsBits.Administrator) return ALL;
  const ows = channel.permission_overwrites ?? [];
  const everyone = ows.find((o) => o.id === guildId);
  if (everyone) perms = (perms & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let allow = 0n;
  let deny = 0n;
  for (const o of ows) {
    if (o.type === 0 && member.roles.includes(o.id)) {
      allow |= BigInt(o.allow);
      deny |= BigInt(o.deny);
    }
  }
  perms = (perms & ~deny) | allow;
  const own = ows.find((o) => o.type === 1 && o.id === member.id);
  if (own) perms = (perms & ~BigInt(own.deny)) | BigInt(own.allow);
  return perms;
}

export function missingPermissions(perms: bigint, needed: Record<string, bigint>): string[] {
  return Object.entries(needed)
    .filter(([, bit]) => (perms & bit) !== bit)
    .map(([name]) => name);
}
