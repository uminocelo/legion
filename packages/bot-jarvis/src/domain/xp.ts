import type { Rank } from '@legion/core';
import { addDays } from '@legion/core';
import type { Difficulty, JarvisConfig } from '../config.js';

export type XpReason = 'trivia' | 'streak_bonus' | 'grant' | 'admin_adjust';

export interface TriviaScoreInput {
  correct: boolean;
  expired: boolean;
  difficulty: Difficulty;
  remainingMs: number;
  limitMs: number;
  /** Trivia XP already earned today (local day). */
  earnedToday: number;
}
export interface TriviaScore {
  /** XP actually awarded (after the daily cap). */
  xp: number;
  /** XP the answer was worth before the cap. */
  raw: number;
  capped: boolean;
}

/** Pure scoring: base by difficulty + speed bonus, clipped by the daily trivia cap. */
export function scoreTrivia(i: TriviaScoreInput, cfg: JarvisConfig['trivia']): TriviaScore {
  if (!i.correct || i.expired) return { xp: 0, raw: 0, capped: false };
  const remaining = Math.min(Math.max(i.remainingMs, 0), i.limitMs);
  const speed = i.limitMs > 0 ? Math.floor((cfg.speedBonusMax * remaining) / i.limitMs) : 0;
  const raw = cfg.baseXp[i.difficulty] + speed;
  const room = Math.max(0, cfg.dailyXpCap - i.earnedToday);
  const xp = Math.min(raw, room);
  return { xp, raw, capped: xp < raw };
}

/** level = min(maxLevel, floor(sqrt(xp / levelFactor)) + 1); negative XP counts as 0. */
export function levelFor(xp: number, cfg: JarvisConfig['levels']): number {
  return Math.min(cfg.maxLevel, Math.floor(Math.sqrt(Math.max(0, xp) / cfg.levelFactor)) + 1);
}

/** Total XP needed to reach a level (inverse of the curve). */
export function xpForLevel(level: number, cfg: JarvisConfig['levels']): number {
  return (level - 1) ** 2 * cfg.levelFactor;
}

export function rankFor(xp: number, ranks: JarvisConfig['ranks']): Rank {
  if (xp >= ranks.veterano) return 'veterano';
  if (xp >= ranks.agente) return 'agente';
  return 'recruta';
}

export interface StreakState {
  currentStreak: number;
  bestStreak: number;
  lastActiveDay: string | null;
}

/** Reasons that make a day "active" for streaks. */
export const countsForStreak = (reason: XpReason) => reason !== 'streak_bonus' && reason !== 'admin_adjust';

/**
 * Applies an active day. Returns null when the day was already counted (or is older than the last
 * active day), otherwise the new state and the bonus for that day.
 */
export function advanceStreak(
  s: StreakState,
  day: string,
  cfg: JarvisConfig['streak'],
): { state: StreakState; bonus: number } | null {
  if (s.lastActiveDay !== null && day <= s.lastActiveDay) return null;
  const current = s.lastActiveDay === addDays(day, -1) ? s.currentStreak + 1 : 1;
  return {
    state: { currentStreak: current, bestStreak: Math.max(s.bestStreak, current), lastActiveDay: day },
    bonus: Math.min(current, cfg.bonusCap) * cfg.bonusPerDay,
  };
}

/** Streak as shown to members: it lapses lazily once a full day is missed (no nightly job). */
export function displayedStreak(s: StreakState, today: string): number {
  if (!s.lastActiveDay) return 0;
  return s.lastActiveDay === today || s.lastActiveDay === addDays(today, -1) ? s.currentStreak : 0;
}

/** A text progress bar such as `▰▰▰▱▱▱▱▱▱▱`. */
export function progressBar(xp: number, cfg: JarvisConfig['levels'], width = 10): string {
  const level = levelFor(xp, cfg);
  if (level >= cfg.maxLevel) return '▰'.repeat(width);
  const from = xpForLevel(level, cfg);
  const to = xpForLevel(level + 1, cfg);
  const filled = Math.max(0, Math.min(width, Math.floor(((xp - from) / (to - from)) * width)));
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}
