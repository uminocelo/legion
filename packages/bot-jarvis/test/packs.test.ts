import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isCanonName, type TestContext } from '@legion/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { enemiesParserFromYaml, PACK_ORIGIN, PackInstaller, readPacks, validatePack } from '../src/index.js';
import { addMember, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
const tmp: string[] = [];
afterEach(async () => {
  await t?.close();
  t = undefined;
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

const mission = (id: string) => ({
  id,
  kind: 'daily',
  title: { 'pt-BR': `Missão ${id}` },
  summary: { 'pt-BR': `Resumo da missão ${id}.` },
  start: 'a',
  scenes: {
    a: {
      text: { 'pt-BR': 'Início.' },
      choices: [
        { label: { 'pt-BR': 'Sim' }, next: 'b' },
        { label: { 'pt-BR': 'Não' }, next: 'c' },
      ],
    },
    b: { text: { 'pt-BR': 'Fim bom.' }, end: 'success' },
    c: { text: { 'pt-BR': 'Fim ruim.' }, end: 'failure' },
  },
});

const trivia = (id: string) => ({
  id,
  category: 'geral',
  difficulty: 'facil',
  question: `Pergunta ${id}?`,
  choices: ['a', 'b'],
  answer: 0,
  explanation: 'porque sim',
  source: `https://example.com/${id}`,
});

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slot: 'acessorio',
  name: { 'pt-BR': `Peça ${id}` },
  bonus: { atk: 1 },
  ...over,
});

const enemy = (id: string) => ({
  id,
  name: `Inimigo ${id}`,
  tier: 'minion',
  minLevel: 1,
  base: { hp: 40, atk: 5, def: 4, spd: 6, foc: 3 },
  powerCooldownMax: 4,
  tauntKeys: [],
});

const packDoc = (over: Record<string, unknown> = {}) => ({
  id: 'meu-pack',
  name: { 'pt-BR': 'Meu pacote', en: 'My pack' },
  version: '1.0.0',
  author: 'Staff',
  trivia: [trivia('pack-q1')],
  missions: [mission('pack-m1')],
  items: [item('pack-item-1')],
  ...over,
});

const dir = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'legion-packs-'));
  tmp.push(d);
  for (const [name, text] of Object.entries(files)) {
    const path = join(d, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return d;
};

describe('validatePack', () => {
  it('accepts a happy path with trivia, missions and items', () => {
    const r = validatePack(packDoc(), { isCanon: isCanonName, categories: ['geral'] });
    expect(r.errors).toEqual([]);
    expect(r.pack.trivia[0]?.id).toBe('pack-q1');
    expect(r.pack.missions[0]?.id).toBe('pack-m1');
    expect(r.pack.items[0]?.id).toBe('pack-item-1');
  });

  it('prefixes nested errors and fails the whole pack', () => {
    const bad = validatePack(
      packDoc({
        trivia: [{ ...trivia('bad'), answer: 9 }],
        items: [item('x', { name: { 'pt-BR': 'Wolverine' } })],
      }),
      { isCanon: isCanonName, categories: ['geral'] },
    );
    expect(bad.errors.some((e) => e.includes('trivia') && e.includes('answer'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('items') && e.includes('nome de personagem'))).toBe(true);
    expect(bad.pack.id).toBe('');
  });

  it('validates enemies through the injected parser', () => {
    const parseEnemies = (list: unknown[], label: string) => {
      const errors: string[] = [];
      const enemies: Array<{ id: string }> = [];
      for (const entry of list) {
        const id = (entry as { id?: string }).id;
        if (id === 'Magneto') errors.push(`${label} → nome canônico`);
        else if (id) enemies.push({ id });
      }
      return { enemies, errors };
    };
    const bad = validatePack(packDoc({ enemies: [enemy('Magneto')] }), {
      isCanon: isCanonName,
      categories: ['geral'],
      parseEnemies,
    });
    expect(bad.errors.join()).toMatch(/enemies/);
    const ok = validatePack(packDoc({ enemies: [enemy('drone-pack')] }), {
      isCanon: isCanonName,
      categories: ['geral'],
      parseEnemies,
    });
    expect(ok.errors).toEqual([]);
    expect(ok.pack.enemies[0]?.id).toBe('drone-pack');
  });
});

describe('readPacks', () => {
  it('loads valid packs and skips broken ones', () => {
    const root = dir({
      'bom/pack.yaml': stringify(packDoc({ id: 'pack-bom' })),
      'quebrado/pack.yaml': stringify(packDoc({ id: 'pack-bad', version: 'nope' })),
      'outro/pack.yaml': stringify(packDoc({ id: 'pack-outro', items: [item('pack-item-2')] })),
    });
    const { packs, errors } = readPacks(root, { categories: ['geral'] });
    expect(packs.map((p) => p.id).sort()).toEqual(['pack-bom', 'pack-outro']);
    expect(errors.some((e) => e.includes('pack-bad') || e.includes('quebrado') || e.includes('semver'))).toBe(
      true,
    );
  });
});

const CATEGORIES = ['geral', 'quadrinhos', 'rivals', 'vingadores', 'quarteto', 'cosmico', 'mistico'];

describe('PackInstaller', () => {
  async function setup() {
    t = await setupJarvis();
    const s = servicesOf(t);
    const installer = new PackInstaller({
      repo: s.repo,
      categories: CATEGORIES,
      locale: 'pt-BR',
      isCanon: isCanonName,
    });
    return { tc: t, s, installer };
  }

  it('installs a pack all-or-nothing and records ownership', async () => {
    const { s, installer } = await setup();
    const res = await installer.apply(packDoc(), { source: 'bot' });
    expect(res).toMatchObject({ ok: true, action: 'install', packId: 'meu-pack', version: '1.0.0' });
    expect(await s.repo.question('pack-q1')).toMatchObject({ origin: PACK_ORIGIN, active: 1 });
    expect(await s.repo.mission('pack-m1')).toMatchObject({ origin: PACK_ORIGIN, active: 1 });
    expect(await s.items.row('pack-item-1')).toMatchObject({ origin: PACK_ORIGIN, active: 1 });
    const packs = await installer.list();
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({ id: 'meu-pack', version: '1.0.0', source: 'bot' });
  });

  it('rolls back when apply fails mid-transaction', async () => {
    const { s } = await setup();
    const failing = new PackInstaller({
      repo: s.repo,
      categories: CATEGORIES,
      locale: 'pt-BR',
      isCanon: isCanonName,
      parseEnemies: (list) => ({
        enemies: list.map((e) => ({ id: String((e as { id: string }).id) })),
        errors: [],
      }),
      applyEnemies: async () => {
        throw new Error('falha simulada nos inimigos');
      },
    });
    const res = await failing.apply(packDoc({ enemies: [enemy('pack-e1')] }), { source: 'bot' });
    expect(res.ok).toBe(false);
    expect(await s.repo.question('pack-q1')).toBeNull();
    expect(await s.repo.mission('pack-m1')).toBeNull();
    expect(await s.items.row('pack-item-1')).toBeNull();
    expect(await failing.list()).toEqual([]);
  });

  it('upgrades differentially, refuses older versions, and removes', async () => {
    const { tc, s, installer } = await setup();
    const memberId = await addMember(tc, '111', 'xmen', 'Faísca');
    expect((await installer.apply(packDoc(), { source: 'folder' })).ok).toBe(true);

    // Equip the pack item so unequip is exercised on deactivate.
    await s.inventory.grant({
      memberId,
      itemId: 'pack-item-1',
      source: 'staff',
      grantedBy: 'staff',
    });
    await tc.db.orm.insert(s.repo.t.jarvisEquipment).values({
      memberId,
      slot: 'acessorio',
      itemId: 'pack-item-1',
      guildId: tc.gateway.guildId,
      equippedAt: s.repo.now(),
    });

    const older = await installer.apply(packDoc({ version: '0.9.0' }), { source: 'bot' });
    expect(older.ok).toBe(false);
    if (!older.ok) expect(older.errors.join()).toMatch(/mais antiga/);

    const same = await installer.apply(packDoc({ version: '1.0.0' }), { source: 'bot' });
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.errors.join()).toMatch(/já está instalada/);

    const upgraded = await installer.apply(
      packDoc({
        version: '1.1.0',
        trivia: [trivia('pack-q1'), trivia('pack-q2')],
        missions: [mission('pack-m2')],
        items: [item('pack-item-2')],
      }),
      { source: 'bot' },
    );
    expect(upgraded).toMatchObject({ ok: true, action: 'upgrade', version: '1.1.0' });
    expect(await s.repo.question('pack-q1')).toMatchObject({ active: 1 });
    expect(await s.repo.question('pack-q2')).toMatchObject({ active: 1, origin: PACK_ORIGIN });
    expect(await s.repo.mission('pack-m1')).toMatchObject({ active: 0 });
    expect(await s.repo.mission('pack-m2')).toMatchObject({ active: 1 });
    expect(await s.items.row('pack-item-1')).toMatchObject({ active: 0 });
    expect(await s.items.row('pack-item-2')).toMatchObject({ active: 1 });
    const eqRows = await tc.db.orm
      .select()
      .from(s.repo.t.jarvisEquipment)
      .where(eq(s.repo.t.jarvisEquipment.itemId, 'pack-item-1'));
    expect(eqRows).toEqual([]);
    // Inventory kept.
    const inv = await tc.db.orm
      .select()
      .from(s.repo.t.jarvisInventory)
      .where(eq(s.repo.t.jarvisInventory.itemId, 'pack-item-1'));
    expect(inv).toHaveLength(1);

    const removed = await installer.remove('meu-pack');
    expect(removed).toEqual({ ok: true });
    expect(await s.repo.question('pack-q2')).toMatchObject({ active: 0 });
    expect(await s.items.row('pack-item-2')).toMatchObject({ active: 0 });
    expect(await installer.list()).toEqual([]);

    expect(await installer.remove('nao-existe')).toMatchObject({ ok: false });
  });

  it('refuses shipped / file ids', async () => {
    const { s, installer } = await setup();
    // Seed a file-origin trivia id.
    await s.repo.db.orm.insert(s.repo.t.jarvisTriviaQuestions).values({
      id: 'file-q',
      locale: 'pt-BR',
      category: 'geral',
      difficulty: 'facil',
      question: 'x?',
      choices: '["a","b"]',
      answerIndex: 0,
      explanation: 'y',
      source: 'https://example.com',
      contentHash: 'abc',
      active: 1,
      updatedAt: s.repo.now(),
      origin: 'file',
    });
    const res = await installer.apply(packDoc({ trivia: [trivia('file-q')] }), { source: 'bot' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toMatch(/arquivos de conteúdo/);
  });
});

describe('enemiesParserFromYaml', () => {
  it('adapts a YAML-text parser to the list callback', () => {
    const parse = enemiesParserFromYaml((text, name) => {
      if (text.includes('Magneto')) return { enemies: [], errors: [`${name}: nome canônico`] };
      return { enemies: [{ id: 'drone-pack-x' }], errors: [] };
    });
    expect(parse([enemy('drone-pack-x')], 'enemies').enemies[0]?.id).toBe('drone-pack-x');
    expect(parse([{ id: 'Magneto' }], 'enemies').errors.join()).toMatch(/canônico/);
  });
});
