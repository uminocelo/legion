// Trivia drafts ↔ YAML, validated by the bot's own parser (`/jarvis trivia importar`).
import { parse, stringify } from 'yaml';
import { DIFFICULTIES } from '../../packages/bot-jarvis/src/config.js';
import { parseTriviaYaml } from '../../packages/bot-jarvis/src/domain/trivia.js';

export { DIFFICULTIES };
export const DEFAULT_CATEGORIES = [
  'quadrinhos',
  'rivals',
  'geral',
  'vingadores',
  'quarteto',
  'cosmico',
  'mistico',
];
export const TRIVIA_FILE = 'perguntas.yaml';

export interface TriviaDraft {
  id: string;
  locale: 'pt-BR' | 'en';
  category: string;
  difficulty: string;
  question: string;
  choices: string[];
  answer: number;
  explanation: string;
  source: string;
  /** Optional squad name or code; empty = omit from YAML (global content). */
  squad: string;
}

/** Next free id like `meu-servidor-0003`. */
export function nextId(drafts: readonly TriviaDraft[], prefix = 'meu-servidor'): string {
  const used = new Set(drafts.map((d) => d.id));
  for (let n = drafts.length + 1; ; n++) {
    const id = `${prefix}-${String(n).padStart(4, '0')}`;
    if (!used.has(id)) return id;
  }
}

export const emptyQuestion = (drafts: readonly TriviaDraft[]): TriviaDraft => ({
  id: nextId(drafts),
  locale: 'pt-BR',
  category: 'geral',
  difficulty: 'normal',
  question: '',
  choices: ['', '', '', ''],
  answer: 0,
  explanation: '',
  source: '',
  squad: '',
});

/** The file items: empty alternatives dropped, the right answer re-indexed (-1 when it was empty). */
export function toItems(drafts: readonly TriviaDraft[]) {
  return drafts.map((d) => {
    const kept = d.choices.map((c, i) => ({ c: c.trim(), i })).filter((x) => x.c !== '');
    const squad = (d.squad ?? '').trim();
    return {
      id: d.id.trim(),
      locale: d.locale,
      category: d.category.trim(),
      difficulty: d.difficulty,
      question: d.question.trim(),
      choices: kept.map((x) => x.c),
      answer: kept.findIndex((x) => x.i === d.answer),
      explanation: d.explanation.trim(),
      source: d.source.trim(),
      ...(squad ? { squad } : {}),
    };
  });
}

export function toYaml(drafts: readonly TriviaDraft[]): string {
  const header =
    '# Perguntas de trivia do Legion. Importe com /jarvis trivia importar (anexe este arquivo).\n';
  return header + stringify(toItems(drafts));
}

export function validate(yaml: string, categories: readonly string[]): string[] {
  const res = parseTriviaYaml(yaml, TRIVIA_FILE, { categories, locale: 'pt-BR' });
  if (!res.errors.length && !res.questions.length) return [`${TRIVIA_FILE}: nenhuma pergunta`];
  return res.errors;
}

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d);

/** Opens an existing file (content pack or `/jarvis trivia exportar`) as drafts; lenient on purpose. */
export function fromYaml(text: string): TriviaDraft[] {
  const raw = parse(text);
  if (!Array.isArray(raw)) throw new Error('o arquivo deve ser uma lista de perguntas (- id: ...)');
  return raw.map((x: Record<string, unknown>) => {
    const choices = Array.isArray(x.choices) ? x.choices.map((c) => str(c)) : [];
    while (choices.length < 4) choices.push('');
    return {
      id: str(x.id),
      locale: x.locale === 'en' ? 'en' : 'pt-BR',
      category: str(x.category, 'geral'),
      difficulty: str(x.difficulty, 'normal'),
      question: str(x.question),
      choices: choices.slice(0, 4),
      answer: typeof x.answer === 'number' ? x.answer : 0,
      explanation: str(x.explanation),
      source: str(x.source),
      squad: str(x.squad),
    };
  });
}
