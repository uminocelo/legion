import { type Combatant, mulberry32 } from '@legion/core';
import type { Difficulty } from '../config.js';
import type { EnemyTemplate } from '../content.js';

export interface ScalingConfig {
  growth: number;
  difficultyMultiplier: Record<Difficulty, number>;
}

export interface EncounterInput {
  encounterId: string;
  partyLevel: number;
  partySize: number;
  difficulty: Difficulty;
  templates: EnemyTemplate[];
  seed: number;
  adaptiveMultiplier?: number;
}

type Stats = Combatant['stats'];
const KEYS = ['hp', 'atk', 'def', 'spd', 'foc'] as const;

/** stat = floor(base * (1 + growth*(L-1)) * difficulty * adaptive); hp at least 1, others at least 1 too. */
export function scaleStats(
  base: Stats,
  level: number,
  difficulty: Difficulty,
  cfg: ScalingConfig,
  adaptive = 1,
): Stats {
  const f = (1 + cfg.growth * (level - 1)) * cfg.difficultyMultiplier[difficulty] * adaptive;
  const out = {} as Stats;
  for (const k of KEYS) out[k] = Math.max(1, Math.floor(base[k] * f));
  return out;
}

/** How many minions and elites a party meets. */
export function composition(partyLevel: number, partySize: number, difficulty: Difficulty) {
  const n = Math.min(4, Math.max(1, partySize));
  return {
    minions: n + (difficulty === 'dificil' ? 1 : 0),
    elites: partyLevel >= 5 && difficulty !== 'facil' ? 1 : 0,
  };
}

/** Pure: same input → same enemies. Templates are picked with mulberry32(seed): minions first, then the elite. */
export function buildEnemies(input: EncounterInput, cfg: ScalingConfig): Combatant[] {
  const L = input.partyLevel;
  const rng = mulberry32(input.seed);
  const pool = (tier: EnemyTemplate['tier']) =>
    input.templates
      .filter((t) => t.tier === tier && t.minLevel <= L)
      .sort((a, b) => a.id.localeCompare(b.id));
  const c = composition(L, input.partySize, input.difficulty);
  const picks: EnemyTemplate[] = [];
  const minions = pool('minion');
  const elites = pool('elite');
  if (minions.length === 0) throw new Error(`no minion template available for level ${L}`);
  for (let i = 0; i < c.minions; i++) picks.push(minions[rng.d(minions.length) - 1] as EnemyTemplate);
  if (c.elites && elites.length) picks.push(elites[rng.d(elites.length) - 1] as EnemyTemplate);
  return picks.map((t, i) => ({
    id: `enemy:${input.encounterId}:${i}`,
    side: 'enemies',
    kind: 'enemy',
    refId: t.id,
    name: t.name,
    archetype: null,
    level: L,
    stats: scaleStats(t.base, L, input.difficulty, cfg, input.adaptiveMultiplier ?? 1),
    powerCooldown: 0,
  }));
}

export interface AdaptiveConfig {
  minSample: number;
  target: number;
  maxAdjust: number;
}

/** 1 + clamp((winRate − target) * 0.5, ±maxAdjust); draws count half; below minSample → 1. */
export function adaptiveMultiplier(
  outcomes: ('players' | 'enemies' | 'draw')[],
  cfg: AdaptiveConfig,
): number {
  if (outcomes.length < cfg.minSample || outcomes.length === 0) return 1;
  const wins = outcomes.reduce((a, o) => a + (o === 'players' ? 1 : o === 'draw' ? 0.5 : 0), 0);
  const adj = (wins / outcomes.length - cfg.target) * 0.5;
  const clamped = Math.min(cfg.maxAdjust, Math.max(-cfg.maxAdjust, adj));
  return Math.round((1 + clamped) * 10_000) / 10_000;
}
