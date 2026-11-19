import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import { ORIGINS, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CEREBRO_CONTENT_DIR,
  CerebroRepo,
  cerebro,
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
const catalog = (cfg = cerebroConfigSchema.parse({}), files = [SHIPPED]) => {
  const cat = new PowerCatalog(cfg.powers.typeToArchetype, cfg.archetypes);
  cat.load(files);
  return cat;
};
const repoOf = (tc: TestContext) => new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId);
const reply = (tc: TestContext, id: string) => tc.gateway.lastReply(id);
const optionValues = (tc: TestContext, id: string) =>
  (reply(tc, id)?.components ?? [])
    .flat()
    .flatMap((c) => (c.type === 'select' ? c.options.map((o) => o.value) : []));
const click = (tc: TestContext, customId: string, values?: string[], userId = USER) =>
  tc.interact({ kind: 'component', userId, customId, ...(values ? { values } : {}) });

async function toOriginMenu(tc: TestContext, userId = USER) {
  await join(tc, userId);
  await click(tc, 'cerebro:v1:start', undefined, userId);
  return click(tc, 'cerebro:v1:rules', undefined, userId);
}
/** Registers with the given origin and powers (main first) through the real flow. */
async function registerAs(
  tc: TestContext,
  origin: string,
  powers: string[],
  userId = USER,
  codinome?: string,
) {
  await toOriginMenu(tc, userId);
  await click(tc, 'cerebro:v1:origin', [origin], userId);
  const [main, ...secondary] = powers;
  const cat = catalog();
  const mainGroup = cat.groups([], origin).findIndex((g) => g.some((p) => p.id === main));
  await click(tc, powerIds.main('r', mainGroup), [main ?? ''], userId);
  for (const id of secondary) {
    const group = cat.groups([main ?? ''], origin).findIndex((g) => g.some((p) => p.id === id));
    await click(tc, powerIds.secondary('r', group), [id], userId);
  }
  await click(tc, powerIds.next('r'), undefined, userId);
  return tc.interact({
    kind: 'modal',
    userId,
    customId: 'cerebro:v1:mutant',
    fields: { ...FIELDS, ...(codinome ? { codinome } : {}) },
  });
}
const heroOf = async (tc: TestContext, userId = USER) => {
  const repo = repoOf(tc);
  const member = await repo.memberByDiscordId(userId);
  const mutant = await repo.mutantByMemberId(member?.id ?? '');
  return { repo, member, mutant, powers: mutant ? await repo.powersOf(mutant.id) : null };
};

describe('cerebro.origins and cerebro.teams config', () => {
  it('defaults to the 7 origins in menu order, with emoji, and startFaction independent', () => {
    const cfg = cerebroConfigSchema.parse({});
    expect(cfg.origins.map((o) => `${o.emoji} ${o.key}`)).toEqual([
      '🧬 mutante',
      '💠 inumano',
      '⚗️ ciencia',
      '🤖 tecnologia',
      '🔮 mistico',
      '🌌 cosmico',
      '🥋 treinado',
    ]);
    expect(cfg.teams.startFaction).toBe('independent');
  });

  it('keeps the server order and emoji, and fills a missing emoji', () => {
    const cfg = cerebroConfigSchema.parse({
      origins: [{ key: 'treinado', emoji: '🥊' }, { key: 'mutante' }],
    });
    expect(cfg.origins).toEqual([
      { key: 'treinado', emoji: '🥊' },
      { key: 'mutante', emoji: '🧬' },
    ]);
  });

  it('gives readable errors for unknown and repeated keys', () => {
    const unknown = cerebroConfigSchema.safeParse({ origins: [{ key: 'alienigena' }] });
    expect(unknown.success).toBe(false);
    expect(unknown.error?.issues[0]?.message).toMatch(/origem desconhecida; use uma de: mutante, inumano/);
    const dup = cerebroConfigSchema.safeParse({ origins: [{ key: 'mutante' }, { key: 'mutante' }] });
    expect(dup.error?.issues.map((i) => i.message)).toContain('origem repetida: mutante');
  });
});

