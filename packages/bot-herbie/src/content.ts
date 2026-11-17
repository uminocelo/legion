import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { type Chain, chainSchema } from './domain/quest.js';
import { HERBIE_CONTENT_DIR } from './paths.js';

/** The server's own content folder (overrides the bundled files). */
export const SERVER_CONTENT_DIR = 'data/content';

export interface Loaded<T> {
  value: T | null;
  source: string | null;
  errors: string[];
}

/** Parses and validates one YAML file; errors are readable lines (`file → path: message`). */
export function readYaml<T>(path: string, schema: z.ZodType<T>): Loaded<T> {
  const file = path.split('/').slice(-2).join('/');
  if (!existsSync(path)) return { value: null, source: null, errors: [] };
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, 'utf8'));
  } catch (err) {
    return {
      value: null,
      source: path,
      errors: [`${file}: YAML inválido: ${(err as Error).message.split('\n')[0]}`],
    };
  }
  const res = schema.safeParse(raw);
  if (!res.success)
    return {
      value: null,
      source: path,
      errors: res.error.issues.map((i) => `${file} → ${i.path.join('.') || '(raiz)'}: ${i.message}`),
    };
  return { value: res.data, source: path, errors: [] };
}

/**
 * The tutorial chain. `./data/content/tutorial.yaml` wins when valid. When it exists but is invalid,
 * `value` is null and `errors` lists why, so the caller keeps its previous chain (or the bundled one at boot).
 */
export function loadTutorial(
  serverDir = SERVER_CONTENT_DIR,
  bundledDir = HERBIE_CONTENT_DIR,
): Loaded<Chain> & { bundled: Chain | null } {
  const bundled = readYaml(join(bundledDir, 'tutorial.yaml'), chainSchema);
  const server = readYaml(join(serverDir, 'tutorial.yaml'), chainSchema);
  if (server.value || server.errors.length) return { ...server, bundled: bundled.value };
  return { ...bundled, bundled: bundled.value };
}

export const glossaryEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  term: z.string().min(1).max(60),
  aliases: z.array(z.string().min(1).max(60)).default([]),
  summary: z.string().min(1).max(300),
  details: z.string().min(1).max(1500),
  related: z.array(z.string()).default([]),
  bot: z.enum(['cerebro', 'jarvis', 'herbie', 'sentinel', 'ultron']).optional(),
});
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;
export const glossarySchema = z.array(glossaryEntrySchema).superRefine((list, ctx) => {
  const ids = list.map((e) => e.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) ctx.addIssue({ code: 'custom', path: [], message: `id "${dup}" is repeated` });
});

export const tipSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  text: z.string().min(1).max(500),
  bot: z.enum(['cerebro', 'jarvis', 'herbie', 'sentinel', 'ultron']).optional(),
});
export type Tip = z.infer<typeof tipSchema>;
export const tipsSchema = z.array(tipSchema).min(1);

/** A per-locale list file (`<name>.<locale>.yaml`): the server's copy wins when valid. */
export function loadLocalized<T>(
  name: string,
  locale: string,
  schema: z.ZodType<T>,
  serverDir = SERVER_CONTENT_DIR,
  bundledDir = HERBIE_CONTENT_DIR,
): Loaded<T> & { bundled: T | null } {
  const file = `${name}.${locale}.yaml`;
  const bundled = readYaml(join(bundledDir, file), schema);
  const server = readYaml(join(serverDir, file), schema);
  if (server.value || server.errors.length) return { ...server, bundled: bundled.value };
  return { ...bundled, bundled: bundled.value };
}

/** Lowercase without accents, for matching. */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
