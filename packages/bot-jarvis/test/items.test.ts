import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { itemDirs, readItems } from '../src/index.js';
import { addMember, award, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
const tmp: string[] = [];
afterEach(async () => {
  await t?.close();
  t = undefined;
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

const item = (id: string, slot = 'traje', extra = '') =>
  `- { id: ${id}, slot: ${slot}, name: { pt-BR: Item ${id} }, bonus: { def: 1, hp: 8 }${extra} }\n`;

/** A shipped folder and a server folder, with the given files. */
function dirs(shipped: Record<string, string>, server: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'items-'));
  tmp.push(root);
  const out = [join(root, 'shipped'), join(root, 'server')];
  for (const [i, files] of [shipped, server].entries()) {
    mkdirSync(out[i] as string);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(out[i] as string, name), text);
  }
  return out;
}

describe('shipped items', () => {
  it('load without errors: 4 per slot, levels 1–8, 2 cosmetic', () => {
    const { items, errors } = readItems(itemDirs('/nonexistent'));
    expect(errors).toEqual([]);
    expect(items).toHaveLength(12);
    for (const slot of ['traje', 'acessorio', 'dispositivo'])
      expect(items.filter((i) => i.slot === slot)).toHaveLength(4);
    expect(items.filter((i) => i.cosmetic)).toHaveLength(2);
    expect(Math.min(...items.map((i) => i.minLevel))).toBe(1);
    expect(Math.max(...items.map((i) => i.minLevel))).toBe(8);
    expect(items.every((i) => i.name.en && i.description?.en)).toBe(true);
  });
});

describe('ItemCatalog', () => {
  it('a server file overrides a shipped item by id; a broken server file is skipped whole', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const d = dirs(
      { 'a.yaml': item('capuz') + item('luva', 'acessorio') },
      {
        'mine.yaml': item('capuz', 'traje', ', minLevel: 4'),
        'zz-bad.yaml': item('quebrado') + item('Bad Id'),
      },
    );
    const res = await s.items.reload(d);
    expect(res.errors.some((e) => e.startsWith('zz-bad.yaml → item 2 (Bad Id) → id:'))).toBe(true);
    expect(
      (await s.items.all())
        .filter((r) => ['capuz', 'luva', 'quebrado'].includes(r.id))
        .map((r) => [r.id, r.minLevel]),
    ).toEqual([
      ['capuz', 4],
      ['luva', 1],
    ]);
  });

  it('reloads keep staff rows and disabled_by; a removed file makes items inactive', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const d = dirs({ 'a.yaml': item('capuz') + item('luva', 'acessorio') + item('visor', 'dispositivo') });
    expect(await s.items.reload(d)).toMatchObject({ added: 3, errors: [] });
    const tbl = s.repo.t.jarvisItems;
    await t.db.orm.insert(tbl).values({
      id: 'staff-item',
      slot: 'traje',
      minLevel: 1,
      cosmetic: 1,
      definition:
        '{"id":"staff-item","slot":"traje","minLevel":1,"name":{"pt-BR":"S"},"bonus":{},"cosmetic":true}',
      contentHash: 'x',
      origin: 'staff',
      updatedAt: s.repo.now(),
    });
    await s.inventory.deactivate('luva', 'staff-1');

    writeFileSync(join(d[0] as string, 'a.yaml'), item('capuz') + item('luva', 'acessorio'));
    const res = await s.items.reload(d);
    expect(res).toMatchObject({ deactivated: 1, errors: [] });
    const rows = new Map((await s.items.all()).map((r) => [r.id, r]));
    expect(rows.get('visor')?.active).toBe(0);
    expect(rows.get('luva')).toMatchObject({ active: 0, disabledBy: 'staff-1' });
    expect(rows.get('capuz')?.active).toBe(1);
    expect(rows.get('staff-item')).toMatchObject({ active: 1, origin: 'staff', contentHash: 'x' });
    // A file with an error never deactivates anything.
    writeFileSync(join(d[0] as string, 'a.yaml'), 'nope: [');
    expect((await s.items.reload(d)).deactivated).toBe(0);
    expect((await s.items.row('capuz'))?.active).toBe(1);
  });

  it('active: false in a file makes the item inactive', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    await s.items.reload(dirs({ 'a.yaml': item('capuz', 'traje', ', active: false') }));
    expect((await s.items.row('capuz'))?.active).toBe(0);
  });
});

