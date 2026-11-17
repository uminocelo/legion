import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CEREBRO_CONTENT_DIR,
  CerebroRepo,
  cerebroConfigSchema,
  PowerCatalog,
  powerIds,
  readPowers,
} from '../src/index.js';
import { events, FIELDS, join, setupCerebro, USER } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const SHIPPED = `${CEREBRO_CONTENT_DIR}/powers.yaml`;
const tmpFile = (text: string) => {
  const dir = mkdtempSync(pjoin(tmpdir(), 'powers-'));
  const f = pjoin(dir, 'powers.yaml');
  writeFileSync(f, text);
  return f;
};
const repoOf = (tc: TestContext) => new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId);
const reply = (tc: TestContext, id: string) => tc.gateway.lastReply(id);
const selects = (tc: TestContext, id: string) =>
  (reply(tc, id)?.components ?? []).flat().filter((c) => c.type === 'select');

describe('power catalog', () => {
  it('ships 32 generic powers in 6 types that pass the canon filter', () => {
    const { powers, errors } = readPowers([SHIPPED]);
    expect(errors).toEqual([]);
    expect(powers).toHaveLength(32);
    expect(new Set(powers.map((p) => p.type)).size).toBe(6);
    expect(powers.every((p) => p.name.en)).toBe(true);
  });

  it('reports errors with item and field, refuses canon names, and overrides by id', () => {
    const bad = tmpFile(
      '- id: X\n  type: cosmic\n  name: { pt-BR: Magneto }\n  description: { pt-BR: ok ok }\n',
    );
    const res = readPowers([SHIPPED, bad]);
    expect(res.errors.join('\n')).toMatch(/item 1 \(X\) → id/);
    expect(res.errors.join('\n')).toMatch(/item 1 \(X\) → type/);
    expect(res.errors.join('\n')).toMatch(/name\.pt-BR: nome de personagem existente/);
    const over = tmpFile(
      '- id: voo\n  type: movement\n  name: { pt-BR: Planar }\n  description: { pt-BR: Plana no vento. }\n',
    );
    const ok = readPowers([SHIPPED, over]);
    expect(ok.errors).toEqual([]);
    expect(ok.powers.find((p) => p.id === 'voo')?.name['pt-BR']).toBe('Planar');
  });

  it('keeps the previous catalog when the server file is broken', () => {
    const cfg = cerebroConfigSchema.parse({});
    const cat = new PowerCatalog(cfg.powers.typeToArchetype, cfg.archetypes);
    const broken = tmpFile('- id: [');
    expect(cat.load([SHIPPED, broken]).errors.length).toBeGreaterThan(0);
    expect(cat.all()).toHaveLength(32);
    const over = tmpFile(
      '- id: voo\n  type: movement\n  name: { pt-BR: Planar }\n  description: { pt-BR: Plana no vento. }\n',
    );
    cat.load([SHIPPED, over]);
    expect(cat.get('voo')?.name['pt-BR']).toBe('Planar');
    cat.load([SHIPPED, broken]);
    expect(cat.get('voo')?.name['pt-BR']).toBe('Planar');
  });

  it('maps types to archetypes from the config and hides powers of disabled archetypes', () => {
    const cfg = cerebroConfigSchema.parse({
      archetypes: ['Telepata', 'Tanque'],
      powers: { typeToArchetype: { offensive: 'Tanque' } },
    });
    expect(cfg.powers.typeToArchetype).toMatchObject({
      psionic: 'Telepata',
      offensive: 'Tanque',
      movement: 'Velocista',
    });
    const cat = new PowerCatalog(cfg.powers.typeToArchetype, cfg.archetypes);
    cat.load([SHIPPED]);
    expect(new Set(cat.all().map((p) => p.type))).toEqual(new Set(['offensive', 'defensive', 'psionic']));
    const piro = cat.get('pirocinese');
    expect(piro && cat.archetypeOf(piro)).toBe('Tanque');
    expect(cat.get('voo')).toBeUndefined();
  });

  it('splits the catalog into menus of whole types with at most 25 options', () => {
    const cfg = cerebroConfigSchema.parse({});
    const cat = new PowerCatalog(cfg.powers.typeToArchetype, cfg.archetypes);
    cat.load([SHIPPED]);
    const groups = cat.groups();
    expect(groups.length).toBe(2);
    expect(groups.every((g) => g.length <= 25)).toBe(true);
    expect(groups.flat()).toHaveLength(32);
  });
});

