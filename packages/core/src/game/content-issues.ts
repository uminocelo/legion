// Readable pt-BR messages for content files (trivia, missions, enemies), shared by the bots' imports
// and the website editors. No Node APIs. Custom messages from the schemas are kept as written.
import type { z } from 'zod';

const EXPECTED: Record<string, string> = {
  string: 'texto',
  number: 'número',
  int: 'número inteiro',
  boolean: 'true ou false',
  array: 'lista',
  object: 'objeto',
};

const count = (origin: unknown, n: unknown, small: boolean): string => {
  if (origin === 'string')
    return small ? `muito curto (mínimo ${n} caracteres)` : `muito longo (máximo ${n} caracteres)`;
  if (origin === 'array' || origin === 'set')
    return small ? `poucos itens (mínimo ${n})` : `itens demais (máximo ${n})`;
  return small ? `muito pequeno (mínimo ${n})` : `muito grande (máximo ${n})`;
};

/** One zod issue as a short sentence (the field path is added by the caller). */
export function contentIssue(issue: z.core.$ZodIssue): string {
  const i = issue as unknown as Record<string, unknown>;
  switch (issue.code) {
    case 'custom':
      return issue.message;
    case 'invalid_type':
      if (String(issue.message).includes('received undefined')) return 'obrigatório';
      return `tipo inválido (esperado ${EXPECTED[String(i.expected)] ?? String(i.expected)})`;
    case 'too_small':
      return count(i.origin, i.minimum, true);
    case 'too_big':
      return count(i.origin, i.maximum, false);
    case 'invalid_value':
      return `use um de: ${((i.values as unknown[]) ?? []).map((v) => JSON.stringify(v)).join(', ')}`;
    case 'invalid_format':
      // A message given in the schema (e.g. the id rule) beats the generic one.
      return /^Invalid/.test(issue.message) ? 'formato inválido' : issue.message;
    case 'unrecognized_keys':
      return `campo desconhecido: ${((i.keys as string[]) ?? []).join(', ')}`;
    default:
      return issue.message;
  }
}

/** `path: message` for each issue (`fallback` names the whole item when the path is empty). */
export const contentIssues = (issues: readonly z.core.$ZodIssue[], fallback: string): string[] =>
  issues.map((x) => `${x.path.join('.') || fallback}: ${contentIssue(x)}`);
