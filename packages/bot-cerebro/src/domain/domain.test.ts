import type { GuildChannel } from '@legion/core';
import { describe, expect, it } from 'vitest';
import { planChannelVisibility } from './channels.js';
import { normalizeCodename, validateCodename } from './codename.js';
import { expectedRoles, type OnboardingAction, type OnboardingStep, transition } from './onboarding.js';

describe('onboarding state machine', () => {
  it('follows the happy path', () => {
    let step: OnboardingStep = 'signal';
    for (const action of [
      'start',
      'accept_rules',
      'choose_faction',
      'choose_archetype',
      'submit_mutant',
    ] as const) {
      const r = transition(step, action);
      expect(r.ok).toBe(true);
      if (r.ok) step = r.next;
    }
    expect(step).toBe('registered');
  });

  it.each<[OnboardingStep, OnboardingAction]>([
    ['signal', 'choose_faction'],
    ['signal', 'submit_mutant'],
    ['rules_accepted', 'submit_mutant'],
    ['rules_accepted', 'choose_archetype'],
  ])('rejects %s → %s with continue_from', (from, action) => {
    expect(transition(from, action)).toEqual({ ok: false, reason: 'continue_from', current: from });
  });

  it('treats repeats as no-ops (double clicks, old buttons)', () => {
    expect(transition('rules_accepted', 'accept_rules')).toEqual({
      ok: true,
      next: 'rules_accepted',
      changed: false,
    });
    expect(transition('faction_chosen', 'accept_rules')).toEqual({
      ok: true,
      next: 'faction_chosen',
      changed: false,
    });
    expect(transition('faction_chosen', 'choose_faction')).toEqual({
      ok: true,
      next: 'faction_chosen',
      changed: false,
    });
    expect(transition('faction_chosen', 'start')).toMatchObject({ ok: true, changed: false });
  });

  it('every action on a registered member reports already_registered', () => {
    for (const a of ['start', 'accept_rules', 'choose_faction', 'choose_archetype', 'submit_mutant'] as const)
      expect(transition('registered', a)).toMatchObject({ ok: false, reason: 'already_registered' });
  });

  it('computes the expected roles', () => {
    expect(
      expectedRoles({ onboardingStep: 'rules_accepted', factionRoleKey: null, rank: 'recruta', optIns: [] }),
    ).toEqual({
      add: ['signal'],
      remove: ['registered'],
    });
    expect(
      expectedRoles({
        onboardingStep: 'registered',
        factionRoleKey: 'faction_xmen',
        rank: 'agente',
        optIns: ['live_ping'],
      }),
    ).toEqual({ add: ['registered', 'faction_xmen', 'rank_agente', 'live_ping'], remove: ['signal'] });
  });
});

describe('codename validation', () => {
  const limits = { min: 2, max: 32 };
  it('tidies and normalizes so case and accents collide', () => {
    expect(validateCodename('  Fênix   Azul ', limits)).toEqual({
      ok: false,
      error: 'canon',
      codename: 'Fênix Azul',
    });
    expect(normalizeCodename('Faísca  Rubra')).toBe(normalizeCodename('faisca rubra'));
    expect(validateCodename("Raio-d'Água 2", limits)).toEqual({
      ok: true,
      codename: "Raio-d'Água 2",
      normalized: "raio-d'agua 2",
    });
  });
  it('enforces length and characters', () => {
    expect(validateCodename('A', limits)).toMatchObject({ ok: false, error: 'length' });
    expect(validateCodename('x'.repeat(33), limits)).toMatchObject({ ok: false, error: 'length' });
    expect(validateCodename('Raio_Azul!', limits)).toMatchObject({ ok: false, error: 'chars' });
    expect(validateCodename('<@123>', limits)).toMatchObject({ ok: false, error: 'chars' });
  });
  it('rejects canon names in all their disguises', () => {
    for (const n of ['W0lverine', 'tempestade', 'Jean  Grey', 'Mística'])
      expect(validateCodename(n, limits)).toMatchObject({ ok: false, error: 'canon' });
  });
});

describe('planChannelVisibility', () => {
  const EVERYONE = '1000';
  const REG = '2000';
  const ch = (
    id: string,
    name: string,
    overwrites: GuildChannel['overwrites'] = [],
    kind: GuildChannel['kind'] = 'text',
  ) => ({
    id,
    name,
    kind,
    parentId: null,
    overwrites,
  });
  const base = {
    everyoneRoleId: EVERYONE,
    registeredRoleId: REG,
    welcomeId: '1',
    rulesId: '2',
    excludeIds: ['5'],
  };

  it('hides community channels from everyone and opens them to Registered, keeping other bits', () => {
    const channels = [
      ch('1', 'boas-vindas'),
      ch('2', 'regras'),
      ch('3', 'geral', [{ id: EVERYONE, type: 'role', allow: ['SendMessages'], deny: [] }]),
      ch('4', 'staff', [{ id: EVERYONE, type: 'role', allow: [], deny: ['ViewChannel'] }]),
      ch('5', 'excluido'),
      ch('6', 'thread', [], 'thread'),
    ];
    const plan = planChannelVisibility({ ...base, channels });
    expect(plan.map((c) => `${c.channelName}:${c.kind}`)).toEqual([
      'geral:hide_from_everyone',
      'geral:show_to_registered',
    ]);
    expect(plan[0]?.overwrite).toEqual({
      id: EVERYONE,
      type: 'role',
      allow: ['SendMessages'],
      deny: ['ViewChannel'],
    });
  });

  it('is a no-op once applied', () => {
    const applied = ch('3', 'geral', [
      { id: EVERYONE, type: 'role', allow: [], deny: ['ViewChannel'] },
      { id: REG, type: 'role', allow: ['ViewChannel'], deny: [] },
    ]);
    expect(planChannelVisibility({ ...base, channels: [applied] })).toEqual([]);
  });
});
