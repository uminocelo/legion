// ULTRON enemy drafts ↔ YAML, validated by the bot's own parser (`/ultron inimigo importar`).
import { parse, stringify } from 'yaml';
import { parseEnemiesYaml, TIERS } from '../../packages/bot-ultron/src/domain/enemy.js';

export { TIERS };
export const ENEMY_FILE = 'inimigos.yaml';
export const STATS = ['hp', 'atk', 'def', 'spd', 'foc'] as const;
export type Stat = (typeof STATS)[number];

export interface EnemyDraft {
  id: string;
  name: string;
  tier: string;
  minLevel: number;
  base: Record<Stat, number>;
  powerCooldownMax: number;
  /** Taunt text keys of the bot's locales (kept from opened files; new enemies use the generic lines). */
  tauntKeys: string[];
}

/** Starting stats per tier, in the range of the shipped enemies. */
export const TIER_DEFAULTS: Record<string, Record<Stat, number>> = {
  minion: { hp: 60, atk: 8, def: 5, spd: 9, foc: 6 },
  elite: { hp: 140, atk: 13, def: 10, spd: 9, foc: 9 },
  boss: { hp: 0, atk: 18, def: 14, spd: 8, foc: 12 },
};

export const emptyEnemy = (drafts: readonly EnemyDraft[]): EnemyDraft => {
  const used = new Set(drafts.map((d) => d.id));
  let n = drafts.length + 1;
  while (used.has(`inimigo-${n}`)) n++;
  return {
    id: `inimigo-${n}`,
    name: '',
    tier: 'minion',
    minLevel: 1,
    base: { ...TIER_DEFAULTS.minion } as Record<Stat, number>,
    powerCooldownMax: 4,
    tauntKeys: [],
  };
};

export function toItems(drafts: readonly EnemyDraft[]) {
  return drafts.map((d) => ({
    id: d.id.trim(),
    name: d.name.trim(),
    tier: d.tier,
    minLevel: d.minLevel,
    base: { ...d.base },
    powerCooldownMax: d.powerCooldownMax,
    ...(d.tauntKeys.length ? { tauntKeys: [...d.tauntKeys] } : {}),
  }));
}

export function toYaml(drafts: readonly EnemyDraft[]): string {
  const header =
    '# Inimigos do ULTRON (todos originais). Importe com /ultron inimigo importar (anexe este arquivo).\n';
  return header + stringify(toItems(drafts));
}

export function validate(yaml: string): string[] {
  const res = parseEnemiesYaml(yaml, ENEMY_FILE);
  if (!res.errors.length && !res.enemies.length) return [`${ENEMY_FILE}: nenhum inimigo`];
  return res.errors;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function fromYaml(text: string): EnemyDraft[] {
  const raw = parse(text);
  if (!Array.isArray(raw)) throw new Error('o arquivo deve ser uma lista de inimigos (- id: ...)');
  return raw.map((x: Record<string, unknown>) => {
    const tier = typeof x.tier === 'string' ? x.tier : 'minion';
    const def = TIER_DEFAULTS[tier] ?? TIER_DEFAULTS.minion;
    const base = (x.base ?? {}) as Record<string, unknown>;
    return {
      id: typeof x.id === 'string' ? x.id : '',
      name: typeof x.name === 'string' ? x.name : '',
      tier,
      minLevel: num(x.minLevel, 1),
      base: Object.fromEntries(STATS.map((s) => [s, num(base[s], def?.[s] ?? 1)])) as Record<Stat, number>,
      powerCooldownMax: num(x.powerCooldownMax, 4),
      tauntKeys: Array.isArray(x.tauntKeys)
        ? x.tauntKeys.filter((k): k is string => typeof k === 'string')
        : [],
    };
  });
}
