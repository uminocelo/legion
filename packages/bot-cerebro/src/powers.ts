import { existsSync, readFileSync } from 'node:fs';
import { type Archetype, isCanonName, type Locale, ORIGINS } from '@legion/core';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';
import { CEREBRO_CONTENT_DIR } from './paths.js';

export const POWER_TYPES = ['offensive', 'defensive', 'psionic', 'elemental', 'movement', 'utility'] as const;
export type PowerType = (typeof POWER_TYPES)[number];

const canonMsg = 'nome de personagem existente; use um nome genérico';
const name = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .refine((n) => !isCanonName(n), canonMsg);
const text = z.string().trim().min(2).max(100);

export const powerSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'id: letras minúsculas, números e "-" (2 a 40)'),
    type: z.enum(POWER_TYPES),
    name: z.object({ 'pt-BR': name, en: name.optional() }).strict(),
    description: z.object({ 'pt-BR': text, en: text.optional() }).strict(),
    /** Origins that may pick this power; absent = every origin. */
    origins: z
      .array(z.enum(ORIGINS, { message: `origem desconhecida; use: ${ORIGINS.join(', ')}` }))
      .min(1)
      .optional(),
  })
  .strict();
export type Power = z.infer<typeof powerSchema>;

/** Shipped catalog, then the server's file (same id replaces). */
export const powerFiles = (dataDir = 'data/content') => [
  `${CEREBRO_CONTENT_DIR}/powers.yaml`,
  `${dataDir}/powers.yaml`,
];

export function readPowers(files: string[]): { powers: Power[]; errors: string[] } {
  const byId = new Map<string, Power>();
  const errors: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const label = file.split('/').slice(-2).join('/');
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(file, 'utf8')) ?? [];
    } catch (err) {
      const pos = err instanceof YAMLParseError ? ` (linha ${err.linePos?.[0]?.line ?? 0})` : '';
      errors.push(`${label}${pos}: YAML inválido: ${(err as Error).message.split('\n')[0]}`);
      continue;
    }
    if (!Array.isArray(raw)) {
      errors.push(`${label}: o arquivo deve ser uma lista de poderes (- id: ...)`);
      continue;
    }
    const seen = new Set<string>();
    raw.forEach((item, idx) => {
      const id = (item as { id?: unknown })?.id;
      const where = `${label} → item ${idx + 1}${typeof id === 'string' ? ` (${id})` : ''}`;
      const r = powerSchema.safeParse(item);
      if (!r.success) {
        for (const iss of r.error.issues)
          errors.push(`${where} → ${iss.path.join('.') || '?'}: ${iss.message}`);
        return;
      }
      if (seen.has(r.data.id)) errors.push(`${where}: id repetido no mesmo arquivo`);
      seen.add(r.data.id);
      byId.set(r.data.id, r.data);
    });
  }
  return { powers: [...byId.values()], errors };
}

/** A power without `origins` is open to every origin. */
export const allowsOrigin = (p: Power, origin: string) => !p.origins || p.origins.includes(origin as never);

export const powerName = (p: Power, l?: Locale) =>
  l === 'en' ? (p.name.en ?? p.name['pt-BR']) : p.name['pt-BR'];
export const powerDescription = (p: Power, l?: Locale) =>
  l === 'en' ? (p.description.en ?? p.description['pt-BR']) : p.description['pt-BR'];

/**
 * The power catalog in memory. A load with errors keeps the previous catalog (or the shipped one on
 * the first load), so a bad server file never empties registration.
 */
export class PowerCatalog {
  private list: Power[] = [];
  lastErrors: string[] = [];

  constructor(
    private readonly typeToArchetype: Record<PowerType, Archetype>,
    private readonly allowed: readonly Archetype[],
  ) {}

  load(files = powerFiles()): { total: number; errors: string[] } {
    const res = readPowers(files);
    this.lastErrors = res.errors;
    if (!res.errors.length) this.list = res.powers;
    else if (!this.list.length) this.list = readPowers(files.slice(0, 1)).powers;
    return { total: this.list.length, errors: res.errors };
  }

  /** Powers whose archetype is enabled in `cerebro.archetypes` (and open to `origin`, when given). */
  all(origin?: string): Power[] {
    return this.list.filter(
      (p) => this.allowed.includes(this.archetypeOf(p)) && (!origin || allowsOrigin(p, origin)),
    );
  }
  forOrigin(origin: string): Power[] {
    return this.all(origin);
  }
  get(id: string, origin?: string): Power | undefined {
    return this.all(origin).find((p) => p.id === id);
  }
  /** Origins (of `keys`) that have no power at all; they are hidden from registration. */
  emptyOrigins(keys: readonly string[]): string[] {
    return keys.filter((k) => this.forOrigin(k).length === 0);
  }
  archetypeOf(p: Power): Archetype {
    return this.typeToArchetype[p.type];
  }
  /** Powers split into select menus of whole types, each at most 25 options. */
  groups(exclude: string[] = [], origin?: string): Power[][] {
    const out: Power[][] = [];
    let cur: Power[] = [];
    for (const type of POWER_TYPES) {
      const ofType = this.all(origin).filter((p) => p.type === type && !exclude.includes(p.id));
      if (cur.length + ofType.length > 25 && cur.length) {
        out.push(cur);
        cur = [];
      }
      cur.push(...ofType.slice(0, 25));
    }
    if (cur.length) out.push(cur);
    return out;
  }
}
