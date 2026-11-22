// Pack composition validation (US-23): trivia + missions + items in J.A.R.V.I.S.; enemies via injection
// so jarvis never imports ultron.
import {
  contentIssue,
  type Item,
  type Locale,
  PACK_TRIVIA_MAX,
  type PackDocument,
  parsePackDocument,
} from '@legion/core';
import { parse as parseYaml, stringify as toYaml, YAMLParseError } from 'yaml';
import { type Mission, missionSchema } from './mission.js';
import { checkTriviaItems, type TriviaQuestion } from './trivia.js';

export type ParseEnemiesFn = (
  list: unknown[],
  label: string,
) => { enemies: Array<{ id: string } & Record<string, unknown>>; errors: string[] };

export interface ValidatePackOptions {
  isCanon: (text: string) => boolean;
  /** Trivia categories (`jarvis.trivia.categories`); omit to accept any. */
  categories?: readonly string[];
  locale?: Locale;
  /** Injected enemy list validator (ultron's rules). Required when the pack has enemies. */
  parseEnemies?: ParseEnemiesFn;
  label?: string;
}

export interface ValidatedPack {
  id: string;
  name: PackDocument['name'];
  version: string;
  author: string;
  trivia: TriviaQuestion[];
  missions: Mission[];
  enemies: Array<{ id: string } & Record<string, unknown>>;
  items: Item[];
}

/** Validates a pack object end-to-end. Any section error fails the whole pack; paths are prefixed. */
export function validatePack(
  raw: unknown,
  o: ValidatePackOptions,
): { pack: ValidatedPack; errors: string[] } {
  const label = o.label ?? 'pack.yaml';
  const base = parsePackDocument(raw, o.isCanon, label);
  const errors: string[] = [...base.errors];
  const doc = base.pack;
  if (!doc.id) return { pack: emptyValidated(), errors };

  let trivia: TriviaQuestion[] = [];
  if (doc.trivia?.length) {
    if (doc.trivia.length > PACK_TRIVIA_MAX)
      errors.push(`${label} → trivia: perguntas demais (máximo ${PACK_TRIVIA_MAX} por pacote)`);
    else {
      const res = checkTriviaItems(doc.trivia, 'trivia', {
        categories: o.categories,
        locale: o.locale ?? 'pt-BR',
      });
      for (const e of res.errors) errors.push(`${label} → ${e}`);
      trivia = res.questions;
    }
  }

  const missions: Mission[] = [];
  if (doc.missions?.length) {
    doc.missions.forEach((entry, i) => {
      const id = (entry as { id?: unknown })?.id;
      const where = `missions → item ${i + 1}${typeof id === 'string' ? ` (${id})` : ''}`;
      const res = missionSchema.safeParse(entry);
      if (!res.success) {
        for (const issue of res.error.issues)
          errors.push(`${label} → ${where} → ${issue.path.join('.') || 'missão'}: ${contentIssue(issue)}`);
        return;
      }
      if (missions.some((m) => m.id === res.data.id)) {
        errors.push(`${label} → ${where} → id: "${res.data.id}" repetido no mesmo pacote`);
        return;
      }
      missions.push(res.data);
    });
  }

  let enemies: ValidatedPack['enemies'] = [];
  if (doc.enemies?.length) {
    if (o.parseEnemies) {
      const res = o.parseEnemies(doc.enemies, 'enemies');
      for (const e of res.errors) errors.push(`${label} → ${e}`);
      enemies = res.enemies;
    } else {
      // Folder load / doctor without ULTRON: keep ids; install injects the real parser.
      const seen = new Set<string>();
      doc.enemies.forEach((entry, i) => {
        const id = (entry as { id?: unknown })?.id;
        const where = `enemies → item ${i + 1}${typeof id === 'string' ? ` (${id})` : ''}`;
        if (typeof id !== 'string' || !id) {
          errors.push(`${label} → ${where} → id: obrigatório`);
          return;
        }
        if (seen.has(id)) {
          errors.push(`${label} → ${where}: id repetido no mesmo pacote`);
          return;
        }
        seen.add(id);
        enemies.push({ ...(entry as object), id });
      });
    }
  }

  if (errors.length) return { pack: emptyValidated(), errors };

  return {
    pack: {
      id: doc.id,
      name: doc.name,
      version: doc.version,
      author: doc.author,
      trivia,
      missions,
      enemies,
      items: doc.items ?? [],
    },
    errors: [],
  };
}

/** Parses pack YAML text then validates composition. */
export function validatePackYaml(
  text: string,
  o: ValidatePackOptions,
): { pack: ValidatedPack; errors: string[] } {
  const label = o.label ?? 'pack.yaml';
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    const pos = err instanceof YAMLParseError ? ` (linha ${err.linePos?.[0]?.line ?? 0})` : '';
    return {
      pack: emptyValidated(),
      errors: [`${label}${pos}: YAML inválido: ${(err as Error).message.split('\n')[0]}`],
    };
  }
  return validatePack(raw, o);
}

function emptyValidated(): ValidatedPack {
  return {
    id: '',
    name: { 'pt-BR': '' },
    version: '0.0.0',
    author: '',
    trivia: [],
    missions: [],
    enemies: [],
    items: [],
  };
}

/** Builds YAML for an enemies list so callers can reuse `parseEnemiesYaml(text, label)`. */
export const enemiesListYaml = (list: unknown[]): string => toYaml(list);
