import type { AnyLegionBot } from '@legion/core';

export function invitePermissions(bots: AnyLegionBot[]): bigint {
  return bots.flatMap((b) => b.permissions).reduce((acc, p) => acc | p, 0n);
}

export function inviteUrl(clientId: string, bots: AnyLegionBot[]): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions: invitePermissions(bots).toString(),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