describe('powers by origin', () => {
  it('a power without origins is open to every origin; a tagged one only to its origins', () => {
    const open = tmpFile(
      '- id: brilho-intenso\n  type: utility\n  name: { pt-BR: Brilho intenso }\n  description: { pt-BR: Ofusca quem olha. }\n',
    );
    const cat = catalog(undefined, [SHIPPED, open]);
    for (const o of ORIGINS) expect(cat.get('brilho-intenso', o)).toBeDefined();
    expect(cat.get('armadura-de-combate', 'tecnologia')).toBeDefined();
    expect(cat.get('armadura-de-combate', 'mutante')).toBeUndefined();
    expect(cat.get('telepatia', 'treinado')).toBeUndefined();
    expect(cat.get('telepatia')).toBeDefined(); // no origin given = whole catalog
  });

  it('every shipped origin has powers of at least 2 types; Treinado has no superpowers', () => {
    const cat = catalog();
    for (const o of ORIGINS)
      expect(new Set(cat.forOrigin(o).map((p) => p.type)).size).toBeGreaterThanOrEqual(2);
    expect(cat.forOrigin('treinado').map((p) => p.type)).not.toContain('psionic');
    expect(cat.emptyOrigins(ORIGINS)).toEqual([]);
  });

  it('refuses an unknown origin in a power file', () => {
    const bad = tmpFile(
      '- id: brilho-intenso\n  type: utility\n  origins: [alien]\n  name: { pt-BR: Brilho intenso }\n  description: { pt-BR: Ofusca quem olha. }\n',
    );
    expect(readPowers([SHIPPED, bad]).errors.join('\n')).toMatch(
      /\(brilho-intenso\) → origins\.0: origem desconhecida/,
    );
  });

  it('an origin with no powers is ❌ in the doctor and hidden from registration', async () => {
    t = await setupCerebro({ cerebro: { archetypes: ['Telepata'] } }); // only psionic powers stay
    const check = cerebro.doctorChecks?.(t.ctxOf(cerebro)).find((c) => c.id === 'cerebro.powers');
    const res = await check?.run();
    expect(res?.status).toBe('fail');
    expect(res?.message).toMatch(/tecnologia, treinado/);
    const menu = await toOriginMenu(t);
    expect(optionValues(t, menu)).toEqual(['mutante', 'inumano', 'ciencia', 'mistico', 'cosmico']);
    const hidden = await click(t, 'cerebro:v1:origin', ['treinado']);
    expect(reply(t, hidden)?.content).toBe('Essa opção não está disponível. Tente de novo.');
    expect((await repoOf(t).memberByDiscordId(USER))?.onboardingStep).toBe('rules_accepted');
  });

  it('the doctor is ok with the shipped catalog', async () => {
    t = await setupCerebro();
    const check = cerebro.doctorChecks?.(t.ctxOf(cerebro)).find((c) => c.id === 'cerebro.powers');
    expect(await check?.run()).toMatchObject({
      status: 'ok',
      message: '46 poderes; todas as origens têm poderes',
    });
  });
});

