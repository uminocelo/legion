import { describe, expect, it } from 'vitest';
import {
  advance,
  type Chain,
  chainSchema,
  currentStep,
  effectiveSteps,
  isAboutMember,
  memberIdsOf,
  triggerMatches,
} from './quest.js';

const chain: Chain = chainSchema.parse({
  chain: 'c',
  steps: [
    {
      id: 'perfil',
      titleKey: 'a',
      bodyKey: 'b',
      trigger: { event: 'command.executed', where: { command: 'perfil' } },
      rewardXp: 20,
    },
    {
      id: 'trivia',
      titleKey: 'a',
      bodyKey: 'b',
      requiresBot: 'jarvis',
      trigger: { event: 'trivia.answered' },
      rewardXp: 30,
    },
    {
      id: 'missao',
      titleKey: 'a',
      bodyKey: 'b',
      requiresBot: 'jarvis',
      requiresFeature: 'missions',
      trigger: { event: 'mission.completed' },
      fallback: {
        id: 'prefs',
        titleKey: 'a',
        bodyKey: 'b',
        trigger: { event: 'command.executed', where: { command: 'cerebro', subcommand: 'preferencias' } },
      },
      rewardXp: 50,
    },
  ],
  completionRewardXp: 50,
});
const env = (bots: string[], features: string[] = []) => ({
  enabledBots: bots as never,
  features: new Set(features),
});

describe('quest engine', () => {
  it('uses fallbacks and skips steps whose bot is disabled', () => {
    expect(effectiveSteps(chain, env(['cerebro', 'jarvis'])).map((s) => s.id)).toEqual([
      'perfil',
      'trivia',
      'prefs',
    ]);
    expect(effectiveSteps(chain, env(['cerebro', 'jarvis'], ['missions'])).map((s) => s.id)).toEqual([
      'perfil',
      'trivia',
      'missao',
    ]);
    const noJarvis = effectiveSteps(chain, env(['cerebro']));
    expect(noJarvis.map((s) => s.id)).toEqual(['perfil', 'prefs']);
    expect(noJarvis[1]?.rewardXp).toBe(50); // the fallback keeps the step's reward
  });

  it('matches where fields exactly and resolves members', () => {
    const t = {
      event: 'command.executed' as const,
      where: { command: 'cerebro', subcommand: 'preferencias' },
    };
    expect(triggerMatches(t, 'command.executed', { command: 'cerebro', subcommand: 'preferencias' })).toBe(
      true,
    );
    expect(triggerMatches(t, 'command.executed', { command: 'cerebro', subcommand: 'setup' })).toBe(false);
    expect(triggerMatches(t, 'trivia.answered', { command: 'cerebro', subcommand: 'preferencias' })).toBe(
      false,
    );
    expect(isAboutMember({ memberIds: ['m1', 'm2'] }, 'm2', 'd')).toBe(true);
    expect(isAboutMember({ discordUserId: 'd' }, 'x', 'd')).toBe(true);
    expect(isAboutMember({ memberId: 'other' }, 'm', 'd')).toBe(false);
    expect(memberIdsOf({ memberId: 'a', memberIds: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('enforces order: a later step done early does not count', () => {
    const steps = effectiveSteps(chain, env(['cerebro', 'jarvis']));
    expect(advance(steps, new Set(), 'trivia.answered', { memberId: 'm' })).toBeNull();
    const a = advance(steps, new Set(), 'command.executed', { command: 'perfil' });
    expect(a?.step.id).toBe('perfil');
    expect(a?.next?.id).toBe('trivia');
    expect(a?.chainCompleted).toBe(false);
    const last = advance(steps, new Set(['perfil', 'trivia']), 'command.executed', {
      command: 'cerebro',
      subcommand: 'preferencias',
    });
    expect(last).toMatchObject({ index: 2, next: null, chainCompleted: true });
    expect(currentStep(steps, new Set(['perfil', 'trivia', 'prefs']))).toBeNull();
  });

  it('ignores done ids of steps removed from the file', () => {
    const steps = effectiveSteps(chain, env(['cerebro', 'jarvis']));
    expect(currentStep(steps, new Set(['velho-passo', 'perfil']))?.id).toBe('trivia');
  });

  it('rejects repeated step ids and unknown trigger events', () => {
    expect(chainSchema.safeParse({ ...chain, steps: [chain.steps[0], chain.steps[0]] }).success).toBe(false);
    const bad = chainSchema.safeParse({
      chain: 'c',
      steps: [{ id: 'x', titleKey: 'a', bodyKey: 'b', trigger: { event: 'message.created' }, rewardXp: 1 }],
    });
    expect(bad.success).toBe(false);
  });
});
