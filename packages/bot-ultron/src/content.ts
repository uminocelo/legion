import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isCanonName } from '@legion/core';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';
import { ULTRON_CONTENT_DIR } from './paths.js';

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

export const enemyFiles = (dataDir = 'data/content') => [
  `${ULTRON_CONTENT_DIR}/enemies.yaml`,
  `${dataDir}/enemies.yaml`,
];

/**
 * Reads the shipped enemies, then the server's overrides (same id replaces). Any error rejects the whole
 * set so the caller keeps the previous content.
 */
export function readEnemies(files: string[]): { enemies: EnemyTemplate[]; errors: string[] } {
  const byId = new Map<string, EnemyTemplate>();
  const errors: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const name = file.split('/').slice(-2).join('/');
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(file, 'utf8')) ?? [];
    } catch (err) {
      const pos = err instanceof YAMLParseError ? ` (linha ${err.linePos?.[0]?.line ?? 0})` : '';
      errors.push(`${name}${pos}: YAML inválido: ${(err as Error).message.split('\n')[0]}`);
      continue;
    }
    if (!Array.isArray(raw)) {
      errors.push(`${name}: o arquivo deve ser uma lista de inimigos (- id: ...)`);
      continue;
    }
    const seen = new Set<string>();
    raw.forEach((item, idx) => {
      const r = enemySchema.safeParse(item);
      const label = `${name} → item ${idx + 1}${(item as { id?: string })?.id ? ` (${(item as { id: string }).id})` : ''}`;
      if (!r.success) {
        for (const iss of r.error.issues)
          errors.push(`${label} → ${iss.path.join('.') || '?'}: ${iss.message}`);
        return;
      }
      if (seen.has(r.data.id)) errors.push(`${label}: id repetido no mesmo arquivo`);
      seen.add(r.data.id);
      byId.set(r.data.id, r.data);
    });
  }
  const enemies = [...byId.values()];
  for (const tier of TIERS) {
    const need = tier === 'minion' ? 1 : 0;
    if (enemies.filter((e) => e.tier === tier && e.minLevel === 1).length < need)
      errors.push(`é preciso pelo menos um inimigo "${tier}" com minLevel: 1`);
  }
  return { enemies, errors };
}

export const contentHash = (e: EnemyTemplate) =>
  createHash('sha256')
    .update(JSON.stringify([e.name, e.tier, e.minLevel, e.base, e.powerCooldownMax, e.tauntKeys]))
    .digest('hex');
