import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cerebro } from '@legion/bot-cerebro';
import { jarvis, jarvisServices, parseMissionYaml } from '@legion/bot-jarvis';
import { sentinel } from '@legion/bot-sentinel';
import { ultron, ultronServices } from '@legion/bot-ultron';
import { createTestContext, isCanonName, parseItemsYaml, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import * as enemies from '../editor/enemy-model.js';
import * as items from '../editor/item-model.js';
import * as missions from '../editor/mission-model.js';
import * as packs from '../editor/pack-model.js';
import { store } from '../editor/shared.js';
import * as trivia from '../editor/trivia-model.js';
// @ts-expect-error plain ESM script without types
import { bundleEditors } from '../scripts/build.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const STAFF = '900';
let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** Attaches `text` to the staff import command, then clicks Publicar. Returns the final reply text. */
async function importAndPublish(
  tc: TestContext,
  command: string,
  subcommand: string,
  text: string,
  name: string,
) {
  const url = `https://cdn.discordapp.com/attachments/1/2/${name}`;
  tc.gateway.cdn.set(url, text);
  const id = await tc.interact({
    kind: 'command',
    userId: STAFF,
    isGuildOwner: true,
    commandName: command,
    subcommand,
    attachments: { arquivo: { url, name, size: Buffer.byteLength(text), contentType: 'text/yaml' } },
  });
  const preview = tc.gateway.lastReply(id);
  const publish = (preview?.components?.[0] ?? [])
    .map((b) => ('customId' in b ? (b.customId ?? '') : ''))
    .find((c) => c.includes('publish'));
  if (!publish) return preview?.content ?? '';
  const done = await tc.interact({ kind: 'component', userId: STAFF, isGuildOwner: true, customId: publish });
  return tc.gateway.lastReply(done)?.content ?? '';
}

const question = (drafts: trivia.TriviaDraft[] = []): trivia.TriviaDraft => ({
  ...trivia.emptyQuestion(drafts),
  question: 'Qual é a cor do uniforme de treino?',
  choices: ['Azul', '', 'Amarelo', 'Preto'],
  answer: 2,
  explanation: 'O uniforme de treino é amarelo.',
  source: 'Manual da escola (2026)',
});

describe('trivia editor', () => {
  it('writes a file /jarvis trivia importar accepts and publishes', async () => {
    const first = question();
    const drafts = [first, { ...question([first]), locale: 'en' as const, question: 'What colour is it?' }];
    const yaml = trivia.toYaml(drafts);
    expect(trivia.validate(yaml, trivia.DEFAULT_CATEGORIES)).toEqual([]);
    // The empty alternative is dropped and the right answer follows it.
    expect(trivia.toItems(drafts)[0]).toMatchObject({ choices: ['Azul', 'Amarelo', 'Preto'], answer: 1 });

    t = await createTestContext({ bots: [cerebro, jarvis] });
    expect(await importAndPublish(t, 'jarvis', 'trivia importar', yaml, trivia.TRIVIA_FILE)).toMatch(
      /Perguntas publicadas: 2 nova\(s\)/,
    );
    const saved = await jarvisServices(t.ctxOf(jarvis)).repo.question(first.id);
    expect(saved).toMatchObject({ question: first.question, answerIndex: 1, active: 1 });
  });

  it('reports problems in pt-BR, like the bot does', () => {
    const d = {
      ...question(),
      question: 'Oi?',
      choices: ['Sim', 'Sim', '', ''],
      answer: 3,
      category: 'culinaria',
    };
    const errors = trivia.validate(trivia.toYaml([d]), trivia.DEFAULT_CATEGORIES);
    expect(errors.join('\n')).toContain('question: muito curto (mínimo 5 caracteres)');
    expect(errors.join('\n')).toContain('answer: muito pequeno (mínimo 0)');
    expect(errors.join('\n')).toContain('choices: as alternativas precisam ser diferentes');
    const cat = trivia.validate(trivia.toYaml([{ ...question(), category: 'culinaria' }]), ['geral']);
    expect(cat).toEqual([
      'perguntas.yaml → item 1 (meu-servidor-0001) → category: "culinaria" não está em jarvis.trivia.categories (geral)',
    ]);
    expect(trivia.validate(trivia.toYaml([]), ['geral'])).toEqual(['perguntas.yaml: nenhuma pergunta']);
  });

  it('writes optional squad and omits it when empty', () => {
    const d = question();
    expect(trivia.toYaml([d])).not.toMatch(/\bsquad\b/);
    d.squad = '  Alfa  ';
    const yaml = trivia.toYaml([d]);
    expect(yaml).toMatch(/^ {2}squad: Alfa$/m);
    expect(trivia.fromYaml(yaml)[0]).toMatchObject({ squad: 'Alfa' });
    expect(trivia.validate(yaml, trivia.DEFAULT_CATEGORIES)).toEqual([]);
    d.squad = 'x'.repeat(33);
    expect(trivia.validate(trivia.toYaml([d]), trivia.DEFAULT_CATEGORIES).join('\n')).toMatch(/squad/);
  });

  it('opens the shipped questions and saves them back unchanged in meaning', () => {
    const text = readFileSync(join(ROOT, 'packages/bot-jarvis/content/trivia/pt-BR.yaml'), 'utf8');
    const drafts = trivia.fromYaml(text);
    expect(drafts).toHaveLength(118);
    const yaml = trivia.toYaml(drafts);
    expect(trivia.validate(yaml, trivia.DEFAULT_CATEGORIES)).toEqual([]);
    expect(trivia.fromYaml(yaml)).toEqual(drafts);
    expect(() => trivia.fromYaml('id: not-a-list')).toThrow(/lista de perguntas/);
  });
});

describe('item editor', () => {
  const SHIPPED = join(ROOT, 'packages/bot-jarvis/content/items/itens.yaml');

  it('round-trips the shipped items', () => {
    const text = readFileSync(SHIPPED, 'utf8');
    const drafts = items.fromYaml(text);
    expect(drafts).toHaveLength(12);
    const yaml = items.toYaml(drafts);
    expect(items.validate(yaml)).toEqual([]);
    expect(parseItemsYaml(yaml, 'x', isCanonName).items).toEqual(
      parseItemsYaml(text, 'x', isCanonName).items,
    );
    expect(items.fromYaml(yaml)).toEqual(drafts);
    // The shipped ids are refused, as the bot does on import.
    expect(
      items.validate(
        yaml,
        drafts.map((d) => d.id),
      ),
    ).toHaveLength(12);
    expect(() => items.fromYaml('id: x')).toThrow(/lista de itens/);
  });

  it('writes a file /jarvis item importar accepts and publishes', async () => {
    const a = { ...items.emptyItem([]), id: 'luva-de-brasa', namePt: 'Luva de brasa', nameEn: 'Ember glove' };
    const b = {
      ...items.emptyItem([a]),
      id: 'manto-cinza',
      slot: 'traje',
      namePt: 'Manto cinza',
      descPt: 'Só para as fotos.',
      cosmetic: true,
      bonus: { hp: 0, atk: 0, def: 0, spd: 0, foc: 0 },
      forSale: true,
      price: 45,
      order: 3,
    };
    const c = {
      ...items.emptyItem([a, b]),
      namePt: 'Chip de foco',
      slot: 'dispositivo',
      forSale: false,
      minLevel: 4,
    };
    c.bonus = { hp: 8, atk: 0, def: 0, spd: 0, foc: 2 };
    const yaml = items.toYaml([a, b, c]);
    expect(items.validate(yaml)).toEqual([]);
    t = await createTestContext({ bots: [cerebro, jarvis] });
    expect(await importAndPublish(t, 'jarvis', 'item importar', yaml, items.ITEM_FILE)).toBe(
      '✅ Itens publicados: 3 novo(s), 0 alterado(s), 0 igual(is). Desequipados: 0.',
    );
    const s = jarvisServices(t.ctxOf(jarvis));
    expect(await s.items.row('manto-cinza')).toMatchObject({
      origin: 'staff',
      price: 45,
      cosmetic: 1,
      slot: 'traje',
    });
    expect(await s.items.row('item-3')).toMatchObject({ price: null, minLevel: 4 });
  });

  it('reports canon names, a cosmetic with a bonus and out-of-range values with the bot paths', async () => {
    const bad = {
      ...items.emptyItem([]),
      namePt: 'Escudo do Capitão América',
      cosmetic: true,
      bonus: { hp: 0, atk: 3, def: 0, spd: 0, foc: 0 },
      price: 0,
    };
    const yaml = items.toYaml([bad]);
    const errs = items.validate(yaml);
    expect(errs).toEqual([
      'itens.yaml → item 1 (item-1) → name.pt-BR: nome de personagem existente; use um nome original',
      'itens.yaml → item 1 (item-1) → bonus.atk: muito grande (máximo 2)',
      'itens.yaml → item 1 (item-1) → shop.price: muito pequeno (mínimo 1)',
      'itens.yaml → item 1 (item-1) → bonus: item cosmético não tem bônus; tire o bonus ou use cosmetic: false',
    ]);
    t = await createTestContext({ bots: [cerebro, jarvis] });
    const bot = await importAndPublish(t, 'jarvis', 'item importar', yaml, items.ITEM_FILE);
    for (const e of errs) expect(bot).toContain(e);
    const cosmetic = items.validate(
      items.toYaml([
        {
          ...items.emptyItem([]),
          namePt: 'Fita',
          cosmetic: true,
          bonus: { hp: 0, atk: 0, def: 0, spd: 0, foc: 0 },
        },
      ]),
    );
    expect(cosmetic).toEqual([]);
    const withBonus = items.toYaml([
      {
        ...items.emptyItem([]),
        namePt: 'Fita',
        cosmetic: true,
        bonus: { hp: 0, atk: 1, def: 0, spd: 0, foc: 0 },
      },
    ]);
    expect(items.validate(withBonus)).toEqual([
      'itens.yaml → item 1 (item-1) → bonus: item cosmético não tem bônus; tire o bonus ou use cosmetic: false',
    ]);
    expect(items.validate(items.toYaml([]))).toEqual(['itens.yaml: nenhum item no arquivo']);
  });
});

describe('enemy editor', () => {
  it('writes a file /ultron inimigo importar accepts and publishes', async () => {
    const a = { ...enemies.emptyEnemy([]), name: 'Vigia de Cobalto' };
    const b = { ...enemies.emptyEnemy([a]), name: 'Golem de Ferrugem', tier: 'elite', minLevel: 3 };
    const yaml = enemies.toYaml([a, b]);
    expect(enemies.validate(yaml)).toEqual([]);

    const CH = { welcome: '300000000000000001', combat: '300000000000000010', events: '300000000000000012' };
    t = await createTestContext({ bots: [cerebro, jarvis, sentinel, ultron], config: { channels: CH } });
    expect(await importAndPublish(t, 'ultron', 'inimigo importar', yaml, enemies.ENEMY_FILE)).not.toMatch(
      /erros/,
    );
    const saved = await ultronServices(t.ctxOf(ultron)).repo.template(b.id);
    expect(saved).toMatchObject({ name: 'Golem de Ferrugem', tier: 'elite', minLevel: 3 });
  });

  it('refuses canon names and bad stats with the bot messages', () => {
    const bad = { ...enemies.emptyEnemy([]), name: 'Magneto', minLevel: 0 };
    bad.base.atk = 0;
    const errors = enemies.validate(enemies.toYaml([bad])).join('\n');
    expect(errors).toContain('name: nome de personagem existente; use um nome original');
    expect(errors).toContain('minLevel: muito pequeno (mínimo 1)');
    expect(errors).toContain('base.atk: muito pequeno (mínimo 1)');
  });

  it('opens the shipped enemies, keeps their taunts and saves them back valid', () => {
    const text = readFileSync(join(ROOT, 'packages/bot-ultron/content/enemies.yaml'), 'utf8');
    const drafts = enemies.fromYaml(text);
    expect(drafts.length).toBeGreaterThan(5);
    expect(drafts[0]?.tauntKeys.length).toBeGreaterThan(0);
    const yaml = enemies.toYaml(drafts);
    expect(enemies.validate(yaml)).toEqual([]);
    expect(enemies.fromYaml(yaml)).toEqual(drafts);
  });
});

const MISSIONS_DIR = join(ROOT, 'packages/bot-jarvis/content/missions');
const shippedMissions = () => readdirSync(MISSIONS_DIR).filter((f) => f.endsWith('.yaml'));

describe('mission editor', () => {
  it('opens every shipped mission and saves it back with the same meaning', () => {
    expect(shippedMissions().length).toBeGreaterThan(0);
    for (const f of shippedMissions()) {
      const text = readFileSync(join(MISSIONS_DIR, f), 'utf8');
      const original = parseMissionYaml(text);
      const draft = missions.fromYaml(text);
      expect(missions.validate(draft), f).toEqual([]);
      const again = parseMissionYaml(missions.toYaml(draft));
      expect(again, f).toEqual(original);
      expect(missions.fromYaml(missions.toYaml(draft)), f).toEqual(draft);
    }
  });

  it('lists the shipped missions the bundle offers as starting points', () => {
    const src = readFileSync(join(import.meta.dirname, '../editor/missions-shipped.ts'), 'utf8');
    for (const f of shippedMissions()) expect(src, f).toContain(`content/missions/${f}'`);
  });

  it('writes a mission with a fight that /jarvis missao importar accepts and publishes', async () => {
    const m = missions.emptyMission();
    m.id = 'resgate-no-tunel';
    m.title = { pt: 'Resgate no túnel', en: 'Tunnel rescue' };
    m.summary = { pt: 'Um trem parou no escuro.', en: '' };
    m.party = 2;
    const [start, win, lose] = m.scenes;
    if (!start || !win || !lose) throw new Error('skeleton changed');
    start.text.pt = 'Faróis vermelhos piscam no fim do túnel.';
    start.choices[0] = { label: { pt: 'Avançar', en: 'Advance' }, next: 'luta' };
    start.choices[1] = { label: { pt: 'Recuar', en: '' }, next: 'falha' };
    win.text.pt = 'Os passageiros saem em segurança.';
    lose.text.pt = 'O trem some na escuridão.';
    m.scenes.push({
      ...missions.emptyScene('luta', 'combat'),
      text: { pt: 'Drones bloqueiam a saída!', en: '' },
      win: 'sucesso',
      lose: 'falha',
    });
    missions.renameScene(m, 'sucesso', 'vitoria');
    expect(m.scenes.find((x) => x.id === 'luta')?.win).toBe('vitoria');
    expect(missions.validate(m)).toEqual([]);

    t = await createTestContext({ bots: [cerebro, jarvis] });
    expect(
      await importAndPublish(t, 'jarvis', 'missao importar', missions.toYaml(m), missions.fileName(m)),
    ).toMatch(/resgate-no-tunel/);
    const row = await jarvisServices(t.ctxOf(jarvis)).repo.mission('resgate-no-tunel');
    expect(row).toMatchObject({ active: 1, origin: 'staff', hasCombat: 1, party: 2 });
  });

  it('shows dangling links, unreachable scenes, cycles and repeated ids', () => {
    const m = missions.emptyMission();
    m.scenes.push(missions.emptyScene('solta', 'end'));
    missions.removeScene(m, 'falha');
    const map = missions.mapProblems(m);
    expect(map.get('inicio')).toEqual(['leva a "", que não existe']);
    const fixed = m.scenes[0]?.choices[1];
    if (fixed) fixed.next = 'sucesso';
    expect(missions.mapProblems(m).get('solta')).toEqual(['cena inalcançável a partir de start']);

    const loop = missions.emptyMission();
    const first = loop.scenes[0]?.choices[0];
    if (first) first.next = 'inicio';
    expect(missions.mapProblems(loop).get('inicio')?.[0]).toMatch(/^ciclo: inicio → inicio/);

    const dup = missions.emptyMission();
    dup.scenes.push(missions.emptyScene('falha', 'end'));
    expect(missions.validate(dup)).toContain(
      'scenes: a cena "falha" aparece duas vezes; os ids precisam ser únicos',
    );
    expect(missions.validate(missions.emptyMission())).toContain('title: obrigatório');
  });

  it('accepts canon heroes in titles and choice labels, like the bot (ADR 0030)', () => {
    const m = missions.fromYaml(readFileSync(join(MISSIONS_DIR, 'patrulha-noturna.yaml'), 'utf8'));
    m.title.pt = 'Capitão América convoca você';
    const choice = m.scenes[0]?.choices[0];
    if (choice) choice.label.pt = 'Chamar o Wolverine';
    expect(missions.validate(m)).toEqual([]);
    expect(parseMissionYaml(missions.toYaml(m))).toHaveProperty('mission');
  });
});

/** A filled mission draft: one choice wins, the other loses. */
function chapterDraft(id: string, chapter: number, campaignId = 'noite-longa') {
  const m = missions.emptyMission();
  m.id = id;
  m.kind = 'story';
  m.title = { pt: `Capítulo ${chapter}`, en: `Chapter ${chapter}` };
  m.summary = { pt: 'Um capítulo da noite.', en: '' };
  const [start, win, lose] = m.scenes;
  if (!start || !win || !lose) throw new Error('skeleton changed');
  start.text.pt = 'A cidade apaga.';
  start.choices[0] = { label: { pt: 'Investigar', en: '' }, next: 'sucesso' };
  start.choices[1] = { label: { pt: 'Esperar', en: '' }, next: 'falha' };
  win.text.pt = 'A luz volta.';
  lose.text.pt = 'A noite vence.';
  m.campaign = { id: campaignId, chapter };
  return m;
}

describe('mission editor: campaigns', () => {
  it('writes campaign, chapter, requires and joinFaction, and reads them back', () => {
    const m = chapterDraft('rv-3', 3, 'recrutamento-vingadores');
    m.requires = {
      missions: 'rv-1, rv-2',
      level: 3,
      origins: ['ciencia', 'tecnologia'],
      factions: 'independent, xmen',
    };
    m.joinFaction = 'avengers';
    expect(missions.validate(m)).toEqual([]);
    const parsed = parseMissionYaml(missions.toYaml(m));
    expect(parsed).toMatchObject({
      mission: {
        campaign: { id: 'recrutamento-vingadores', chapter: 3 },
        requires: {
          missions: ['rv-1', 'rv-2'],
          level: 3,
          origins: ['ciencia', 'tecnologia'],
          factions: ['independent', 'xmen'],
        },
        reward: { joinFaction: 'avengers' },
      },
    });
    expect(missions.fromYaml(missions.toYaml(m))).toEqual(m);
    // Empty fields are not written.
    expect(missions.toYaml(missions.emptyMission())).not.toMatch(/campaign|requires|reward|\bsquad\b/);
    m.requires.origins = ['alienigena'];
    expect(missions.validate(m).join('\n')).toMatch(/requires\.origins\.0/);
  });

  it('writes optional squad on mission and campaign YAML, and omits it when empty', () => {
    const m = chapterDraft('solo-1', 1, '');
    m.campaign = { id: '', chapter: 1 };
    expect(missions.toYaml(m)).not.toMatch(/\bsquad\b/);
    m.squad = '  Noite Norte  ';
    const text = missions.toYaml(m);
    expect(text).toMatch(/^squad: Noite Norte$/m);
    expect(missions.fromYaml(text)).toMatchObject({ squad: 'Noite Norte' });
    expect(missions.validate(m)).toEqual([]);
    m.squad = 'x'.repeat(33);
    expect(missions.validate(m).join('\n')).toMatch(/squad/);

    const c = missions.emptyCampaign();
    c.id = 'noite-longa';
    c.title = { pt: 'Noite longa', en: '' };
    c.summary = { pt: 'Resumo.', en: '' };
    missions.addChapter(c, chapterDraft('noite-1', 1));
    expect(missions.campaignToYaml(c)).not.toMatch(/\bsquad\b/);
    c.squad = 'ABC123';
    const camp = missions.campaignToYaml(c);
    expect(camp).toMatch(/campaign:[\s\S]*\bsquad: ABC123\b/);
    expect(missions.campaignFromYaml(camp)).toMatchObject({ squad: 'ABC123' });
    expect(missions.validateCampaign(c)).toEqual([]);
  });

  it('writes optional credits and reads them back; the bot accepts them (v0.10)', () => {
    const m = missions.fromYaml(missions.toYaml(missions.emptyMission()));
    expect(missions.toYaml(m)).not.toMatch(/credits/);
    m.customCredits = true;
    m.credits = { success: 35, failure: 7 };
    const text = missions.toYaml(m);
    expect(text).toMatch(/credits:\n\s+success: 35\n\s+failure: 7/);
    expect(missions.fromYaml(text)).toMatchObject({
      customCredits: true,
      credits: { success: 35, failure: 7 },
    });
    const old = missions.emptyMission() as Partial<missions.MissionDraft>;
    delete old.customCredits;
    delete old.credits;
    expect(missions.withDefaults(old as missions.MissionDraft)).toMatchObject({
      customCredits: false,
      credits: { success: 20, failure: 5 },
    });
    const bot = parseMissionYaml(text.replace('credits:', 'credits:'));
    expect('errors' in bot ? bot.errors.filter((e) => e.includes('credits')) : []).toEqual([]);
    const bad = parseMissionYaml(text.replace('success: 35', 'success: 10001'));
    expect('errors' in bad ? bad.errors.join() : '').toMatch(/credits.success/);
  });

  it('a draft saved before campaigns gets the new fields', () => {
    const old = missions.emptyMission() as Partial<missions.MissionDraft>;
    delete old.campaign;
    delete old.requires;
    delete old.joinFaction;
    delete old.squad;
    const m = missions.withDefaults(old as missions.MissionDraft);
    expect(m.requires).toEqual({ missions: '', level: 0, origins: [], factions: '' });
    expect(m.squad).toBe('');
    expect(missions.validate({ ...m, title: { pt: 'x', en: '' } }).join()).not.toMatch(/campaign/);
    const cold = missions.emptyCampaign() as Partial<missions.CampaignDraft>;
    delete cold.squad;
    expect(missions.withCampaignDefaults(cold as missions.CampaignDraft).squad).toBe('');
  });

  it('builds a campaign file that /jarvis campanha importar accepts, and opens it again', async () => {
    const c = missions.emptyCampaign();
    c.id = 'noite-longa';
    c.title = { pt: 'Noite longa', en: 'Long night' };
    c.summary = { pt: 'Dois capítulos numa noite.', en: '' };
    expect(missions.validateCampaign(c)).toEqual(['missions: adicione pelo menos uma missão como capítulo']);
    const two = chapterDraft('noite-2', 2);
    two.requires.missions = 'noite-1';
    missions.addChapter(c, two);
    missions.addChapter(c, chapterDraft('noite-1', 1));
    expect(c.missions.map((m) => m.id)).toEqual(['noite-1', 'noite-2']);
    expect(missions.validateCampaign(c)).toEqual([]);
    expect(missions.campaignFileName(c)).toBe('campanha-noite-longa.yaml');
    const text = missions.campaignToYaml(c);
    expect(missions.campaignFromYaml(text)).toEqual(c);

    t = await createTestContext({ bots: [cerebro, jarvis] });
    expect(await importAndPublish(t, 'jarvis', 'campanha importar', text, missions.campaignFileName(c))).toBe(
      '✅ Campanha `noite-longa` publicada com 2 missão(ões). Já aparece em /campanha e /missao.',
    );
    const s = jarvisServices(t.ctxOf(jarvis));
    expect(await s.repo.mission('noite-2')).toMatchObject({
      campaignId: 'noite-longa',
      chapter: 2,
      origin: 'staff',
    });
  });

  it('shows the bot errors for a repeated chapter, a cycle and joinFaction outside recruitment', () => {
    const c = missions.emptyCampaign();
    c.id = 'noite-longa';
    c.title = { pt: 'Noite longa', en: '' };
    c.summary = { pt: 'Resumo.', en: '' };
    const a = chapterDraft('noite-1', 1);
    const b = chapterDraft('noite-2', 1);
    missions.addChapter(c, a);
    missions.addChapter(c, b);
    expect(missions.validateCampaign(c).join('\n')).toMatch(/capítulo 1 repetido/);
    b.campaign.chapter = 2;
    a.requires.missions = 'noite-2';
    b.requires.missions = 'noite-1';
    missions.addChapter(c, a);
    missions.addChapter(c, b);
    expect(missions.validateCampaign(c).join('\n')).toMatch(/ciclo em requires/);
    a.requires.missions = '';
    b.joinFaction = 'avengers';
    missions.addChapter(c, a);
    missions.addChapter(c, b);
    expect(missions.validateCampaign(c).join('\n')).toMatch(
      /joinFaction só vale numa missão de campanha de recrutamento/,
    );
    c.kind = 'recruitment';
    c.faction = 'avengers';
    expect(missions.validateCampaign(c)).toEqual([]);
  });
});

describe('drafts and bundle', () => {
  it('keeps drafts across reloads and survives a browser without storage', () => {
    const mem = new Map<string, string>();
    const fake = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    const g = globalThis as { localStorage?: unknown };
    g.localStorage = fake;
    store<{ n: number }>('k').save({ n: 1 });
    expect(store<{ n: number }>('k').load()).toEqual({ n: 1 });
    g.localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(store('k').load()).toBeNull();
    expect(() => store('k').save({ n: 2 })).not.toThrow();
    delete g.localStorage;
  });

  it('bundles the editors for the browser with the bots validation and the canon list', async () => {
    const out = mkdtempSync(join(tmpdir(), 'legion-editors-'));
    try {
      await bundleEditors(out);
      const files = readdirSync(join(out, 'assets/js'));
      expect(files).toEqual(
        expect.arrayContaining(['trivia.js', 'enemy.js', 'mission.js', 'item.js', 'pack.js']),
      );
      const all = files.map((f) => readFileSync(join(out, 'assets/js', f), 'utf8')).join('\n');
      expect(all).not.toMatch(/from\s*["']node:/);
      expect(all.toLowerCase()).toContain('magneto');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('pack editor', () => {
  const triviaYaml = () => {
    const q = question();
    return trivia.toYaml([q]).replace(/^#.*\n/, '');
  };

  const itemYaml = () => {
    const a = {
      ...items.emptyItem([]),
      id: 'luva-do-pack',
      namePt: 'Luva do pack',
      nameEn: 'Pack glove',
    };
    return items.toYaml([a]).replace(/^#.*\n/, '');
  };

  it('builds a valid pack.yaml that /jarvis pack importar accepts and publishes', async () => {
    const draft = packs.emptyPack();
    draft.id = 'pack-site';
    draft.namePt = 'Pacote do site';
    draft.author = 'Staff do site';
    draft.triviaYaml = triviaYaml();
    draft.itemsYaml = itemYaml();
    expect(packs.validate(draft)).toEqual([]);
    const yaml = packs.toYaml(draft);
    expect(yaml).toMatch(/^id: pack-site$/m);
    expect(packs.fromYaml(yaml)).toMatchObject({
      id: 'pack-site',
      namePt: 'Pacote do site',
      author: 'Staff do site',
    });

    t = await createTestContext({ bots: [cerebro, jarvis] });
    expect(await importAndPublish(t, 'jarvis', 'pack importar', yaml, packs.PACK_FILE)).toMatch(
      /Pacote `pack-site` v1\.0\.0 instalado/,
    );
    const s = jarvisServices(t.ctxOf(jarvis));
    expect(await s.packs.list()).toHaveLength(1);
    expect(await s.items.row('luva-do-pack')).toMatchObject({ origin: 'pack', active: 1 });
  });

  it('reports bad metadata and empty packs like the bot', () => {
    const empty = packs.emptyPack();
    empty.author = '';
    expect(packs.validate(empty).join('\n')).toMatch(/author|pacote vazio/);
    empty.author = 'Staff';
    expect(packs.validate(empty).join('\n')).toContain('pacote vazio');

    empty.id = 'BAD';
    empty.itemsYaml = itemYaml();
    expect(packs.validate(empty).join('\n')).toMatch(/id/);

    empty.id = 'ok-pack';
    empty.version = 'nope';
    expect(packs.validate(empty).join('\n')).toMatch(/version|semver/);

    empty.version = '1.0.0';
    empty.itemsYaml = '- id: [quebrado';
    expect(packs.validate(empty).join('\n')).toMatch(/items.*YAML inválido/);

    empty.itemsYaml = 'id: not-a-list';
    expect(packs.validate(empty).join('\n')).toMatch(/items: deve ser uma lista/);
  });
});
