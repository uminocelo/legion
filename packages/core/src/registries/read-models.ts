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

/** Read-only views into other bots' data. A disabled owner means every query returns null/[]. */
export interface ReadModels {
  members: MembersReadModel;
  mutants: MutantsReadModel;
  progress: ProgressReadModel;
}

/** Implementations a bot can provide to core or to other bots (`ctx.provide`). */
export interface Providers {
  members: MembersReadModel;
  mutants: MutantsReadModel;
  progress: ProgressReadModel;
  rateLimiter: RateLimiter;
  localeResolver: LocaleResolver;
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
    };
  }
}
