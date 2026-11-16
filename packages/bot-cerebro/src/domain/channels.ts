import type { GuildChannel, PermissionOverwrite } from '@legion/core';

const VIEW = 'ViewChannel';

export interface ChannelChange {
  channelId: string;
  channelName: string;
  /** What the change does, for the dry-run list. */
  kind: 'hide_from_everyone' | 'show_to_registered';
  overwrite: PermissionOverwrite;
}

export interface ChannelPlanInput {
  channels: readonly GuildChannel[];
  everyoneRoleId: string;
  registeredRoleId: string;
  welcomeId: string | null;
  rulesId: string | null;
  excludeIds: readonly string[];
}

const has = (o: PermissionOverwrite | undefined, list: 'allow' | 'deny') => o?.[list].includes(VIEW) ?? false;

const withView = (
  base: PermissionOverwrite | undefined,
  id: string,
  type: 'role',
  mode: 'allow' | 'deny',
) => {
  const allow = (base?.allow ?? []).filter((p) => p !== VIEW);
  const deny = (base?.deny ?? []).filter((p) => p !== VIEW);
  (mode === 'allow' ? allow : deny).push(VIEW);
  return { id, type, allow, deny };
};

/**
 * Pure plan for `/cerebro setup canais:true` (Part B): `@everyone` loses View Channel everywhere
 * except welcome and rules; `Mutante Registrado` gets View Channel on community channels.
 * Skips threads, excluded channels, and staff channels (those already hiding from `@everyone`
 * without a Registered allow). Keeps every other permission bit. Already-correct channels produce no change.
 */
export function planChannelVisibility(input: ChannelPlanInput): ChannelChange[] {
  const changes: ChannelChange[] = [];
  const open = new Set([input.welcomeId, input.rulesId].filter(Boolean));
  for (const ch of input.channels) {
    if (ch.kind === 'thread' || open.has(ch.id) || input.excludeIds.includes(ch.id)) continue;
    const everyone = ch.overwrites.find((o) => o.id === input.everyoneRoleId);
    const registered = ch.overwrites.find((o) => o.id === input.registeredRoleId);
    // Staff channel: already hidden from @everyone and not opened to Registered.
    if (has(everyone, 'deny') && !has(registered, 'allow')) continue;
    if (!has(everyone, 'deny'))
      changes.push({
        channelId: ch.id,
        channelName: ch.name,
        kind: 'hide_from_everyone',
        overwrite: withView(everyone, input.everyoneRoleId, 'role', 'deny'),
      });
    if (!has(registered, 'allow'))
      changes.push({
        channelId: ch.id,
        channelName: ch.name,
        kind: 'show_to_registered',
        overwrite: withView(registered, input.registeredRoleId, 'role', 'allow'),
      });
  }
  return changes;
}
