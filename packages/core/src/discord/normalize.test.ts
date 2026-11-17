import { describe, expect, it } from 'vitest';
import { DiscordJsGateway } from './discordjs-gateway.js';

const GUILD = '100000000000000001';
const gw = new DiscordJsGateway({} as never, GUILD);
const dm = (over: Record<string, unknown> = {}) =>
  ({
    id: 'i1',
    guildId: null,
    channelId: 'dm-channel',
    user: { id: '111' },
    locale: 'pt-BR',
    customId: 'herbie:v1:tutorial',
    inGuild: () => false,
    isButton: () => true,
    ...over,
  }) as never;

describe('DiscordJsGateway.normalize', () => {
  it('accepts a button clicked in a DM as a member with no roles', () => {
    expect(gw.normalize(dm())).toEqual({
      id: 'i1',
      guildId: GUILD,
      channelId: 'dm-channel',
      userId: '111',
      memberRoleIds: [],
      isGuildOwner: false,
      locale: 'pt-BR',
      inDm: true,
      kind: 'component',
      customId: 'herbie:v1:tutorial',
    });
  });

  it('ignores anything else outside the guild', () => {
    expect(gw.normalize(dm({ isButton: () => false }))).toBeNull();
    expect(gw.normalize(dm({ guildId: '999', inGuild: () => true }))).toBeNull();
  });
});
