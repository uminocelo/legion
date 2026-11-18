import type { GuildChannel } from '@legion/core';
import { describe, expect, it } from 'vitest';
import { planChannelVisibility } from './channels.js';
import { normalizeCodename, validateCodename } from './codename.js';
import {
  expectedRoles,
  type OnboardingAction,
  type OnboardingStep,
  toStep,
  transition,
} from './onboarding.js';

describe('onboarding state machine', () => {
  it('follows the happy path', () => {
    let step: OnboardingStep = 'signal';
    for (const action of [
      'start',
      'accept_rules',
      'choose_origin',
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
    ['signal', 'choose_origin'],
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
    expect(transition('origin_chosen', 'accept_rules')).toEqual({
      ok: true,
      next: 'origin_chosen',
      changed: false,
    });
    expect(transition('origin_chosen', 'choose_origin')).toEqual({
      ok: true,
      next: 'origin_chosen',
      changed: false,
    });
    expect(transition('origin_chosen', 'start')).toMatchObject({ ok: true, changed: false });
  });

  it('reads the legacy faction_chosen step as rules_accepted', () => {
    expect(toStep('faction_chosen')).toBe('rules_accepted');
    expect(toStep('origin_chosen')).toBe('origin_chosen');
    expect(toStep('registered')).toBe('registered');
    expect(toStep('???')).toBe('signal');
  });

  it('every action on a registered member reports already_registered', () => {
    for (const a of ['start', 'accept_rules', 'choose_origin', 'choose_archetype', 'submit_mutant'] as const)
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
    for (const n of ['W0lverine', 'tempestade', 'Jean  Grey', 'Mística', 'Capitão América', 'Homem de Ferro'])
      expect(validateCodename(n, limits)).toMatchObject({ ok: false, error: 'canon' });
  });
});

describe('planChannelVisibility', () => {
  const EVERYONE = '1000';
  const REG = '2000';
  const BOT = '3000';
  const BOT_OW = {
    id: BOT,
    type: 'member' as const,
    allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'],
    deny: [],
  };
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
    botUserId: BOT,
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
      ch('7', 'categoria', [], 'category'),
      ch('8', 'server-hub', [], 'other'),
      ch('9', 'voz', [], 'voice'),
    ];
    const plan = planChannelVisibility({ ...base, channels });
    // The bot keeps access first and @everyone is denied last, so the bot never locks itself out.
    expect(plan.map((c) => `${c.channelName}:${c.kind}`)).toEqual([
      'geral:keep_bot_access',
      'geral:show_to_registered',
      'geral:hide_from_everyone',
      'voz:keep_bot_access',
      'voz:show_to_registered',
      'voz:hide_from_everyone',
    ]);
    expect(plan[0]?.overwrite).toEqual(BOT_OW);
    expect(plan[2]?.overwrite).toEqual({
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
      BOT_OW,
    ]);
    expect(planChannelVisibility({ ...base, channels: [applied] })).toEqual([]);
  });

  it('finishes a half-applied channel instead of mistaking it for a staff channel', () => {
    const half = ch('3', 'geral', [
      { id: EVERYONE, type: 'role', allow: [], deny: ['ViewChannel'] },
      { ...BOT_OW, allow: ['ViewChannel'] },
    ]);
    expect(planChannelVisibility({ ...base, channels: [half] }).map((c) => c.kind)).toEqual([
      'keep_bot_access',
      'show_to_registered',
    ]);
  });
});
