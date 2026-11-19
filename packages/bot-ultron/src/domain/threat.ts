import type { Difficulty } from '../config.js';

export const THREAT_MAX = 100;
/** Threat at or above these values: 2 waves, then 3 waves on difícil. */
export const THREAT_THRESHOLDS = { medium: 34, high: 67 } as const;
/** At most this many missed days are applied when the daily job catches up. */
export const THREAT_CATCH_UP_DAYS = 7;

export type ThreatBand = 'low' | 'medium' | 'high';

export function threatBand(level: number): ThreatBand {
  if (level >= THREAT_THRESHOLDS.high) return 'high';
  if (level >= THREAT_THRESHOLDS.medium) return 'medium';
  return 'low';
}

/** Waves and difficulty of the next invasion for a threat level. */
export function invasionSize(level: number): { waves: number; difficulty: Difficulty } {
  const band = threatBand(level);
  if (band === 'high') return { waves: 3, difficulty: 'dificil' };
  return { waves: band === 'medium' ? 2 : 1, difficulty: 'normal' };
}

/** One day of the threat meter: an active day lowers it, a quiet one raises it. Clamped to 0–100. */
export function tickThreat(
  level: number,
  activity: number,
  cfg: { idleRise: number; activeFall: number; activeActions: number },
): number {
  const next = activity >= cfg.activeActions ? level - cfg.activeFall : level + cfg.idleRise;
  return Math.max(0, Math.min(THREAT_MAX, next));
}

/** HP of the next wave: the previous wave's HP plus `growth`. */
export function nextWaveHp(maxHp: number, growth: number): number {
  return Math.max(1, Math.round(maxHp * (1 + growth)));
}