describe('registration with an origin', () => {
  it.each(ORIGINS)(
    '%s: only allowed powers are offered and the hero is saved with the origin',
    async (origin) => {
      t = await setupCerebro();
      await toOriginMenu(t);
      const menu = await click(t, 'cerebro:v1:origin', [origin]);
      const offered = optionValues(t, menu);
      const allowed = catalog()
        .forOrigin(origin)
        .map((p) => p.id);
      expect(new Set(offered)).toEqual(new Set(allowed));
      const main = catalog().forOrigin(origin)[0];
      const group = catalog()
        .groups([], origin)
        .findIndex((g) => g.some((p) => p.id === main?.id));
      await click(t, powerIds.main('r', group), [main?.id ?? '']);
      await click(t, powerIds.next('r'));
      const done = await t.interact({
        kind: 'modal',
        userId: USER,
        customId: 'cerebro:v1:mutant',
        fields: FIELDS,
      });
      expect(reply(t, done)?.embeds?.[0]?.title).toBe('✅ Herói registrado!');
      const { mutant, powers } = await heroOf(t);
      expect(mutant).toMatchObject({ originType: origin, originRechoice: 0 });
      if (main) expect(mutant?.archetype).toBe(catalog().archetypeOf(main));
      expect(powers?.main).toBe(main?.id);
      const [created] = await events(t, 'player.created');
      expect(created).toMatchObject({ originType: origin, faction: 'independent' });
    },
  );

  it('refuses a power from another origin, on the menu and at the form', async () => {
    t = await setupCerebro();
    await toOriginMenu(t);
    await click(t, 'cerebro:v1:origin', ['treinado']);
    const wrong = await click(t, powerIds.main('r', 0), ['telepatia']);
    expect(reply(t, wrong)?.content).toBe('Esse poder não está disponível para a sua origem. Escolha outro.');
    const { repo, member } = await heroOf(t);
    expect(member?.pendingPowers).toBeNull();
    // A forged or stale choice in the DB is caught again when the form is sent.
    await repo.updateMember(member?.id ?? '', {
      pendingPowers: JSON.stringify({ main: 'telepatia', secondary: [] }),
      pendingArchetype: 'Telepata',
    });
    const sent = await t.interact({
      kind: 'modal',
      userId: USER,
      customId: 'cerebro:v1:mutant',
      fields: FIELDS,
    });
    expect(reply(t, sent)?.content).toBe('Esse poder não está disponível para a sua origem. Escolha outro.');
    expect(await events(t, 'player.created')).toHaveLength(0);
    expect((await repo.memberByDiscordId(USER))?.pendingPowers).toBeNull();
  });

  it('"Trocar origem" goes back to the origin menu and clears the picks', async () => {
    t = await setupCerebro();
    await toOriginMenu(t);
    await click(t, 'cerebro:v1:origin', ['mutante']);
    await click(t, powerIds.main('r', 0), ['telecinese']);
    const back = await click(t, 'cerebro:v1:oback');
    expect(reply(t, back)?.components?.[0]?.[0]).toMatchObject({ customId: 'cerebro:v1:origin' });
    expect((await heroOf(t)).member).toMatchObject({ onboardingStep: 'rules_accepted', pendingPowers: null });
    const tech = await click(t, 'cerebro:v1:origin', ['tecnologia']);
    expect(optionValues(t, tech)).toContain('armadura-de-combate');
    expect(optionValues(t, tech)).not.toContain('telecinese');
  });

  it('a member left at the old faction step picks an origin and keeps the faction', async () => {
    t = await setupCerebro();
    await join(t);
    const repo = repoOf(t);
    const row = await repo.memberByDiscordId(USER);
    // As restored from a v0.8.1 backup without running the migration's backfill.
    await repo.updateMember(row?.id ?? '', { onboardingStep: 'faction_chosen', faction: 'brotherhood' });
    const s = await click(t, 'cerebro:v1:start');
    expect(reply(t, s)?.components?.[0]?.[0]).toMatchObject({ customId: 'cerebro:v1:origin' });
    await click(t, 'cerebro:v1:origin', ['inumano']);
    await click(t, powerIds.main('r', 0), ['rajada-optica']);
    await t.interact({ kind: 'modal', userId: USER, customId: 'cerebro:v1:mutant', fields: FIELDS });
    expect((await heroOf(t)).member).toMatchObject({ onboardingStep: 'registered', faction: 'brotherhood' });
    expect(t.gateway.memberRoleNames(USER)).toContain('Irmandade');
  });

  it('starts on cerebro.teams.startFaction, or the first faction when the server does not have it', async () => {
    t = await setupCerebro({ cerebro: { teams: { startFaction: 'xmen' } } });
    await registerAs(t, 'mutante', ['telecinese']);
    expect((await heroOf(t)).member?.faction).toBe('xmen');
    await t.close();
    t = await setupCerebro({
      factions: [{ key: 'brotherhood', roleKey: 'faction_brotherhood', emoji: '🔴' }],
    });
    await registerAs(t, 'mutante', ['telecinese']);
    expect((await heroOf(t)).member?.faction).toBe('brotherhood');
  });

  it('speaks English on an English server', async () => {
    t = await setupCerebro({ locale: 'en' });
    const menu = await toOriginMenu(t);
    const msg = reply(t, menu);
    expect(msg?.embeds?.[0]?.title).toBe('🌟 Choose your origin');
    const select = msg?.components?.[0]?.[0];
    expect(select?.type === 'select' && select.options.map((o) => o.label)).toEqual([
      'Mutant',
      'Inhuman',
      'Science',
      'Technology',
      'Mystic',
      'Cosmic',
      'Trained',
    ]);
  });

  it('snapshots of the origin menu, the welcome card and the public registry card', async () => {
    t = await setupCerebro();
    const menu = await toOriginMenu(t);
    expect(reply(t, menu)).toMatchSnapshot('origin menu');
    expect(t.gateway.messages.find((m) => m.channelId === '300000000000000001')?.msg).toMatchSnapshot(
      'welcome',
    );
    await click(t, 'cerebro:v1:origin', ['tecnologia']);
    await click(t, powerIds.main('r', 0), ['canhao-de-plasma']);
    await t.interact({ kind: 'modal', userId: USER, customId: 'cerebro:v1:mutant', fields: FIELDS });
    expect(t.gateway.messages.find((m) => m.channelId === '300000000000000003')?.msg).toMatchSnapshot(
      'registry card',
    );
    const card = await t.interact({ kind: 'command', userId: USER, commandName: 'perfil' });
    expect(reply(t, card)?.embeds?.[0]).toMatchSnapshot('profile embed');
  });
});

