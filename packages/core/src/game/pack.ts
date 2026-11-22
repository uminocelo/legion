// Content pack manifest (US-23): shared by J.A.R.V.I.S., `legion content validate` and the website.
// No Node APIs. Nested trivia / missions / enemies are validated by the bots; items reuse parseItemsYaml.
import { stringify as toYaml } from 'yaml';
import { z } from 'zod';
import { contentIssues } from './content-issues.js';
import { ITEMS_PER_FILE, type Item, parseItemsYaml } from './item.js';

export const PACK_ID_RE = /^[a-z0-9-]{3,48}$/;
/** Major.minor.patch, optional prerelease / build (semver subset). */
export const PACK_SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const PACK_TRIVIA_MAX = 50;
export const PACK_ITEMS_MAX = ITEMS_PER_FILE;

const packName = z.string().trim().min(1).max(80);

export const packManifestSchema = z
  .object({
    id: z.string().regex(PACK_ID_RE, 'use letras minúsculas, números e "-" (3 a 48)'),
    name: z.object({ 'pt-BR': packName, en: packName.optional() }).strict(),
    version: z.string().regex(PACK_SEMVER_RE, 'use semver (ex.: 1.0.0)'),
    author: z.string().trim().min(1).max(80),
    trivia: z.array(z.unknown()).optional(),
    missions: z.array(z.unknown()).optional(),
    enemies: z.array(z.unknown()).optional(),
    items: z.array(z.unknown()).optional(),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const sections = [pack.trivia, pack.missions, pack.enemies, pack.items].filter(
      (s) => Array.isArray(s) && s.length > 0,
    );
    if (!sections.length)
      ctx.addIssue({
        code: 'custom',
        message: 'pacote vazio: inclua trivia, missions, enemies ou items',
      });
  });

export type PackManifest = z.infer<typeof packManifestSchema>;

export interface PackDocument {
  id: string;
  name: { 'pt-BR': string; en?: string };
  version: string;
  author: string;
  trivia?: unknown[];
  missions?: unknown[];
  enemies?: unknown[];
  items?: Item[];
}

/** Compares two semver strings (major.minor.patch; prerelease sorts below the plain release). */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): { maj: number; min: number; pat: number; pre: string } => {
    const [core] = v.split('+');
    const [nums, pre] = (core ?? '').split('-');
    const parts = (nums ?? '').split('.').map((n) => Number(n) || 0);
    return { maj: parts[0] ?? 0, min: parts[1] ?? 0, pat: parts[2] ?? 0, pre: pre ?? '' };
  };
  const x = parse(a);
  const y = parse(b);
  if (x.maj !== y.maj) return x.maj - y.maj;
  if (x.min !== y.min) return x.min - y.min;
  if (x.pat !== y.pat) return x.pat - y.pat;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : x.pre > y.pre ? 1 : 0;
}

export const isSemver = (v: string): boolean => PACK_SEMVER_RE.test(v);

/**
 * Validates a parsed pack document (object). Items are checked with the same rules as item files.
 * Trivia / missions / enemies stay as lists for the composition validator.
 */
export function parsePackDocument(
  raw: unknown,
  isCanon: (text: string) => boolean,
  label = 'pack.yaml',
): { pack: PackDocument; errors: string[] } {
  const errors: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return { pack: emptyPack(), errors: [`${label}: o arquivo deve ser um objeto de pacote`] };

  const res = packManifestSchema.safeParse(raw);
  if (!res.success) {
    return {
      pack: emptyPack(),
      errors: contentIssues(res.error.issues, label).map((e) => `${label} → ${e}`),
    };
  }

  const m = res.data;
  let items: Item[] | undefined;
  if (m.items?.length) {
    if (m.items.length > PACK_ITEMS_MAX)
      errors.push(`${label} → items: itens demais (máximo ${PACK_ITEMS_MAX} por pacote)`);
    else {
      const parsed = parseItemsYaml(toYaml(m.items), 'items', isCanon);
      for (const e of parsed.errors) errors.push(`${label} → ${e}`);
      if (!parsed.errors.length) items = parsed.items;
    }
  }

  if (m.trivia && m.trivia.length > PACK_TRIVIA_MAX)
    errors.push(`${label} → trivia: perguntas demais (máximo ${PACK_TRIVIA_MAX} por pacote)`);

  // Return the manifest even when nested content failed, so composition can list every section error.
  return {
    pack: {
      id: m.id,
      name: m.name,
      version: m.version,
      author: m.author,
      trivia: m.trivia,
      missions: m.missions,
      enemies: m.enemies,
      items,
    },
    errors,
  };
}

function emptyPack(): PackDocument {
  return { id: '', name: { 'pt-BR': '' }, version: '0.0.0', author: '' };
}

/** True when a document looks like a content pack (for `legion content validate` detection). */
export function looksLikePack(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.version !== 'string' || typeof o.author !== 'string') return false;
  return (
    Array.isArray(o.trivia) || Array.isArray(o.missions) || Array.isArray(o.enemies) || Array.isArray(o.items)
  );
}
