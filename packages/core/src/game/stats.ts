export const ARCHETYPES = ['Telepata', 'Elemental', 'Metamorfo', 'Velocista', 'Tanque', 'Tecnopata'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export interface Stats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  foc: number;
}

/** Level-1 base stats per archetype (main prompt §6.2). */
export const BASE_STATS: Readonly<Record<Archetype, Readonly<Stats>>> = {
  Telepata: { hp: 90, atk: 8, def: 6, spd: 10, foc: 14 },
  Elemental: { hp: 95, atk: 12, def: 6, spd: 9, foc: 10 },
  Metamorfo: { hp: 105, atk: 9, def: 9, spd: 9, foc: 8 },
  Velocista: { hp: 85, atk: 10, def: 5, spd: 15, foc: 8 },
  Tanque: { hp: 130, atk: 8, def: 13, spd: 6, foc: 6 },
  Tecnopata: { hp: 95, atk: 9, def: 8, spd: 9, foc: 12 },
};

export function isArchetype(value: string): value is Archetype {
  return (ARCHETYPES as readonly string[]).includes(value);
}

/** Stats at a level: hp +8, atk/def/foc +1 per level, spd +1 every 2 levels. */
export function computePlayerStats(archetype: Archetype, level: number): Stats {
  if (!Number.isInteger(level) || level < 1)
    throw new RangeError(`level must be an integer >= 1, got ${level}`);
  const b = BASE_STATS[archetype];
  const gained = level - 1;
  return {
    hp: b.hp + 8 * gained,
    atk: b.atk + gained,
    def: b.def + gained,
    foc: b.foc + gained,
    spd: b.spd + Math.floor(gained / 2),
  };
}

/** Equipment slots (v0.10). */
export const ITEM_SLOTS = ['traje', 'acessorio', 'dispositivo'] as const;
export type ItemSlot = (typeof ITEM_SLOTS)[number];

/** Extra stats from gear; every field present. */
export type StatBonus = Stats;
export const ZERO_BONUS: Readonly<StatBonus> = Object.freeze({ hp: 0, atk: 0, def: 0, spd: 0, foc: 0 });
/** Default `jarvis.economy.gear.statCap`: +2 per stat and +16 hp in total. */
export const DEFAULT_STAT_CAP = 2;

/**
 * Fight stats with gear: `computePlayerStats` plus the bonus, each stat clamped to `0..cap`
 * (hp `0..cap × 8`). The cap is on the total of every equipped item (ADR 0029).
 */
export function playerStats(
  archetype: Archetype,
  level: number,
  bonus: Partial<StatBonus> = {},
  cap: number = DEFAULT_STAT_CAP,
): Stats {
  const base = computePlayerStats(archetype, level);
  const c = Math.max(0, Math.floor(cap));
  const clamp = (v: number | undefined, max: number) => Math.min(max, Math.max(0, Math.floor(v ?? 0)));
  return {
    hp: base.hp + clamp(bonus.hp, c * 8),
    atk: base.atk + clamp(bonus.atk, c),
    def: base.def + clamp(bonus.def, c),
    spd: base.spd + clamp(bonus.spd, c),
    foc: base.foc + clamp(bonus.foc, c),
  };
}
