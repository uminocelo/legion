import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { type EnemyTemplate, parseEnemiesYaml, TIERS } from './domain/enemy.js';
import { ULTRON_CONTENT_DIR } from './paths.js';

export { type EnemyTemplate, enemySchema, parseEnemiesYaml, TIERS, type Tier } from './domain/enemy.js';

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
    const res = parseEnemiesYaml(readFileSync(file, 'utf8'), file.split('/').slice(-2).join('/'));
    errors.push(...res.errors);
    for (const e of res.enemies) byId.set(e.id, e);
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
