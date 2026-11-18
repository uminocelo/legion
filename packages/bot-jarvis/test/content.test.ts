import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { readTriviaContent, syncTriviaContent } from '../src/content.js';
import { JARVIS_CONTENT_DIR } from '../src/paths.js';
import { servicesOf, setupJarvis } from './helpers.js';

const CATS = ['quadrinhos', 'rivals', 'geral'];
const dir = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'trivia-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text);
  return d;
};
const q = (id: string, extra = '') =>
  `- id: ${id}\n  category: geral\n  difficulty: facil\n  question: "Pergunta ${id}?"\n  choices: ["a", "b"]\n  answer: 0\n  explanation: "x"\n  source: "https://example.com/${id}"\n${extra}`;

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('trivia content', () => {
  it('ships 30 valid pt-BR questions, 10 per category, all with sources', () => {
    const { questions, errors } = readTriviaContent([join(JARVIS_CONTENT_DIR, 'trivia')], CATS, 'pt-BR');
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(30);
    for (const c of CATS) expect(questions.filter((x) => x.category === c)).toHaveLength(10);
    expect(questions.every((x) => x.locale === 'pt-BR' && x.source.startsWith('https://'))).toBe(true);
  });

  it('gives readable errors for invalid YAML and invalid items', () => {
    const d = dir({
      'broken.yaml': '- id: [unclosed',
      'pack.yaml': `${q('ok-1')}${q('bad-1').replace('answer: 0', 'answer: 7')}${q('ok-1')}- id: x9\n  category: culinaria\n  difficulty: facil\n  question: "Qual?????"\n  choices: ["a", "b"]\n  answer: 0\n  explanation: "x"\n  source: "https://e.com"\n`,
    });
    const { questions, errors } = readTriviaContent([d], CATS, 'pt-BR');
    expect(questions.map((x) => x.id)).toEqual(['ok-1']);
    expect(errors[0]).toMatch(/^broken\.yaml \(linha \d+\): YAML inválido/);
    expect(errors).toContain(
      'pack.yaml → item 2 (bad-1) → answer: answer aponta para uma alternativa que não existe (comece em 0)',
    );
    expect(errors).toContain('pack.yaml → item 3 (ok-1) → id: "ok-1" repetido (já existe em pack.yaml)');
    expect(errors.some((e) => e.includes('"culinaria" não está em jarvis.trivia.categories'))).toBe(true);
  });

  it('upserts by id with contentHash and deactivates removed questions (never deletes)', async () => {
    t = await setupJarvis();
    const { repo } = servicesOf(t);
    const v1 = dir({ 'pt-BR.yaml': q('qa') + q('qb') + q('qc') });
    // The 30 bundled questions were loaded at boot; a pack without them deactivates them.
    expect(await syncTriviaContent(repo, readTriviaContent([v1], CATS, 'pt-BR'))).toMatchObject({
      added: 3,
      updated: 0,
      deactivated: 30,
    });
    expect(await syncTriviaContent(repo, readTriviaContent([v1], CATS, 'pt-BR'))).toMatchObject({
      added: 0,
      unchanged: 3,
    });
    const v2 = dir({ 'pt-BR.yaml': q('qa').replace('Pergunta qa?', 'Pergunta A nova?') + q('qb') });
    expect(await syncTriviaContent(repo, readTriviaContent([v2], CATS, 'pt-BR'))).toMatchObject({
      added: 0,
      updated: 1,
      deactivated: 1,
      unchanged: 1,
    });
    const all = (await repo.allQuestions()).filter((x) => /^q[abc]$/.test(x.id));
    expect(all.map((r) => [r.id, r.active])).toEqual([
      ['qa', 1],
      ['qb', 1],
      ['qc', 0],
    ]);
    expect(all[0]?.question).toBe('Pergunta A nova?');
    // c comes back → reactivated
    expect(await syncTriviaContent(repo, readTriviaContent([v1], CATS, 'pt-BR'))).toMatchObject({
      updated: 2,
    });
  });

  it('never deactivates anything when a file has errors', async () => {
    t = await setupJarvis();
    const { repo } = servicesOf(t);
    await syncTriviaContent(
      repo,
      readTriviaContent([dir({ 'pt-BR.yaml': q('qa') + q('qb') })], CATS, 'pt-BR'),
    );
    const broken = dir({ 'pt-BR.yaml': q('qa') + q('qb').replace('answer: 0', 'answer: 9') });
    const r = await syncTriviaContent(repo, readTriviaContent([broken], CATS, 'pt-BR'));
    expect(r.deactivated).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect((await repo.allQuestions()).filter((x) => /^q[ab]$/.test(x.id)).every((x) => x.active === 1)).toBe(
      true,
    );
  });
});
