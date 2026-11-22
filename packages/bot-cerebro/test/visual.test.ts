import { afterEach, describe, expect, it } from 'vitest';
import { CerebroRepo, cosmeticsOf } from '../src/index.js';
import { join, register, setupCerebro, USER } from './helpers.js';

let t: Awaited<ReturnType<typeof setupCerebro>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const repoOf = (tc: NonNullable<typeof t>) =>
  new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId);

async function grantSupporter(tc: NonNullable<typeof t>, userId = USER) {
  const role = tc.gateway.roleByName('Apoiador');
  if (!role) throw new Error('missing Apoiador role');
  await tc.gateway.addMemberRole(userId, role.id);
  return role;
}

describe('/cerebro visual (US-24)', () => {
  it('lets a supporter set and clear frame and title from the catalog', async () => {
    t = await setupCerebro();
    await register(t);
    await grantSupporter(t);

    const open = await t.interact({
      kind: 'command',
      userId: USER,
      commandName: 'cerebro',
      subcommand: 'visual',
    });
    const panel = t.gateway.lastReply(open);
    expect(panel?.ephemeral).toBe(true);
    expect(panel?.embeds?.[0]?.title).toContain('Visual');
    const selects = panel?.components?.flat().filter((c) => 'type' in c && c.type === 'select') ?? [];
    expect(selects).toHaveLength(2);

    const frameId = await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:frame',
      values: ['frame-aurora'],
    });
    expect(t.gateway.lastReply(frameId)?.content).toContain('Aurora');
    expect(t.gateway.lastReply(frameId)?.content).toContain('/perfil');

    const titleId = await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:title',
      values: ['title-patron'],
    });
    expect(t.gateway.lastReply(titleId)?.content).toContain('Patrono');

    const member = await repoOf(t).memberByDiscordId(USER);
    if (!member) throw new Error('member missing after pick');
    expect(cosmeticsOf(member)).toEqual({ frameId: 'frame-aurora', titleId: 'title-patron' });

    await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:frame',
      values: ['none'],
    });
    await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:title',
      values: ['none'],
    });
    const cleared = await repoOf(t).memberByDiscordId(USER);
    if (!cleared) throw new Error('member missing after clear');
    expect(cosmeticsOf(cleared)).toEqual({ frameId: null, titleId: null });
  });

  it('refuses a non-supporter with a clear message and does not save', async () => {
    t = await setupCerebro();
    await register(t);

    const id = await t.interact({
      kind: 'command',
      userId: USER,
      commandName: 'cerebro',
      subcommand: 'visual',
    });
    const reply = t.gateway.lastReply(id);
    expect(reply?.content).toContain('Apoiador');
    expect(reply?.components).toBeUndefined();

    // Stale component click without the role must not persist a pick.
    await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:frame',
      values: ['frame-ember'],
    });
    const member = await repoOf(t).memberByDiscordId(USER);
    if (!member) throw new Error('member missing');
    expect(cosmeticsOf(member)).toEqual({ frameId: null, titleId: null });
  });

  it('refuses unregistered members like preferencias', async () => {
    t = await setupCerebro();
    await join(t);
    await grantSupporter(t);
    const id = await t.interact({
      kind: 'command',
      userId: USER,
      commandName: 'cerebro',
      subcommand: 'visual',
    });
    expect(t.gateway.lastReply(id)?.content).toContain('ainda não é um herói registrado');
  });
});
