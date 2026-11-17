import type { I18n, Locale } from '@legion/core';
import { mulberry32 } from '@legion/core';

export type FlavorKind = 'enemy_taunt' | 'event_announcement' | 'event_victory' | 'event_defeat';

/** Static lines from the locale files, picked with the seeded PRNG. Stream 2 adds the optional AI provider. */
export class FlavorText {
  constructor(
    private readonly i18n: I18n,
    private readonly locale: () => Locale,
  ) {}

  staticLine(
    kind: FlavorKind,
    vars: Record<string, string | number>,
    seed: number,
    keys: string[] = [],
  ): string {
    const fallback: Record<FlavorKind, string[]> = {
      enemy_taunt: ['ultron.taunt.generic.1', 'ultron.taunt.generic.2', 'ultron.taunt.generic.3'],
      event_announcement: ['ultron.flavor.announce.1', 'ultron.flavor.announce.2'],
      event_victory: ['ultron.flavor.victory.1', 'ultron.flavor.victory.2'],
      event_defeat: ['ultron.flavor.defeat.1', 'ultron.flavor.defeat.2'],
    };
    const rest = vars;
    const pool = keys.length ? keys : fallback[kind];
    const key = pool[mulberry32(seed).d(pool.length) - 1] ?? pool[0] ?? '';
    return this.i18n.t(key, rest, this.locale());
  }

  async text(
    kind: FlavorKind,
    vars: Record<string, string | number>,
    seed: number,
    keys: string[] = [],
  ): Promise<string> {
    return this.staticLine(kind, vars, seed, keys);
  }
}
