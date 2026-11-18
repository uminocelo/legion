// Enemy format and validation, with no Node APIs: used by the bot (content files and
// `/ultron inimigo importar`) and by the website editor, so both report the same errors.
import { contentIssue, isCanonName } from '@legion/core';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';

export const TIERS = ['minion', 'elite', 'boss'] as const;
export type Tier = (typeof TIERS)[number];

const stat = z.number().int().min(0).max(5000);
export const enemySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'use letras minúsculas, números e "-" (2-41)'),
    name: z
      .string()
      .min(2)
      .max(60)
      .refine((n) => !isCanonName(n), 'nome de personagem existente; use um nome original'),
    tier: z.enum(TIERS),
    minLevel: z.number().int().min(1).max(100),
    base: z.object({ hp: stat, atk: stat.min(1), def: stat.min(1), spd: stat.min(1), foc: stat.min(1) }),
    powerCooldownMax: z.number().int().min(1).max(10),
    tauntKeys: z.array(z.string().min(1)).default([]),
  })
  .refine((e) => e.tier === 'boss' || e.base.hp >= 1, {
    path: ['base', 'hp'],
    message: 'hp deve ser ≥ 1 (só chefes usam 0)',
  });

export type EnemyTemplate = z.infer<typeof enemySchema>;

/** Parses one enemy list (a file or an attachment). Errors carry the YAML line or the field path. */
export function parseEnemiesYaml(text: string, name: string): { enemies: EnemyTemplate[]; errors: string[] } {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = parseYaml(text) ?? [];
  } catch (err) {
    const pos = err instanceof YAMLParseError ? ` (linha ${err.linePos?.[0]?.line ?? 0})` : '';
    return {
      enemies: [],
      errors: [`${name}${pos}: YAML inválido: ${(err as Error).message.split('\n')[0]}`],
    };
  }
  if (!Array.isArray(raw))
    return { enemies: [], errors: [`${name}: o arquivo deve ser uma lista de inimigos (- id: ...)`] };
  const enemies: EnemyTemplate[] = [];
  const seen = new Set<string>();
  raw.forEach((item, idx) => {
    const r = enemySchema.safeParse(item);
    const label = `${name} → item ${idx + 1}${(item as { id?: string })?.id ? ` (${(item as { id: string }).id})` : ''}`;
    if (!r.success) {
      for (const iss of r.error.issues)
        errors.push(`${label} → ${iss.path.join('.') || '?'}: ${contentIssue(iss)}`);
      return;
    }
    if (seen.has(r.data.id)) errors.push(`${label}: id repetido no mesmo arquivo`);
    seen.add(r.data.id);
    enemies.push(r.data);
  });
  return { enemies, errors };
}
