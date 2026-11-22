import { cerebro } from '@legion/bot-cerebro';
import { createTestContext, type TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { jarvis } from '../src/index.js';
import { addMember, award, events, servicesOf } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const split = () =>
  createTestContext({ bots: [cerebro, jarvis], apps: [{ key: 'jarvis', bots: ['jarvis'] }] });

describe('one Discord app per bot', () => {
  it("registers each bot's commands on its own app only", async () => {
    t = await split();
    await t.runtime.ready({ startPolling: false });
    const names = (g: { calls: { method: string; args: unknown[] }[] }) =>
      ((g.calls.filter((c) => c.method === 'registerCommands').at(-1)?.args[0] ?? []) as { name: string }[])
        .map((c) => c.name)
        .sort();
    const jg = t.appGateways.get('jarvis');
    if (!jg) throw new Error('no jarvis app');
    expect(names(jg)).toEqual([
      'campanha',
      'carteira',
      'inventario',
      'jarvis',
      'loja',
      'missao',
      'ranking',
      'sequencia',
      'temporada',
      'trivia',
    ]);
    expect(names(t.gateway)).not.toContain('trivia');
    expect(names(t.gateway)).toContain('perfil');
  });

  it('answers /trivia through the J.A.R.V.I.S. app; the shared app treats it as unknown', async () => {
    t = await split();
    const jg = t.appGateways.get('jarvis');
    if (!jg) throw new Error('no jarvis app');
    const m = await addMember(t, '111');
    const onMain = await t.interact({ kind: 'command', userId: '111', commandName: 'trivia' });
    expect(t.gateway.lastReply(onMain)?.persona).not.toBe('jarvis');
    const id = await t.interact({ kind: 'command', userId: '111', commandName: 'trivia' }, 'jarvis');
    expect(t.gateway.repliesTo(id)).toEqual([]);
    expect(jg.lastReply(id)?.components?.[0]).toHaveLength(4);
    // buttons keep working on the J.A.R.V.I.S. app, and roles still change through the main app
    const reply = jg.lastReply(id);
    const btn = reply?.components?.[0]?.[0];
    const attemptId = (btn && 'customId' in btn ? (btn.customId ?? '') : '').split(':')[3] ?? '';
    const s = servicesOf(t);
    const attempt = await s.repo.attempt(attemptId);
    const q = attempt ? await s.repo.question(attempt.questionId) : null;
    const display = (JSON.parse(attempt?.choiceOrder ?? '[]') as number[]).indexOf(q?.answerIndex);
    const a = await t.interact(
      { kind: 'component', userId: '111', customId: `jarvis:v1:trivia:${attemptId}:${display}` },
      'jarvis',
    );
    expect(jg.lastReply(a)?.embeds?.[0]?.description).toContain('✅ Correto!');
    expect(await events(t, 'trivia.answered')).toHaveLength(1);
    expect((await s.repo.progress(m))?.xp).toBeGreaterThan(0);
  });

  it('keeps Cérebro on the main app and swaps rank roles there', async () => {
    t = await split();
    await t.runtime.ready({ startPolling: false });
    expect(t.runtime.appOf('cerebro')).toBe('main');
    expect(t.runtime.appOf('jarvis')).toBe('jarvis');
    const m = await addMember(t, '111');
    await award(t, m, 600, 'g1');
    expect(t.gateway.memberRoleNames('111')).toContain('Agente');
  });
});