async function toPowers(tc: TestContext, userId = USER) {
  await join(tc, userId);
  await tc.interact({ kind: 'component', userId, customId: 'cerebro:v1:start' });
  await tc.interact({ kind: 'component', userId, customId: 'cerebro:v1:rules' });
  return tc.interact({ kind: 'component', userId, customId: 'cerebro:v1:faction', values: ['xmen'] });
}
const pick = (tc: TestContext, customId: string, values: string[], userId = USER) =>
  tc.interact({ kind: 'component', userId, customId, values });

describe('registration with powers', () => {
  it('main power sets the archetype, secondaries are capped, and the sheet shows them', async () => {
    t = await setupCerebro();
    const f = await toPowers(t);
    expect(reply(t, f)?.embeds?.[0]?.title).toBe('🧬 Escolha seu poder principal');
    const menus = selects(t, f);
    expect(menus).toHaveLength(2);
    expect(menus.flatMap((m) => ('options' in m ? m.options : [])).length).toBe(32);

    const m = await pick(t, powerIds.main('r', 0), ['telecinese']);
    expect(reply(t, m)?.embeds?.[0]?.description).toMatch(/Telecinese\n\*\*Arquétipo:\*\* Telepata/);
    expect(
      selects(t, m)
        .flatMap((x) => ('options' in x ? x.options : []))
        .some((o) => o.value === 'telecinese'),
    ).toBe(false);
    await pick(t, powerIds.secondary('r', 0), ['pirocinese']);
    const s2 = await pick(t, powerIds.secondary('r', 1), ['voo']);
    expect(reply(t, s2)?.embeds?.[0]?.description).toMatch(/Secundários:\*\* Pirocinese, Voo/);
    const over = await pick(t, powerIds.secondary('r', 1), ['voo', 'portais']);
    expect(reply(t, over)?.content).toMatch(/no máximo 2/);

    const next = await t.interact({ kind: 'component', userId: USER, customId: powerIds.next('r') });
    expect(t.gateway.repliesTo(next)[0]?.kind).toBe('showModal');
    await t.interact({ kind: 'modal', userId: USER, customId: 'cerebro:v1:mutant', fields: FIELDS });
    const [created] = await events(t, 'player.created');
    expect(created).toMatchObject({ archetype: 'Telepata', faction: 'xmen' });
    expect(Object.keys(created).sort()).toEqual([
      'archetype',
      'codename',
      'discordUserId',
      'faction',
      'memberId',
      'mutantId',
    ]);

    const repo = repoOf(t);
    const member = await repo.memberByDiscordId(USER);
    const mutant = await repo.mutantByMemberId(member?.id ?? '');
    expect(await repo.powersOf(mutant?.id ?? '')).toEqual({
      main: 'telecinese',
      secondary: ['pirocinese', 'voo'],
    });
    expect(member?.pendingPowers).toBeNull();
    const prof = await t.interact({ kind: 'command', userId: USER, commandName: 'perfil' });
    const fields = reply(t, prof)?.embeds?.[0]?.fields ?? [];
    expect(fields.find((x) => x.name === 'Poderes')?.value).toBe('★ Telecinese · Pirocinese · Voo');
    expect(fields.find((x) => x.name === 'Descrição do poder')?.value).toBe(FIELDS.poder);
  });

  it('"Trocar poder principal" goes back; "Continuar" needs a main power; canon codenames are still refused', async () => {
    t = await setupCerebro();
    await toPowers(t);
    await pick(t, powerIds.main('r', 1), ['voo']);
    const back = await t.interact({ kind: 'component', userId: USER, customId: powerIds.back('r') });
    expect(reply(t, back)?.embeds?.[0]?.title).toBe('🧬 Escolha seu poder principal');
    const next = await t.interact({ kind: 'component', userId: USER, customId: powerIds.next('r') });
    expect(reply(t, next)?.embeds?.[0]?.title).toBe('🧬 Escolha seu poder principal');
    await pick(t, powerIds.main('r', 1), ['voo']);
    const canon = await t.interact({
      kind: 'modal',
      userId: USER,
      customId: 'cerebro:v1:mutant',
      fields: { ...FIELDS, codinome: 'Wolverine' },
    });
    expect(reply(t, canon)?.content).toMatch(/Wolverine/);
    const ok = await t.interact({
      kind: 'modal',
      userId: USER,
      customId: 'cerebro:v1:mutant',
      fields: FIELDS,
    });
    expect(reply(t, ok)?.embeds?.[0]?.title).toBe('✅ Mutante registrado!');
    const [created] = await events(t, 'player.created');
    expect(created).toMatchObject({ archetype: 'Velocista' });
  });

  it('with powers off, registration uses the archetype menu as before', async () => {
    t = await setupCerebro({ cerebro: { powers: { enabled: false } } });
    const f = await toPowers(t);
    expect(reply(t, f)?.components?.[0]?.[0]).toMatchObject({ customId: 'cerebro:v1:archetype' });
    const p = await t.interact({
      kind: 'command',
      userId: USER,
      commandName: 'mutante',
      subcommand: 'poderes',
    });
    expect(reply(t, p)?.content).toMatch(/desligado/);
  });
});

