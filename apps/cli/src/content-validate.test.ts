import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectType, formatValidate, validateContent } from './content-validate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SHIPPED = ['bot-jarvis', 'bot-ultron', 'bot-cerebro'].map((p) => join(ROOT, 'packages', p, 'content'));

const dir = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'legion-validate-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(d, name)), { recursive: true });
    writeFileSync(join(d, name), text);
  }
  return d;
};
const shippedText = (p: string) => readFileSync(join(ROOT, 'packages', p), 'utf8');
const mission = (id: string, extra = '') => `id: ${id}
kind: story
title: { pt-BR: "Missão ${id}", en: "Mission ${id}" }
summary: { pt-BR: "Resumo da missão.", en: "Mission summary." }
${extra}start: inicio
scenes:
  inicio:
    text: { pt-BR: "Começo.", en: "Start." }
    choices:
      - label: { pt-BR: "Vencer", en: "Win" }
        next: fim
      - label: { pt-BR: "Perder", en: "Lose" }
        next: falha
  fim:
    text: { pt-BR: "Fim.", en: "End." }
    end: success
  falha:
    text: { pt-BR: "Falha.", en: "Failure." }
    end: failure
`;
const trivia = (id: string, extra = '') =>
  `- id: ${id}\n  category: geral\n  difficulty: facil\n  question: "Pergunta ${id}?"\n  choices: ["a", "b"]\n  answer: 0\n  explanation: "x"\n  source: "https://example.com/${id}"\n${extra}`;

