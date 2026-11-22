import { describe, expect, it } from 'vitest';
import {
  type Cosmetic,
  cosmeticById,
  FORBIDDEN_COSMETIC_STAT_KEYS,
  frames,
  resolveCosmeticId,
  SUPPORTER_COSMETICS,
  titles,
} from '../src/cosmetics.js';

describe('supporter cosmetic catalog (US-24)', () => {
  it('ships frames and titles with stable ids and localized labels', () => {
    expect(frames().length).toBeGreaterThanOrEqual(2);
    expect(titles().length).toBeGreaterThanOrEqual(2);
    for (const c of SUPPORTER_COSMETICS) {
      expect(c.id).toMatch(/^(frame|title)-[a-z0-9-]+$/);
      expect(c.label['pt-BR'].trim().length).toBeGreaterThan(0);
      expect((c.label.en ?? c.label['pt-BR']).trim().length).toBeGreaterThan(0);
    }
  });

  it('every catalog entry has no stats or bonus fields', () => {
    for (const c of SUPPORTER_COSMETICS) {
      const keys = Object.keys(c);
      for (const forbidden of FORBIDDEN_COSMETIC_STAT_KEYS) {
        expect(keys, `${c.id} must not have ${forbidden}`).not.toContain(forbidden);
      }
      const visualKeys = c.visual ? Object.keys(c.visual) : [];
      for (const forbidden of FORBIDDEN_COSMETIC_STAT_KEYS) {
        expect(visualKeys, `${c.id}.visual must not have ${forbidden}`).not.toContain(forbidden);
      }
      // Catch accidental numeric combat fields if someone widens the type later.
      const raw = c as Cosmetic & Record<string, unknown>;
      for (const forbidden of FORBIDDEN_COSMETIC_STAT_KEYS) {
        expect(raw[forbidden], `${c.id}.${forbidden}`).toBeUndefined();
      }
    }
  });

  it('unknown catalog ids resolve to none', () => {
    expect(cosmeticById('frame-aurora')?.kind).toBe('frame');
    expect(cosmeticById('nope')).toBeNull();
    expect(resolveCosmeticId(null)).toBeNull();
    expect(resolveCosmeticId('frame-aurora')).toBe('frame-aurora');
    expect(resolveCosmeticId('frame-aurora', 'title')).toBeNull();
    expect(resolveCosmeticId('title-patron', 'title')).toBe('title-patron');
    expect(resolveCosmeticId('ghost-frame')).toBeNull();
  });
});
