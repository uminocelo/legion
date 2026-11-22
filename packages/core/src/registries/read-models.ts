import type { Embed } from '../discord/types.js';
import { DEFAULT_STAT_CAP, type ItemSlot, type StatBonus, ZERO_BONUS } from '../game/stats.js';
import type { LocaleResolver } from '../i18n/i18n.js';
import type { RateLimiter } from '../ratelimit/rate-limiter.js';

export type Rank = 'recruta' | 'agente' | 'veterano';
export type OnboardingStep = 'signal' | 'rules_accepted' | 'origin_chosen' | 'registered';

export interface MemberView {
  id: string;
  discordUserId: string;
  onboardingStep: OnboardingStep;
  faction: string | null;
  /** Last team switch (arc or staff); null = never switched. */
  factionChangedAt: string | null;
  rank: Rank;
  optIns: string[];
  leftAt: string | null;
}
export interface MutantView {
  id: string;
  memberId: string;
  codename: string;
  archetype: string;
  power: string;
  /** Free-text backstory ("História"). */
  origin: string;
  /** Origin category key (`cerebro.origins`, e.g. `mutante`, `tecnologia`). */
  originType: string;
}
export interface ProgressView {
  xp: number;
  level: number;
  rank: Rank;
  currentStreak: number;
  bestStreak: number;
}

export interface MembersReadModel {
  getById(memberId: string): Promise<MemberView | null>;
  getByDiscordId(discordUserId: string): Promise<MemberView | null>;
  listRegistered(opts?: { faction?: string }): Promise<MemberView[]>;
}
export interface MutantsReadModel {
  getByMemberId(memberId: string): Promise<MutantView | null>;
}
export interface ProgressReadModel {
  get(memberId: string): Promise<ProgressView | null>;
}

export interface EquippedItemView {
  slot: ItemSlot;
  itemId: string;
  name: { 'pt-BR': string; en?: string };
}
/** Gear (v0.10, ADR 0029), provided by J.A.R.V.I.S.; without it every hero has no gear. */
export interface GearReadModel {
  /** Raw sum of the member's active equipped items, not capped (`playerStats` caps it). */
  bonusOf(memberId: string): Promise<StatBonus>;
  equippedOf(memberId: string): Promise<EquippedItemView[]>;
  /** `jarvis.economy.gear.statCap`: the most gear adds to each stat (hp × 8). */
  statCap(): number;
}

/** Read-only views into other bots' data. A disabled owner means every query returns null/[]. */
export interface ReadModels {
  members: MembersReadModel;
  mutants: MutantsReadModel;
  progress: ProgressReadModel;
  gear: GearReadModel;
}

/** Founder YAML staged for staff approve/refuse (US-37). Provided by J.A.R.V.I.S. */
export interface SquadContentImport {
  /** Validate YAML for the founder's squad; stage for staff. */
  stage(o: {
    text: string;
    fileName: string;
    squadId: string;
    founderUserId: string;
    locale: string;
  }): Promise<
    | { ok: true; stageId: string; kind: 'mission' | 'campaign' | 'trivia'; summary: string; embed: Embed }
    | { ok: false; errors: string[] }
  >;
  publish(
    stageId: string,
    staffUserId: string,
  ): Promise<{ ok: true; id: string } | { ok: false; key: string }>;
  cancel(stageId: string): Promise<void>;
}

/** Implementations a bot can provide to core or to other bots (`ctx.provide`). */
export interface Providers {
  members: MembersReadModel;
  mutants: MutantsReadModel;
  progress: ProgressReadModel;
  gear: GearReadModel;
  rateLimiter: RateLimiter;
  localeResolver: LocaleResolver;
  squadContentImport: SquadContentImport;
}

export class ProviderRegistry {
  private readonly impls: Partial<Providers> = {};
  private readonly owners = new Map<keyof Providers, string>();

  provide<K extends keyof Providers>(key: K, impl: Providers[K], owner = 'core'): void {
    const prev = this.owners.get(key);
    if (prev && prev !== 'core' && prev !== owner) throw new Error(`"${key}" is already provided by ${prev}`);
    this.impls[key] = impl;
    this.owners.set(key, owner);
  }

  get<K extends keyof Providers>(key: K): Providers[K] | undefined {
    return this.impls[key];
  }

  /** Read models that delegate at call time, so the provider can register after the reader. */
  readModels(): ReadModels {
    return {
      members: {
        getById: async (id) => (await this.get('members')?.getById(id)) ?? null,
        getByDiscordId: async (id) => (await this.get('members')?.getByDiscordId(id)) ?? null,
        listRegistered: async (opts) => (await this.get('members')?.listRegistered(opts)) ?? [],
      },
      mutants: { getByMemberId: async (id) => (await this.get('mutants')?.getByMemberId(id)) ?? null },
      progress: { get: async (id) => (await this.get('progress')?.get(id)) ?? null },
      gear: {
        bonusOf: async (id) => (await this.get('gear')?.bonusOf(id)) ?? { ...ZERO_BONUS },
        equippedOf: async (id) => (await this.get('gear')?.equippedOf(id)) ?? [],
        statCap: () => this.get('gear')?.statCap() ?? DEFAULT_STAT_CAP,
      },
    };
  }
}
