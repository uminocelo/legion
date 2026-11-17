import { staffCommandsCheck, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { enemyImportIds, ultron } from '../src/index.js';
import { servicesOf, setupUltron } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const STAFF = '900';
const yaml = `
- id: mestre-dos-dez-aneis-falso
  name: "Guarda dos Anéis"
  tier: elite
  minLevel: 2
  base: { hp: 120, atk: 12, def: 9, spd: 10, foc: 8 }
  powerCooldownMax: 3
- id: drone-vigia
  name: "Drone Vigia Mk II"
  tier: minion
  minLevel: 1
  base: { hp: 70, atk: 9, def: 6, spd: 9, foc: 6 }
  powerCooldownMax: 4
`;
function upload(tc: TestContext, text: string, name = 'inimigos.yaml') {
  const url = `https://cdn.discordapp.com/attachments/1/2/${name}`;
  tc.gateway.cdn.set(url, text);
  return { url, name, size: Buffer.byteLength(text), contentType: 'text/yaml' };
}
const cmd = (tc: TestContext, subcommand: string, extra: Record<string, unknown> = {}, userId = STAFF) =>
  tc.interact({
    kind: 'command',
    userId,
    isGuildOwner: userId === STAFF,
    commandName: 'ultron',
    subcommand,
    ...extra,
  });
const reply = (tc: TestContext, id: string) => tc.gateway.lastReply(id);
const buttons = (tc: TestContext, id: string) =>
  (reply(tc, id)?.components?.[0] ?? []).map((b) => ('customId' in b ? (b.customId ?? '') : ''));
const click = (tc: TestContext, customId: string, userId = STAFF) =>
  tc.interact({ kind: 'component', userId, isGuildOwner: userId === STAFF, customId });

describe('enemy imports', () => {
  it('previews new and replaced enemies, publishes, and file reloads keep them', async () => {
    t = await setupUltron();
    const s = servicesOf(t);
    const id = await cmd(t, 'inimigo importar', { attachments: { arquivo: upload(t, yaml) } });
    const desc = reply(t, id)?.embeds?.[0]?.description ?? '';
    expect(reply(t, id)?.embeds?.[0]?.title).toBe('Prévia: 2 inimigo(s)');
    expect(desc).toMatch(/🆕 `mestre-dos-dez-aneis-falso` · \*\*Guarda dos Anéis\*\* · elite · nível 2\+/);
    expect(desc).toMatch(/♻️ `drone-vigia`/);
    expect(await s.repo.template('mestre-dos-dez-aneis-falso')).toBeNull();
    const done = await click(t, buttons(t, id)[0] ?? '');
    expect(reply(t, done)?.content).toMatch(/2 inimigo\(s\) publicado/);
    expect((await s.repo.templates()).map((e) => e.id)).toContain('mestre-dos-dez-aneis-falso');
    await s.encounters.loadContent();
    expect((await s.repo.template('drone-vigia'))?.name).toBe('Drone Vigia Mk II');
    expect(await s.repo.template('mestre-dos-dez-aneis-falso')).not.toBeNull();
  });

  it('reports errors with item and field, and refuses non-staff', async () => {
    t = await setupUltron();
    const bad = yaml.replace('tier: elite', 'tier: deus');
    const id = await cmd(t, 'inimigo importar', { attachments: { arquivo: upload(t, bad) } });
    expect(reply(t, id)?.content).toMatch(/item 1 \(mestre-dos-dez-aneis-falso\) → tier/);
    const canon = await cmd(t, 'inimigo importar', {
      attachments: { arquivo: upload(t, yaml.replace('Guarda dos Anéis', 'Magneto'), 'canon.yaml') },
    });
    expect(reply(t, canon)?.content).toMatch(/item 1 .* → name: nome de personagem existente/);
    expect(await servicesOf(t).repo.template('mestre-dos-dez-aneis-falso')).toBeNull();
    const empty = await cmd(t, 'inimigo importar', {
      attachments: { arquivo: upload(t, '[]', 'vazio.yaml') },
    });
    expect(reply(t, empty)?.content).toMatch(/nenhum inimigo/);
    const no = await cmd(t, 'inimigo importar', { attachments: { arquivo: upload(t, yaml) } }, '111');
    expect(reply(t, no)?.content).toMatch(/staff/i);
    const fake = await click(t, enemyImportIds.decide('x', 'publish'), '111');
    expect(reply(t, fake)?.content).toMatch(/staff/i);
  });

  it('lists, disables (never the last level-1 minion) and survives reloads', async () => {
    t = await setupUltron();
    const s = servicesOf(t);
    const list = await cmd(t, 'inimigo lista');
    expect(reply(t, list)?.embeds?.[0]?.description).toMatch(
      /✅ `drone-vigia` · Drone Vigia · minion · nível 1\+ · arquivo/,
    );
    await cmd(t, 'inimigo desativar', { options: { inimigo: 'drone-vigia' } });
    expect((await s.repo.templates()).map((e) => e.id)).not.toContain('drone-vigia');
    await s.encounters.loadContent();
    expect((await s.repo.templates()).map((e) => e.id)).not.toContain('drone-vigia');
    const lvl1 = (await s.repo.templates()).filter((e) => e.tier === 'minion' && e.minLevel === 1);
    for (const e of lvl1.slice(0, -1)) await cmd(t, 'inimigo desativar', { options: { inimigo: e.id } });
    const last = await cmd(t, 'inimigo desativar', { options: { inimigo: lvl1.at(-1)?.id ?? '' } });
    expect(reply(t, last)?.content).toMatch(/pelo menos um minion de nível 1/);
    await cmd(t, 'inimigo ativar', { options: { inimigo: 'drone-vigia' } });
    await s.encounters.loadContent();
    expect((await s.repo.templates()).map((e) => e.id)).toContain('drone-vigia');
  });
});

describe('staff command visibility check', () => {
  it('warns when a staff role without Administrator is not allowed on /ultron', async () => {
    t = await setupUltron();
    const ctx = t.ctxOf(ultron);
    const check = staffCommandsCheck(ctx, ['ultron']);
    const council = t.gateway.addRole({ name: 'Conselho da Legião', permissions: [] });
    await ctx.roles.refresh();
    const warn = await check.run();
    expect(warn).toMatchObject({ status: 'warn' });
    expect(warn.message).toMatch(/Conselho da Legião → \/ultron/);
    t.gateway.commandPermissions = { ultron: [{ id: council.id, type: 'role', allow: true }] };
    expect(await check.run()).toMatchObject({ status: 'ok' });
    t.gateway.commandPermissions = {};
    t.gateway.addRole({ ...council, permissions: ['Administrator'] });
    await ctx.roles.refresh();
    expect(await check.run()).toMatchObject({
      status: 'ok',
      message: 'Os cargos de staff têm Administrador',
    });
  });
});
