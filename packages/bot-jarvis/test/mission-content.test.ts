import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { missionDirs, readMissions, syncMissions } from '../src/index.js';
import { servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const ok = `
id: teste
kind: daily
title: Teste
summary: Uma missão de teste
start: a
scenes:
  a:
    text: Início
    choices:
      - { label: Sim, next: b }
      - { label: Não, next: c }
  b: { text: Fim bom, end: success }
  c: { text: Fim ruim, end: failure }
`;

function dir(files: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), 'missions-'));
  mkdirSync(join(d, 'missions'));
  for (const [f, c] of Object.entries(files)) writeFileSync(join(d, 'missions', f), c);
  return d;
}

describe('mission content', () => {
  it('ships 4 valid missions, 2 with a fight, in pt-BR and en', () => {
    const r = readMissions(missionDirs('/nonexistent'));
    expect(r.errors).toEqual([]);
    expect(r.missions.map((m) => m.id).sort()).toEqual([
      'fabrica-silenciosa',
      'patrulha-noturna',
      'primeiro-contato',
      'sinal-fantasma',
    ]);
    expect(r.missions.filter((m) => Object.values(m.scenes).some((s) => s.combat))).toHaveLength(2);
    for (const m of r.missions)
      for (const s of Object.values(m.scenes)) expect(typeof s.text === 'object' && s.text.en).toBeTruthy();
  });

  it('gives readable errors for bad YAML, broken links, cycles, canon names and mixed scenes', () => {
    const d = dir({
      'a.yaml': 'id: [unclosed',
      'b.yaml': ok.replace('next: c', 'next: zz').replace('id: teste', 'id: b-link'),
      'c.yaml': ok
        .replace('id: teste', 'id: c-cycle')
        .replace('{ label: Não, next: c }', '{ label: Não, next: a }'),
      'd.yaml': ok.replace('title: Teste', 'title: Wolverine e eu').replace('id: teste', 'id: d-canon'),
      'e.yaml': ok
        .replace('b: { text: Fim bom, end: success }', 'b: { text: Fim bom, end: success, choices: [] }')
        .replace('id: teste', 'id: e-mixed'),
    });
    const r = readMissions([join(d, 'missions')]);
    expect(r.missions).toEqual([]);
    const all = r.errors.join('\n');
    expect(all).toMatch(/a\.yaml \(linha \d+\): YAML inválido/);
    expect(all).toMatch(/b\.yaml → scenes\.a: leva a "zz", que não existe/);
    expect(all).toMatch(/c\.yaml → scenes\.a: ciclo: a → a/);
    expect(all).toMatch(/d\.yaml → title: nome de personagem existente/);
    expect(all).toMatch(/e\.yaml → scenes\.b/);
  });

  it('a server file overrides a shipped mission by id; an invalid one keeps the previous content', async () => {
    t = await setupJarvis();
    const s = servicesOf(t);
    const good = dir({
      'patrulha.yaml': ok
        .replace('id: teste', 'id: patrulha-noturna')
        .replace('title: Teste', 'title: Minha patrulha'),
    });
    await s.missions.reload(missionDirs(good));
    expect(JSON.parse((await s.repo.mission('patrulha-noturna'))?.definition ?? '{}').title).toBe(
      'Minha patrulha',
    );

    const bad = dir({ 'patrulha.yaml': 'id: patrulha-noturna\nkind: nope' });
    const res = await syncMissions(s.repo, readMissions([join(good, 'missions'), join(bad, 'missions')]));
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.deactivated).toBe(0);
    const row = await s.repo.mission('patrulha-noturna');
    expect(row?.active).toBe(1);
    expect(JSON.parse(row?.definition ?? '{}').title).toBe('Minha patrulha');
    // Gone from valid files → inactive (never deleted).
    const r2 = await syncMissions(s.repo, readMissions([join(dir({ 'x.yaml': ok }), 'missions')]));
    expect(r2.deactivated).toBe(4);
    expect((await s.repo.mission('primeiro-contato'))?.active).toBe(0);
  });
});
