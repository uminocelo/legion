import { describe, expect, it } from 'vitest';
import { FakeDiscordGateway } from './fake-gateway.js';
import { GatewayError } from './gateway.js';

describe('fake gateway squad calls', () => {
  it('creates an invite, tracks uses, and deletes it', async () => {
    const gw = new FakeDiscordGateway();
    const created = await gw.createInvite('111', { maxAge: 0, maxUses: 0, unique: true, reason: 'squad' });
    expect(created.url).toBe(`https://discord.gg/${created.code}`);
    expect(await gw.fetchInvites()).toEqual([{ code: created.code, uses: 0, channelId: '111' }]);
    gw.noteInviteUse(created.code);
    gw.noteInviteUse(created.code);
    expect(await gw.fetchInvites()).toEqual([{ code: created.code, uses: 2, channelId: '111' }]);
    await gw.deleteInvite(created.code, 'reset');
    expect(await gw.fetchInvites()).toEqual([]);
    await expect(gw.deleteInvite(created.code)).rejects.toBeInstanceOf(GatewayError);
  });

  it('tracks private-thread membership', async () => {
    const gw = new FakeDiscordGateway();
    gw.addChannel({ id: '222', name: 'esquadroes' });
    const { threadId } = await gw.createPrivateThread('222', 'Noite');
    expect(gw.channels.get(threadId)).toMatchObject({ kind: 'thread', parentId: '222', name: 'Noite' });
    expect([...(gw.threadMembers.get(threadId) ?? [])]).toEqual([]);
    await gw.addThreadMember(threadId, 'user-a');
    await gw.addThreadMember(threadId, 'user-b');
    await gw.addThreadMember(threadId, 'user-a');
    expect([...(gw.threadMembers.get(threadId) ?? [])].sort()).toEqual(['user-a', 'user-b']);
    await gw.removeThreadMember(threadId, 'user-a');
    expect([...(gw.threadMembers.get(threadId) ?? [])]).toEqual(['user-b']);
    await expect(gw.addThreadMember('missing', 'user-a')).rejects.toBeInstanceOf(GatewayError);
    await expect(gw.createPrivateThread(threadId, 'nested')).rejects.toBeInstanceOf(GatewayError);
  });
});
