import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cerebro } from '@legion/bot-cerebro';
import { jarvis, jarvisServices } from '@legion/bot-jarvis';
import { sentinel } from '@legion/bot-sentinel';
import { ultron, ultronServices } from '@legion/bot-ultron';
import { createTestContext, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import * as enemies from '../editor/enemy-model.js';
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

  it('opens the shipped questions and saves them back unchanged in meaning', () => {
    const text = readFileSync(join(ROOT, 'packages/bot-jarvis/content/trivia/pt-BR.yaml'), 'utf8');
    const drafts = trivia.fromYaml(text);
    expect(drafts).toHaveLength(30);
    const yaml = trivia.toYaml(drafts);
    expect(trivia.validate(yaml, trivia.DEFAULT_CATEGORIES)).toEqual([]);
    expect(trivia.fromYaml(yaml)).toEqual(drafts);
    expect(() => trivia.fromYaml('id: not-a-list')).toThrow(/lista de perguntas/);
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
      expect(files).toEqual(expect.arrayContaining(['trivia.js', 'enemy.js']));
      const all = files.map((f) => readFileSync(join(out, 'assets/js', f), 'utf8')).join('\n');
      expect(all).not.toMatch(/from\s*["']node:/);
      expect(all.toLowerCase()).toContain('magneto');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
