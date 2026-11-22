import { jarvis, jarvisServices, PACK_ORIGIN, PackInstaller } from '@legion/bot-jarvis';
import { isCanonName, type TestContext } from '@legion/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPackEnemyHooks,
  enemiesParserForPacks,
  PACK_ENEMY_ORIGIN,
  parseEnemiesYaml,
} from '../src/index.js';
import { servicesOf, setupUltron } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const CATEGORIES = ['geral', 'quadrinhos', 'rivals', 'vingadores', 'quarteto', 'cosmico', 'mistico'];

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

const enemy = (id: string, name = `Inimigo ${id}`) => ({
  id,
  name,
  tier: 'minion',
  minLevel: 1,
  base: { hp: 40, atk: 5, def: 4, spd: 6, foc: 3 },
  powerCooldownMax: 4,
  tauntKeys: [],
});

describe('pack enemy apply (ULTRON)', () => {
  it('installs a pack enemy with real apply, survives file sync, refuses file ids', async () => {
    t = await setupUltron();
    const us = servicesOf(t);
    const js = jarvisServices(t.ctxOf(jarvis));
    const hooks = createPackEnemyHooks(us.repo);
    const installer = new PackInstaller({
      repo: js.repo,
      categories: CATEGORIES,
      locale: 'pt-BR',
      isCanon: isCanonName,
      ...hooks,
    });

    const ok = await installer.apply(
      {
        id: 'pack-inimigos',
        name: { 'pt-BR': 'Pacote inimigos' },
        version: '1.0.0',
        author: 'Staff',
        missions: [mission('pack-m-enemy')],
        enemies: [enemy('pack-drone-x', 'Drone do Pacote')],
      },
      { source: 'bot' },
    );
    expect(ok).toMatchObject({ ok: true, action: 'install' });
    expect(await us.repo.template('pack-drone-x')).toMatchObject({
      id: 'pack-drone-x',
      name: 'Drone do Pacote',
    });
    const tpl = us.repo.t.ultronEnemyTemplates;
    const [stored] = await us.repo.db.orm.select().from(tpl).where(eq(tpl.id, 'pack-drone-x'));
    expect(stored).toMatchObject({ origin: PACK_ENEMY_ORIGIN, active: 1 });
    expect(await js.repo.mission('pack-m-enemy')).toMatchObject({ origin: PACK_ORIGIN });

    const beforeHash = stored?.contentHash;
    await us.encounters.loadContent();
    const [after] = await us.repo.db.orm.select().from(tpl).where(eq(tpl.id, 'pack-drone-x'));
    expect(after).toMatchObject({ origin: PACK_ENEMY_ORIGIN, contentHash: beforeHash, active: 1 });

    const fileRefuse = await installer.apply(
      {
        id: 'pack-file-clash',
        name: { 'pt-BR': 'Choque' },
        version: '1.0.0',
        author: 'Staff',
        enemies: [enemy('drone-vigia')],
      },
      { source: 'bot' },
    );
    expect(fileRefuse.ok).toBe(false);
    if (!fileRefuse.ok) expect(fileRefuse.errors.join()).toMatch(/arquivos/);
  });

  it('enemiesParserForPacks validates through parseEnemiesYaml', () => {
    const parse = enemiesParserForPacks(parseEnemiesYaml);
    const ok = parse([enemy('ok-drone')], 'enemies');
    expect(ok.errors).toEqual([]);
    expect(ok.enemies[0]?.id).toBe('ok-drone');
    const bad = parse([{ ...enemy('x'), name: 'Magneto' }], 'enemies');
    expect(bad.errors.join()).toMatch(/personagem/);
  });
});
