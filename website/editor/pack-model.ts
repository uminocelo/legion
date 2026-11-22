// Content pack drafts ↔ pack.yaml for `/jarvis pack importar` or `data/content/packs/<id>/`.
import { isCanonName, parsePackDocument } from '@legion/core';
import { parse, stringify, YAMLParseError } from 'yaml';
import { enemiesListYaml, validatePack } from '../../packages/bot-jarvis/src/domain/pack.js';
import { parseEnemiesYaml } from '../../packages/bot-ultron/src/domain/enemy.js';
import { DEFAULT_CATEGORIES } from './trivia-model.js';

export const PACK_FILE = 'pack.yaml';
export { DEFAULT_CATEGORIES };

export interface PackDraft {
  id: string;
  namePt: string;
  nameEn: string;
  version: string;
  author: string;
  /** Optional YAML lists (same shapes as the per-type editors). */
  triviaYaml: string;
  missionsYaml: string;
  enemiesYaml: string;
  itemsYaml: string;
}

export const emptyPack = (): PackDraft => ({
  id: 'meu-pack',
  namePt: 'Meu pacote',
  nameEn: '',
  version: '1.0.0',
  author: '',
  triviaYaml: '',
  missionsYaml: '',
  enemiesYaml: '',
  itemsYaml: '',
});

type Section = 'trivia' | 'missions' | 'enemies' | 'items';

function parseListYaml(text: string, label: Section): { list: unknown[]; errors: string[] } {
  const trimmed = text.trim();
  if (!trimmed) return { list: [], errors: [] };
  try {
    const raw = parse(trimmed);
    if (!Array.isArray(raw))
      return { list: [], errors: [`${PACK_FILE} → ${label}: deve ser uma lista YAML (- id: ...)`] };
    return { list: raw, errors: [] };
  } catch (err) {
    const pos = err instanceof YAMLParseError ? ` (linha ${err.linePos?.[0]?.line ?? 0})` : '';
    return {
      list: [],
      errors: [`${PACK_FILE} → ${label}${pos}: YAML inválido: ${(err as Error).message.split('\n')[0]}`],
    };
  }
}

const sections = (d: PackDraft): { label: Section; yaml: string }[] => [
  { label: 'trivia', yaml: d.triviaYaml },
  { label: 'missions', yaml: d.missionsYaml },
  { label: 'enemies', yaml: d.enemiesYaml },
  { label: 'items', yaml: d.itemsYaml },
];

/** Builds the pack object from metadata + section YAML lists. Section parse errors are separate. */
export function toObject(d: PackDraft): {
  pack: Record<string, unknown>;
  errors: string[];
} {
  const errors: string[] = [];
  const lists: Partial<Record<Section, unknown[]>> = {};
  for (const { label, yaml } of sections(d)) {
    const res = parseListYaml(yaml, label);
    errors.push(...res.errors);
    if (res.list.length) lists[label] = res.list;
  }
  const pack: Record<string, unknown> = {
    id: d.id.trim(),
    name: {
      'pt-BR': d.namePt.trim(),
      ...(d.nameEn.trim() ? { en: d.nameEn.trim() } : {}),
    },
    version: d.version.trim(),
    author: d.author.trim(),
    ...(lists.trivia ? { trivia: lists.trivia } : {}),
    ...(lists.missions ? { missions: lists.missions } : {}),
    ...(lists.enemies ? { enemies: lists.enemies } : {}),
    ...(lists.items ? { items: lists.items } : {}),
  };
  return { pack, errors };
}

const parseEnemies = (list: unknown[], label: string) => {
  const res = parseEnemiesYaml(enemiesListYaml(list), label);
  return { enemies: res.enemies, errors: res.errors };
};

/** Same composition rules as the bot (`validatePack` + shared pack manifest). */
export function validate(d: PackDraft, categories: readonly string[] = DEFAULT_CATEGORIES): string[] {
  const { pack, errors: sectionErrors } = toObject(d);
  if (sectionErrors.length) return sectionErrors;
  const res = validatePack(pack, {
    isCanon: isCanonName,
    categories,
    locale: 'pt-BR',
    parseEnemies,
    label: PACK_FILE,
  });
  return res.errors;
}

export function toYaml(d: PackDraft): string {
  const { pack } = toObject(d);
  const header =
    '# Pacote de conteúdo do Legion. Importe com /jarvis pack importar (anexe este arquivo)\n' +
    '# ou coloque em data/content/packs/<id>/pack.yaml e reinicie.\n';
  return header + stringify(pack);
}

/** Opens an existing pack.yaml as a draft (lenient). */
export function fromYaml(text: string): PackDraft {
  const raw = parse(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('o arquivo deve ser um objeto de pacote (id, name, version, author...)');
  const o = raw as Record<string, unknown>;
  const name = o.name && typeof o.name === 'object' ? (o.name as Record<string, unknown>) : {};
  const listYaml = (v: unknown) => (Array.isArray(v) && v.length ? stringify(v) : '');
  return {
    id: typeof o.id === 'string' ? o.id : '',
    namePt: typeof name['pt-BR'] === 'string' ? name['pt-BR'] : '',
    nameEn: typeof name.en === 'string' ? name.en : '',
    version: typeof o.version === 'string' ? o.version : '1.0.0',
    author: typeof o.author === 'string' ? o.author : '',
    triviaYaml: listYaml(o.trivia),
    missionsYaml: listYaml(o.missions),
    enemiesYaml: listYaml(o.enemies),
    itemsYaml: listYaml(o.items),
  };
}

/** Manifest-only check (no nested composition) — useful for quick metadata feedback. */
export function validateManifest(d: PackDraft): string[] {
  const { pack, errors } = toObject(d);
  if (errors.length) return errors;
  return parsePackDocument(pack, isCanonName, PACK_FILE).errors;
}