describe('legion content validate', () => {
  it('passes every shipped content folder', () => {
    const r = validateContent(SHIPPED);
    expect(r.files.filter((f) => f.errors.length)).toEqual([]);
    expect(r.exitCode).toBe(0);
    const types = new Set(r.files.map((f) => f.type));
    for (const t of ['trivia', 'mission', 'campaign', 'enemy', 'power'])
      expect(types.has(t as never), t).toBe(true);
    expect(formatValidate(r)).toMatch(/Tudo certo: \d+ arquivo\(s\) de conteúdo válidos\./);
  });

  it('tells each type from the file shape', () => {
    expect(detectType([{ id: 'q', question: 'x?' }])).toBe('trivia');
    expect(detectType([{ id: 'e', tier: 'minion' }])).toBe('enemy');
    expect(detectType([{ id: 'p', type: 'ataque', description: {} }])).toBe('power');
    expect(detectType({ id: 'm', scenes: {} })).toBe('mission');
    expect(detectType({ id: 'c', kind: 'story', title: {} })).toBe('campaign');
    expect(detectType({ campaign: {}, missions: [] })).toBe('campaign-file');
    expect(detectType({ chain: 'x', steps: [] })).toBeNull();
    expect(detectType([])).toBeNull();
  });

  it("reports the bots' errors for a broken file of each type and exits 1", () => {
    const d = dir({
      'trivia/pt-BR.yaml':
        trivia('ok-1') + trivia('bad-1').replace('answer: 0', 'answer: 7') + trivia('ok-1'),
      'trivia/cat.yaml': trivia('cat-1').replace('category: geral', 'category: culinaria'),
      'missions/quebrada.yaml': mission('quebrada').replace('next: fim', 'next: nada'),
      'campaigns/sem-titulo.yaml': 'id: sem-titulo\nkind: recruitment\ntitle: { pt-BR: "A" }\n',
      'enemies.yaml': '- id: Magneto\n  tier: minion\n',
      'powers.yaml':
        '- id: raio\n  type: ataque\n  name: { pt-BR: "Wolverine" }\n  description: { pt-BR: "Garras." }\n',
      'broken.yaml': 'id: [unclosed',
    });
    const r = validateContent([d]);
    expect(r.exitCode).toBe(1);
    const errs = (end: string) => r.files.find((f) => f.path.endsWith(end))?.errors.join('\n') ?? '';
    expect(errs('pt-BR.yaml')).toMatch(/answer aponta para uma alternativa que não existe/);
    expect(errs('pt-BR.yaml')).toMatch(/id: "ok-1" repetido/);
    expect(errs('cat.yaml')).toMatch(/"culinaria" não está em jarvis.trivia.categories/);
    expect(errs('quebrada.yaml')).toMatch(/nada/);
    expect(errs('sem-titulo.yaml')).not.toBe('');
    expect(errs('enemies.yaml')).not.toBe('');
    expect(errs('powers.yaml')).toMatch(/nome de personagem|canon|original/i);
    expect(errs('broken.yaml')).toMatch(/^YAML inválido \(linha \d+\)/);
    expect(formatValidate(r)).toMatch(/arquivo\(s\) com erro/);
  });

  it('checks missions and campaigns together, next to the shipped content', () => {
    const ok = dir({
      'campaigns/minha.yaml':
        'id: minha-campanha\nkind: story\ntitle: { pt-BR: "Minha campanha", en: "My campaign" }\nsummary: { pt-BR: "Resumo.", en: "Summary." }\n',
      'missions/minha-1.yaml': mission('minha-1', 'campaign: { id: minha-campanha, chapter: 1 }\n'),
      // builds on a shipped chapter
      'missions/minha-2.yaml': mission(
        'minha-2',
        'campaign: { id: minha-campanha, chapter: 2 }\nrequires: { missions: [minha-1, primeiro-contato-3] }\n',
      ),
    });
    expect(validateContent([ok]).exitCode).toBe(0);

    const bad = dir({
      'a.yaml': mission('ciclo-a', 'requires: { missions: [ciclo-b] }\n'),
      'b.yaml': mission('ciclo-b', 'requires: { missions: [ciclo-a] }\n'),
      'c.yaml': mission('orfa', 'campaign: { id: nao-existe, chapter: 1 }\n'),
      'd.yaml': mission('rouba-time', 'reward: { joinFaction: avengers }\n'),
      'e.yaml': mission('pede-fantasma', 'requires: { missions: [missao-que-nao-existe] }\n'),
    });
    const r = validateContent([bad]);
    expect(r.exitCode).toBe(1);
    const f = (end: string) => r.files.find((x) => x.path.endsWith(end));
    expect(f('a.yaml')?.errors.join()).toMatch(/ciclo|cycle/i);
    expect(f('c.yaml')?.errors.join()).toMatch(/nao-existe/);
    expect(f('d.yaml')?.errors.join()).toMatch(/joinFaction/);
    expect(f('e.yaml')?.errors).toEqual([]);
    expect(f('e.yaml')?.warnings.join()).toMatch(/missao-que-nao-existe/);
  });

  it('validates an import file (campaign + missions) like /jarvis campanha importar', () => {
    const chapter = mission('importada-1', 'campaign: { id: importada, chapter: 1 }\n')
      .split('\n')
      .map((l) => (l ? `    ${l}` : l))
      .join('\n');
    const file = `campaign:\n  id: importada\n  kind: story\n  title: { pt-BR: "Importada", en: "Imported" }\n  summary: { pt-BR: "Resumo.", en: "Summary." }\nmissions:\n  - ${chapter.trimStart()}`;
    const good = dir({ 'importada.yaml': file });
    expect(validateContent([join(good, 'importada.yaml')])).toMatchObject({ exitCode: 0 });
    const r = validateContent([
      join(dir({ 'x.yaml': file.replace('chapter: 1', 'chapter: 1 }\n#') }), 'x.yaml'),
    ]);
    expect(r.files[0]?.type).toBe('campaign-file');
  });

  it('exits 2 for a file of unknown type, and --type forces one', () => {
    const tutorial = join(ROOT, 'packages/bot-herbie/content/tutorial.yaml');
    expect(validateContent([tutorial])).toMatchObject({ exitCode: 2 });
    const r = validateContent([tutorial], { type: 'trivia' });
    expect(r.exitCode).toBe(1);
    expect(r.files[0]?.errors).toEqual(['o arquivo deve ser uma lista de perguntas']);
    // In a folder, unknown files are skipped with a note.
    const d = dir({
      'tutorial.yaml': shippedText('bot-herbie/content/tutorial.yaml'),
      'q.yaml': trivia('q-1'),
    });
    const f = validateContent([d]);
    expect(f.exitCode).toBe(0);
    expect(f.files.find((x) => x.type === null)?.warnings[0]).toMatch(/^ignorado/);
    expect(validateContent([dir({ 'tutorial.yaml': 'chain: x\n' })]).exitCode).toBe(2);
    expect(validateContent(['/nao/existe.yaml']).exitCode).toBe(1);
  });

  it('accepts other trivia categories with --categories', () => {
    const d = dir({ 'q.yaml': trivia('c-1').replace('category: geral', 'category: culinaria') });
    expect(validateContent([d]).exitCode).toBe(1);
    expect(validateContent([d], { categories: ['culinaria'] }).exitCode).toBe(0);
  });

  it('runs from the built CLI with --json and the exit code', () => {
    const cli = join(ROOT, 'apps/cli/dist/index.js');
    const d = dir({ 'q.yaml': trivia('j-1').replace('answer: 0', 'answer: 5') });
    let out = '';
    let code = 0;
    try {
      out = execFileSync('node', [cli, 'content', 'validate', d, '--json'], { encoding: 'utf8' });
    } catch (err) {
      out = String((err as { stdout?: string }).stdout);
      code = (err as { status?: number }).status ?? -1;
    }
    expect(code).toBe(1);
    const json = JSON.parse(out) as { ok: boolean; files: { type: string; errors: string[] }[] };
    expect(json.ok).toBe(false);
    expect(json.files[0]).toMatchObject({ type: 'trivia' });
    expect(json.files[0]?.errors[0]).toMatch(/answer/);
  });
});
