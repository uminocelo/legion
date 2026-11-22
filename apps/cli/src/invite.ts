import type { AnyLegionBot } from '@legion/core';
import { PermissionFlagsBits } from 'discord.js';

export function invitePermissions(bots: AnyLegionBot[]): bigint {
  return bots.flatMap((b) => b.permissions).reduce((acc, p) => acc | p, 0n);
}

/**
 * Extra bits when `squads.enabled`. They stay off the static bot permission list so the invite
 * link does not ask for them while squads are off.
 */
export const SQUAD_INVITE_PERMISSIONS =
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.CreateInstantInvite |
  PermissionFlagsBits.CreatePrivateThreads |
  PermissionFlagsBits.ManageThreads;

export function inviteUrl(clientId: string, bots: AnyLegionBot[], extra: bigint = 0n): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions: (invitePermissions(bots) | extra).toString(),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