describe('InventoryService', () => {
  async function setup() {
    t = await setupJarvis();
    const s = servicesOf(t);
    const d = dirs({
      'a.yaml':
        item('capuz') +
        item('manto') +
        item('luva', 'acessorio') +
        item('visor', 'dispositivo', ', minLevel: 3') +
        `- { id: botas, slot: acessorio, name: { pt-BR: Botas }, bonus: { atk: 2, spd: 1 } }\n`,
    });
    await s.items.reload(d);
    const m = await addMember(t, '111');
    return { s, m, d, tc: t };
  }

  it('grant: once per member, unknown items refused, records who gave it', async () => {
    const { s, m } = await setup();
    expect(
      await s.inventory.grant({
        memberId: m,
        itemId: 'capuz',
        source: 'staff',
        grantedBy: '9',
        note: 'evento',
      }),
    ).toEqual({ ok: true });
    expect(await s.inventory.grant({ memberId: m, itemId: 'capuz', source: 'staff' })).toEqual({
      ok: false,
      reason: 'owned',
    });
    expect(await s.inventory.grant({ memberId: m, itemId: 'nada', source: 'staff' })).toEqual({
      ok: false,
      reason: 'unknown',
    });
    expect(await s.inventory.owned(m)).toMatchObject([
      { itemId: 'capuz', source: 'staff', grantedBy: '9', note: 'evento' },
    ]);
  });

  it('equip refuses not owned, wrong slot, level too high and inactive', async () => {
    const { s, m, tc } = await setup();
    for (const id of ['capuz', 'visor', 'luva'])
      await s.inventory.grant({ memberId: m, itemId: id, source: 'staff' });
    expect(await s.inventory.equip(m, 'manto', 'traje')).toEqual({ ok: false, reason: 'not_owned' });
    expect(await s.inventory.equip(m, 'capuz', 'acessorio')).toEqual({ ok: false, reason: 'slot' });
    expect(await s.inventory.equip(m, 'visor', 'dispositivo')).toEqual({
      ok: false,
      reason: 'level',
      minLevel: 3,
    });
    await award(tc, m, 200, 'lvl'); // level 3
    expect(await s.inventory.equip(m, 'visor', 'dispositivo')).toEqual({ ok: true, replaced: null });
    await s.inventory.deactivate('luva');
    expect(await s.inventory.equip(m, 'luva', 'acessorio')).toEqual({ ok: false, reason: 'inactive' });
    expect(await s.inventory.equipment(m)).toEqual(new Map([['dispositivo', 'visor']]));
  });

  it('equip swaps the item in a slot; unequip empties it; bonus is the raw sum', async () => {
    const { s, m } = await setup();
    for (const id of ['capuz', 'manto', 'luva', 'botas'])
      await s.inventory.grant({ memberId: m, itemId: id, source: 'staff' });
    expect(await s.inventory.equip(m, 'capuz', 'traje')).toEqual({ ok: true, replaced: null });
    expect(await s.inventory.equip(m, 'manto', 'traje')).toEqual({ ok: true, replaced: 'capuz' });
    expect(await s.inventory.equip(m, 'botas', 'acessorio')).toEqual({ ok: true, replaced: null });
    expect(await s.inventory.bonusOf(m)).toEqual({ hp: 8, atk: 2, def: 1, spd: 1, foc: 0 });
    const gear = s.inventory.gearReadModel();
    expect((await gear.equippedOf(m)).map((e) => [e.slot, e.itemId]).sort()).toEqual([
      ['acessorio', 'botas'],
      ['traje', 'manto'],
    ]);
    expect(gear.statCap()).toBe(2);
    expect(await s.inventory.unequip(m, 'traje')).toBe(true);
    expect(await s.inventory.unequip(m, 'traje')).toBe(false);
    expect((await s.inventory.bonusOf(m)).hp).toBe(0);
  });

  it('deactivate unequips everyone, keeps ownership, gives no bonus and does not re-equip on enable', async () => {
    const { s, m, d, tc } = await setup();
    const n = await addMember(tc, '222');
    for (const who of [m, n]) {
      await s.inventory.grant({ memberId: who, itemId: 'capuz', source: 'staff' });
      await s.inventory.equip(who, 'capuz', 'traje');
    }
    expect(await s.inventory.deactivate('capuz')).toBe(2);
    expect(await s.inventory.equipment(m)).toEqual(new Map());
    expect((await s.inventory.owned(m)).map((r) => r.itemId)).toEqual(['capuz']);
    expect(await s.inventory.bonusOf(m)).toEqual({ hp: 0, atk: 0, def: 0, spd: 0, foc: 0 });
    // A reload turns it back on (no disabled_by), but nobody gets it back equipped.
    await s.items.reload(d);
    expect((await s.items.row('capuz'))?.active).toBe(1);
    expect(await s.inventory.equipment(m)).toEqual(new Map());
  });

  it('removing an item file unequips it on reload', async () => {
    const { s, m, d } = await setup();
    await s.inventory.grant({ memberId: m, itemId: 'luva', source: 'staff' });
    await s.inventory.equip(m, 'luva', 'acessorio');
    writeFileSync(join(d[0] as string, 'a.yaml'), item('capuz'));
    expect(await s.items.reload(d)).toMatchObject({ unequipped: 1 });
    expect(await s.inventory.equipment(m)).toEqual(new Map());
    expect((await s.inventory.owned(m)).map((r) => r.itemId)).toEqual(['luva']);
  });

  it('the gear provider reaches other bots through ctx.read', async () => {
    const { s, m, tc } = await setup();
    await s.inventory.grant({ memberId: m, itemId: 'botas', source: 'staff' });
    await s.inventory.equip(m, 'botas', 'acessorio');
    expect(await tc.runtime.providers.readModels().gear.bonusOf(m)).toMatchObject({ atk: 2, spd: 1 });
  });
});
