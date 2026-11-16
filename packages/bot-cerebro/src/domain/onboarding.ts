import type { OnboardingStep } from '@legion/core';

export type { OnboardingStep };

export const STEPS: readonly OnboardingStep[] = ['signal', 'rules_accepted', 'faction_chosen', 'registered'];

export type OnboardingAction =
  | 'start'
  | 'accept_rules'
  | 'choose_faction'
  | 'choose_archetype'
  | 'submit_mutant';

export type TransitionResult =
  | { ok: true; next: OnboardingStep; changed: boolean }
  | { ok: false; reason: 'continue_from' | 'already_registered'; current: OnboardingStep };

const index = (s: OnboardingStep) => STEPS.indexOf(s);

/**
 * Pure onboarding state machine (Cérebro Part C):
 *   signal ─accept_rules→ rules_accepted ─choose_faction→ faction_chosen ─submit_mutant→ registered
 * Repeating an earlier action is a no-op; skipping ahead returns `continue_from`.
 */
export function transition(current: OnboardingStep, action: OnboardingAction): TransitionResult {
  if (current === 'registered') return { ok: false, reason: 'already_registered', current };
  const stay = { ok: true as const, next: current, changed: false };
  switch (action) {
    case 'start':
      return stay;
    case 'accept_rules':
      return current === 'signal' ? { ok: true, next: 'rules_accepted', changed: true } : stay;
    case 'choose_faction':
      if (index(current) < index('rules_accepted')) return { ok: false, reason: 'continue_from', current };
      return { ok: true, next: 'faction_chosen', changed: current !== 'faction_chosen' };
    case 'choose_archetype':
      if (current !== 'faction_chosen') return { ok: false, reason: 'continue_from', current };
      return stay;
    case 'submit_mutant':
      if (current !== 'faction_chosen') return { ok: false, reason: 'continue_from', current };
      return { ok: true, next: 'registered', changed: true };
  }
}

/** Role keys a member should hold for their state (used for rejoin restore and reconcile). */
export function expectedRoles(m: {
  onboardingStep: OnboardingStep;
  factionRoleKey: string | null;
  rank: string;
  optIns: readonly string[];
}): { add: string[]; remove: string[] } {
  if (m.onboardingStep !== 'registered') return { add: ['signal'], remove: ['registered'] };
  return {
    add: ['registered', ...(m.factionRoleKey ? [m.factionRoleKey] : []), `rank_${m.rank}`, ...m.optIns],
    remove: ['signal'],
  };
}