describe('/heroi', () => {
  it('lists ficha, poderes and origem, and there is no /mutante alias', async () => {
    t = await setupCerebro();
    const defs = cerebro.commands?.(t.ctxOf(cerebro)) ?? [];
    const sub = (name: string) =>
      (defs.find((d) => d.name === name)?.json.options as { name: string }[] | undefined)?.map((o) => o.name);
    expect(sub('heroi')).toEqual(['ficha', 'poderes', 'origem']);
    expect(defs.map((d) => d.name)).not.toContain('mutante');
    await registerAs(t, 'mutante', ['telecinese']);
    const p = await t.interact({
      kind: 'command',
      userId: USER,
      commandName: 'heroi',
      subcommand: 'poderes',
    });
    expect(reply(t, p)?.content).toBe(
      'Você já escolheu seus poderes: ★ Telecinese. Peça à staff se precisar trocar.',
    );
    const o = await t.interact({ kind: 'command', userId: USER, commandName: 'heroi', subcommand: 'origem' });
    expect(reply(t, o)?.content).toMatch(/^A troca de origem é só para heróis registrados antes/);
    const f = await t.interact({ kind: 'command', userId: USER, commandName: 'heroi', subcommand: 'ficha' });
    expect(reply(t, f)?.embeds?.[0]?.fields?.[0]).toEqual({
      name: 'Origem',
      value: '🧬 Mutante',
      inline: true,
    });
  });
});

