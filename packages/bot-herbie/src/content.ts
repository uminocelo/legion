import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
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
