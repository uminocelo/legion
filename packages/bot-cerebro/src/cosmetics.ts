import type { Locale } from '@legion/core';

export const COSMETIC_KINDS = ['frame', 'title'] as const;
export type CosmeticKind = (typeof COSMETIC_KINDS)[number];

/** Optional SVG hints for the profile card renderer. Never stats. */
export interface CosmeticVisual {
  /** Border stroke for frames (`#RRGGBB`). */
  stroke?: string;
  /** Accent for frame corners or title underline (`#RRGGBB`). */
  accent?: string;
  /** Text fill for titles (`#RRGGBB`). */
  fill?: string;
}

/**
 * A supporter cosmetic entry. The type has no bonus/stats fields on purpose (US-24 / F9).
 * Labels are localized; `visual` is optional renderer hints only.
 */
export interface Cosmetic {
  id: string;
  kind: CosmeticKind;
  label: { 'pt-BR': string; en?: string };
  visual?: CosmeticVisual;
}

/** Fixed catalog — frames and titles with zero gameplay effect. */
export const SUPPORTER_COSMETICS: readonly Cosmetic[] = [
  {
    id: 'frame-aurora',
    kind: 'frame',
    label: { 'pt-BR': 'Aurora', en: 'Aurora' },
    visual: { stroke: '#A78BFA', accent: '#C4B5FD' },
  },
  {
    id: 'frame-ember',
    kind: 'frame',
    label: { 'pt-BR': 'Brasa', en: 'Ember' },
    visual: { stroke: '#F97316', accent: '#FDBA74' },
  },
  {
    id: 'frame-void',
    kind: 'frame',
    label: { 'pt-BR': 'Vazio', en: 'Void' },
    visual: { stroke: '#64748B', accent: '#94A3B8' },
  },
  {
    id: 'title-sentinel',
    kind: 'title',
    label: { 'pt-BR': 'Sentinela', en: 'Sentinel' },
    visual: { fill: '#E2E8F0', accent: '#38BDF8' },
  },
  {
    id: 'title-patron',
    kind: 'title',
    label: { 'pt-BR': 'Patrono', en: 'Patron' },
    visual: { fill: '#FDE68A', accent: '#FBBF24' },
  },
  {
    id: 'title-legend',
    kind: 'title',
    label: { 'pt-BR': 'Lenda Viva', en: 'Living Legend' },
    visual: { fill: '#F9A8D4', accent: '#EC4899' },
  },
] as const;

const byId = new Map(SUPPORTER_COSMETICS.map((c) => [c.id, c]));

export const frames = (): Cosmetic[] => SUPPORTER_COSMETICS.filter((c) => c.kind === 'frame');
export const titles = (): Cosmetic[] => SUPPORTER_COSMETICS.filter((c) => c.kind === 'title');

/** Catalog entry for a stable id, or null when unknown. */
export const cosmeticById = (id: string | null | undefined): Cosmetic | null =>
  id ? (byId.get(id) ?? null) : null;

/** Unknown or empty ids become null (none). */
export const resolveCosmeticId = (id: string | null | undefined, kind?: CosmeticKind): string | null => {
  const c = cosmeticById(id);
  if (!c) return null;
  if (kind && c.kind !== kind) return null;
  return c.id;
};

export const cosmeticLabel = (c: Cosmetic, locale?: Locale): string =>
  locale === 'en' ? (c.label.en ?? c.label['pt-BR']) : c.label['pt-BR'];

/** Keys that must never appear on a supporter cosmetic (unit-tested). */
export const FORBIDDEN_COSMETIC_STAT_KEYS = [
  'bonus',
  'stats',
  'stat',
  'hp',
  'atk',
  'def',
  'spd',
  'foc',
] as const;