describe('/heroi origem (one-time change for heroes from before origins)', () => {
  /** A hero as the migration leaves them: Mutante with the change still open. */
  async function legacyHero(tc: TestContext, powers = ['telecinese', 'voo']) {
    await registerAs(tc, 'mutante', powers);
    const { repo, mutant } = await heroOf(tc);
    await repo.updateMutant(mutant?.id ?? '', { originRechoice: 1 });
  }
  const origem = (tc: TestContext) =>
    tc.interact({ kind: 'command', userId: USER, commandName: 'heroi', subcommand: 'origem' });

  it('keeps the powers when they fit, clears the flag, and a second try is refused', async () => {
    t = await setupCerebro();
    await legacyHero(t);
    const open = await origem(t);
    expect(reply(t, open)?.content).toBe('Origem atual: **🧬 Mutante**');
    expect(reply(t, open)?.components?.[0]?.[0]).toMatchObject({ customId: 'cerebro:v1:rorigin' });
    const done = await click(t, 'cerebro:v1:rorigin', ['inumano']);
    expect(reply(t, done)?.content).toBe(
      '✅ Origem salva: **💠 Inumano**. Seus poderes continuam os mesmos.',
    );
    const { mutant, powers } = await heroOf(t);
    expect(mutant).toMatchObject({ originType: 'inumano', originRechoice: 0, archetype: 'Telepata' });
    expect(powers).toEqual({ main: 'telecinese', secondary: ['voo'] });
    const again = await origem(t);
    expect(reply(t, again)?.content).toMatch(/^A troca de origem é só para heróis registrados antes/);
    const stale = await click(t, 'cerebro:v1:rorigin', ['cosmico']);
    expect(reply(t, stale)?.content).toMatch(/^A troca de origem é só/);
    expect((await heroOf(t)).mutant?.originType).toBe('inumano');
  });

  it('opens the picker when powers do not fit; cancel changes nothing; finishing replaces them', async () => {
    t = await setupCerebro();
    await legacyHero(t);
    await origem(t);
    const pick = await click(t, 'cerebro:v1:rorigin', ['treinado']);
    expect(reply(t, pick)?.content).toBe(
      'Alguns poderes não combinam com **🥋 Treinado**. Escolha seus poderes de novo (ou cancele para manter tudo).',
    );
    expect(optionValues(t, pick)).not.toContain('telecinese');
    expect(optionValues(t, pick)).toContain('artes-marciais');
    const cancel = await click(t, 'cerebro:v1:rcancel');
    expect(reply(t, cancel)?.content).toBe('Nada mudou. Você ainda pode usar `/heroi origem` depois.');
    let hero = await heroOf(t);
    expect(hero.mutant).toMatchObject({ originType: 'mutante', originRechoice: 1 });
    expect(hero.powers).toEqual({ main: 'telecinese', secondary: ['voo'] });
    expect(hero.member).toMatchObject({ pendingOrigin: null, pendingPowers: null });
    // A picker button after cancelling does nothing.
    const late = await click(t, powerIds.next('o'));
    expect(reply(t, late)?.content).toMatch(/^A troca de origem é só/);

    await origem(t);
    await click(t, 'cerebro:v1:rorigin', ['treinado']);
    await click(t, powerIds.main('o', 0), ['artes-marciais']);
    const save = await click(t, powerIds.next('o'));
    expect(reply(t, save)?.content).toBe('✅ Origem salva: **🥋 Treinado**. Poderes: ★ Artes marciais.');
    hero = await heroOf(t);
    expect(hero.mutant).toMatchObject({ originType: 'treinado', originRechoice: 0, archetype: 'Telepata' });
    expect(hero.powers).toEqual({ main: 'artes-marciais', secondary: [] });
    expect(hero.member).toMatchObject({ pendingOrigin: null, pendingPowers: null });
  });

  it('choosing Mutante again also uses up the change', async () => {
    t = await setupCerebro();
    await legacyHero(t);
    await origem(t);
    await click(t, 'cerebro:v1:rorigin', ['mutante']);
    expect((await heroOf(t)).mutant).toMatchObject({ originType: 'mutante', originRechoice: 0 });
  });

  it('heroes registered with an origin cannot use it', async () => {
    t = await setupCerebro();
    await registerAs(t, 'cosmico', ['telecinese']);
    const r = await origem(t);
    expect(reply(t, r)?.content).toMatch(/^A troca de origem é só para heróis registrados antes/);
  });

  it('hints on /perfil and /heroi while the change is open, and stops after', async () => {
    t = await setupCerebro();
    await legacyHero(t);
    const hint =
      '💡 Novidade: agora todo herói tem uma origem. Você pode escolher a sua uma vez com `/heroi origem`.';
    const p1 = await t.interact({ kind: 'command', userId: USER, commandName: 'perfil' });
    expect(reply(t, p1)?.content).toBe(hint);
    const h1 = await t.interact({
      kind: 'command',
      userId: USER,
      commandName: 'heroi',
      subcommand: 'poderes',
    });
    expect(reply(t, h1)?.content).toContain(hint);
    const other = '400000000000000002';
    await join(t, other);
    const seen = await t.interact({
      kind: 'command',
      userId: other,
      commandName: 'perfil',
      options: { membro: USER },
    });
    expect(reply(t, seen)?.content).toBeUndefined(); // only the hero themself sees it
    await origem(t);
    await click(t, 'cerebro:v1:rorigin', ['mutante']);
    const p2 = await t.interact({ kind: 'command', userId: USER, commandName: 'perfil' });
    expect(reply(t, p2)?.content).toBeUndefined();
  });
});
