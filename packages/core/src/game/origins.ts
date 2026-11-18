/**
 * Hero origins (v0.9, ADR 0031). Identity and flavour only: combat stats still come from the
 * archetype and level. Order = menu order. Names and descriptions live in Cérebro's locales.
 */
export const ORIGINS = [
  'mutante',
  'inumano',
  'ciencia',
  'tecnologia',
  'mistico',
  'cosmico',
  'treinado',
] as const;
export type Origin = (typeof ORIGINS)[number];

export const ORIGIN_EMOJI: Record<Origin, string> = {
  mutante: '🧬',
  inumano: '💠',
  ciencia: '⚗️',
  tecnologia: '🤖',
  mistico: '🔮',
  cosmico: '🌌',
  treinado: '🥋',
};

/** Heroes created before origins existed are Mutante. */
export const DEFAULT_ORIGIN: Origin = 'mutante';

export const isOrigin = (v: unknown): v is Origin =>
  typeof v === 'string' && (ORIGINS as readonly string[]).includes(v);
