// Trivia question format and validation, with no Node APIs: used by the bot (content files and
// `/jarvis trivia importar`) and by the website editor, so both report the same errors.
import { contentIssue, type Locale } from '@legion/core';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';
import { DIFFICULTIES } from '../config.js';

export const questionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/, 'use letras minúsculas, números, - ou _ (2 a 64)'),
    category: z.string().min(1),
    difficulty: z.enum(DIFFICULTIES),
    question: z.string().min(5).max(300),
    choices: z.array(z.string().min(1).max(80)).min(2).max(4),
    answer: z.number().int().min(0),
    explanation: z.string().min(1).max(300),
    // A URL or a reference such as "Shang-Chi #4 (2021)".
    source: z.string().trim().min(3).max(200),
    locale: z.enum(['pt-BR', 'en']).optional(),
  })
  .refine((q) => q.answer < q.choices.length, {
    path: ['answer'],
    message: 'answer aponta para uma alternativa que não existe (comece em 0)',
  })
  .refine((q) => new Set(q.choices).size === q.choices.length, {
    path: ['choices'],
    message: 'as alternativas precisam ser diferentes',
  });

export type TriviaQuestion = z.infer<typeof questionSchema> & { locale: Locale };

export interface TriviaCheckOptions {
  /** Allowed categories (`jarvis.trivia.categories`); omit to accept any. */
  categories?: readonly string[];
  /** Locale for items without `locale`. */
  locale: Locale;
  /** ids already seen → where (shared across files to catch duplicates). */
  seen?: Map<string, string>;
}

/** Validates a parsed list of questions. Errors name the file, item number, id and field. */
export function checkTriviaItems(
  raw: unknown[],
  name: string,
  o: TriviaCheckOptions,
): { questions: TriviaQuestion[]; errors: string[] } {
  const questions: TriviaQuestion[] = [];
  const errors: string[] = [];
  const seen = o.seen ?? new Map<string, string>();
  raw.forEach((item, i) => {
    const res = questionSchema.safeParse(item);
    const label = `${name} → item ${i + 1}${(item as { id?: string })?.id ? ` (${(item as { id: string }).id})` : ''}`;
    if (!res.success) {
      for (const issue of res.error.issues)
        errors.push(`${label} → ${issue.path.join('.') || 'item'}: ${contentIssue(issue)}`);
      return;
    }
    const q = res.data;
    if (o.categories && !o.categories.includes(q.category)) {
      errors.push(
        `${label} → category: "${q.category}" não está em jarvis.trivia.categories (${o.categories.join(', ')})`,
      );
      return;
    }
    const dup = seen.get(q.id);
    if (dup) {
      errors.push(`${label} → id: "${q.id}" repetido (já existe em ${dup})`);
      return;
    }
    seen.set(q.id, name);
    questions.push({ ...q, locale: q.locale ?? o.locale });
  });
  return { questions, errors };
}

/** Parses a YAML list of questions (a content file, an attachment or the website editor's output). */
export function parseTriviaYaml(
  text: string,
  name: string,
  o: TriviaCheckOptions,
): { questions: TriviaQuestion[]; errors: string[] } {
  let raw: unknown;
  try {
    raw = parseYaml(text) ?? [];
  } catch (err) {
    const pos = err instanceof YAMLParseError ? ` (linha ${err.linePos?.[0]?.line ?? 0})` : '';
    return {
      questions: [],
      errors: [`${name}${pos}: YAML inválido: ${(err as Error).message.split('\n')[0]}`],
    };
  }
  if (!Array.isArray(raw))
    return { questions: [], errors: [`${name}: o arquivo deve ser uma lista de perguntas`] };
  return checkTriviaItems(raw, name, o);
}