describe('/mutante poderes', () => {
  const cmd = (tc: TestContext) =>
    tc.interact({ kind: 'command', userId: USER, commandName: 'mutante', subcommand: 'poderes' });

  it('adds powers once without changing the archetype by default', async () => {
    t = await setupCerebro();
    await join(t);
    // Registered before US-11: archetype menu, no catalog powers.
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:start' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:rules' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:faction', values: ['xmen'] });
    await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:archetype',
      values: ['Elemental'],
    });
    await t.interact({ kind: 'modal', userId: USER, customId: 'cerebro:v1:mutant', fields: FIELDS });
    const repo = repoOf(t);
    const mutant = await repo.mutantByMemberId((await repo.memberByDiscordId(USER))?.id ?? '');
    expect(mutant?.archetype).toBe('Elemental');
    expect((await repo.powersOf(mutant?.id ?? '')).main).toBeNull();

    const open = await cmd(t);
    expect(reply(t, open)?.embeds?.[0]?.title).toBe('🧬 Escolha seu poder principal');
    const m = await pick(t, powerIds.main('e', 0), ['telepatia']);
    expect(reply(t, m)?.embeds?.[0]?.description).toMatch(/continua \*\*Elemental\*\*/);
    await pick(t, powerIds.secondary('e', 0), ['criocinese']);
    const save = await t.interact({ kind: 'component', userId: USER, customId: powerIds.next('e') });
    expect(reply(t, save)?.content).toMatch(
      /Poderes salvos: ★ Telepatia · Criocinese\. Arquétipo: \*\*Elemental\*\*/,
    );
    expect((await repo.mutantByMemberId(mutant?.memberId ?? ''))?.archetype).toBe('Elemental');
    expect(await repo.powersOf(mutant?.id ?? '')).toEqual({ main: 'telepatia', secondary: ['criocinese'] });

    const again = await cmd(t);
    expect(reply(t, again)?.content).toMatch(/já escolheu seus poderes: ★ Telepatia · Criocinese/);
    const stale = await t.interact({ kind: 'component', userId: USER, customId: powerIds.next('e') });
    expect(reply(t, stale)?.content).toMatch(/já escolheu/);
  });

  it('changes the archetype when staff allows it; unregistered members are refused', async () => {
    t = await setupCerebro({ cerebro: { powers: { allowArchetypeChange: true, maxSecondary: 0 } } });
    const no = await cmd(t);
    expect(reply(t, no)?.content).toMatch(/ainda não é um mutante registrado/);
    await join(t);
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:start' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:rules' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:faction', values: ['xmen'] });
    await t.interact({
      kind: 'component',
      userId: USER,
      customId: 'cerebro:v1:archetype',
      values: ['Elemental'],
    });
    await t.interact({ kind: 'modal', userId: USER, customId: 'cerebro:v1:mutant', fields: FIELDS });
    await cmd(t);
    const m = await pick(t, powerIds.main('e', 0), ['regeneracao']);
    expect(selects(t, m)).toHaveLength(0);
    const save = await t.interact({ kind: 'component', userId: USER, customId: powerIds.next('e') });
    expect(reply(t, save)?.content).toMatch(/Novo arquétipo: \*\*Tanque\*\*/);
    const repo = repoOf(t);
    expect((await repo.mutantByMemberId((await repo.memberByDiscordId(USER))?.id ?? ''))?.archetype).toBe(
      'Tanque',
    );
  });
});
