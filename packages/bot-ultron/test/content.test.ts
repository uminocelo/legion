import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enemyFiles, readEnemies } from '../src/content.js';
import { addMember, servicesOf, setupUltron } from './helpers.js';

const dir = () => mkdtempSync(join(tmpdir(), 'ultron-'));
const shipped = enemyFiles('/nope')[0] as string;

describe('enemy content', () => {
  it('ships at least 4 minions, 2 elites and 2 bosses, all valid and original', () => {
    const { enemies, errors } = readEnemies([shipped]);
    expect(errors).toEqual([]);
    const n = (tier: string) => enemies.filter((e) => e.tier === tier).length;
    expect(n('minion')).toBeGreaterThanOrEqual(4);
    expect(n('elite')).toBeGreaterThanOrEqual(2);
    expect(n('boss')).toBeGreaterThanOrEqual(2);
  });

  it('rejects canon names, bad stats and broken YAML with readable errors', () => {
    const d = dir();
    writeFileSync(
      join(d, 'enemies.yaml'),
      `- { id: vilao, name: "Magneto", tier: minion, minLevel: 1, base: { hp: 10, atk: 1, def: 1, spd: 1, foc: 1 }, powerCooldownMax: 3 }
- { id: zero, name: "Robô Zero", tier: minion, minLevel: 1, base: { hp: 0, atk: 1, def: 1, spd: 1, foc: 1 }, powerCooldownMax: 3 }
`,
    );
    const { errors } = readEnemies([shipped, join(d, 'enemies.yaml')]);
    expect(errors).toEqual([
      expect.stringContaining('(vilao) → name: nome de personagem existente'),
      expect.stringContaining('(zero) → base.hp: hp deve ser ≥ 1'),
    ]);
    writeFileSync(join(d, 'enemies.yaml'), 'id: [');
    expect(readEnemies([join(d, 'enemies.yaml')]).errors[0]).toMatch(/YAML inválido/);
  });

  it('server files override by id; an invalid file keeps the previous enemies in the DB', async () => {
    const t = await setupUltron();
    const s = servicesOf(t);
    const before = await s.repo.templates();
    expect(before.length).toBeGreaterThanOrEqual(8);
    const d = dir();
    writeFileSync(
      join(d, 'enemies.yaml'),
      `- { id: drone-vigia, name: "Drone Vigia Mk II", tier: minion, minLevel: 1, base: { hp: 70, atk: 9, def: 5, spd: 9, foc: 6 }, powerCooldownMax: 4 }\n`,
    );
    await s.encounters.loadContent([shipped, join(d, 'enemies.yaml')]);
    expect((await s.repo.template('drone-vigia'))?.name).toBe('Drone Vigia Mk II');
    writeFileSync(
      join(d, 'enemies.yaml'),
      `- { id: xx, name: "Wolverine", tier: minion, minLevel: 1, base: { hp: 1, atk: 1, def: 1, spd: 1, foc: 1 }, powerCooldownMax: 3 }\n`,
    );
    const r = await s.encounters.loadContent([shipped, join(d, 'enemies.yaml')]);
    expect(r.errors.length).toBe(1);
    expect((await s.repo.template('drone-vigia'))?.name).toBe('Drone Vigia Mk II');
    await addMember(t, '111');
  });
});
