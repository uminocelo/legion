import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ultron } from '../src/index.js';
import { TeamNews } from '../src/team-news.js';
import { addMember, emit, servicesOf, setupUltron } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const NEWS = { xmen: '300000000000000071', brotherhood: '300000000000000072' };
const factions = [
  { key: 'independent', roleKey: 'faction_independent' },
  { key: 'xmen', roleKey: 'faction_xmen', newsChannelId: NEWS.xmen },
  { key: 'brotherhood', roleKey: 'faction_brotherhood', newsChannelId: NEWS.brotherhood },
  { key: 'avengers', roleKey: 'faction_avengers' },
];

async function boot(withNews = true) {
  t = await setupUltron({
    config: {
      ultron: { invasion: { enabled: false } },
      factions: withNews ? factions : factions.map(({ newsChannelId: _, ...f }) => f),
    },
  });
  for (const id of Object.values(NEWS)) t.gateway.addChannel({ id, name: `news-${id}`, kind: 'text' });
  await ultron.onReady?.(t.ctxOf(ultron));
  const s = servicesOf(t);
  return { s, news: new TeamNews(t.ctxOf(ultron), s.war) };
}
const posts = (tc: TestContext, ch: string) =>
  tc.gateway.messages.filter((m) => m.channelId === ch).map((m) => m.msg.content ?? '');

describe('team news (US-34)', () => {
  it('posts each team its own standing, at most once per board change', async () => {
    const { s, news } = await boot();
    const x = await addMember(t as TestContext, '111', 'xmen');
    const b = await addMember(t as TestContext, '222', 'brotherhood');
    await s.war.staffStart();
    await s.war.score(x, 30, 'mission', 'war:mission:r:x');
    await s.war.score(b, 10, 'mission', 'war:mission:r:b');
    await news.standings();
    const tc = t as TestContext;
    expect(posts(tc, NEWS.xmen)).toEqual([
      '⚔️ Guerra: sua equipe lidera com 30 pontos, 20 à frente de Irmandade.',
    ]);
    expect(posts(tc, NEWS.brotherhood)).toEqual([
      '⚔️ Guerra: sua equipe está em 2º com 10 pontos, 20 atrás de X-Men.',
    ]);
    await news.standings();
    expect(posts(tc, NEWS.xmen)).toHaveLength(1);
    await s.war.score(b, 25, 'mission', 'war:mission:r:b2');
    await news.standings();
    expect(posts(tc, NEWS.brotherhood).at(-1)).toContain('lidera com 35 pontos');
  });

  it('posts the war result per team when the war ends', async () => {
    const { s } = await boot();
    const x = await addMember(t as TestContext, '111', 'xmen');
    await s.war.staffStart();
    await s.war.score(x, 40, 'mission', 'war:mission:r:x');
    const active = await s.war.repo.findStatus('active');
    await s.war.end(active?.id ?? '');
    const tc = t as TestContext;
    expect(posts(tc, NEWS.xmen)).toContain('🏆 Sua equipe venceu a guerra com 40 pontos!');
    expect(posts(tc, NEWS.brotherhood)).toContain('A guerra acabou sem pontos da sua equipe. Venceu: X-Men.');
  });

  it('posts an event result with how many heroes of each team took part', async () => {
    const { news } = await boot();
    const tc = t as TestContext;
    const x1 = await addMember(tc, '111', 'xmen');
    const x2 = await addMember(tc, '112', 'xmen');
    await emit(tc, 'world.event', {
      worldEventId: 'e1',
      kind: 'raid',
      phase: 'ended',
      title: 'Raid na Torre',
      startsAt: tc.clock.now().toISOString(),
      endsAt: tc.clock.now().toISOString(),
      outcome: 'victory',
      participantMemberIds: [x1, x2],
    });
    expect(posts(tc, NEWS.xmen)).toContain('Raid na Torre: vitória. Da sua equipe, 2 herói(s) participaram.');
    expect(posts(tc, NEWS.brotherhood)).toContain(
      'Raid na Torre: vitória. Da sua equipe, 0 herói(s) participaram.',
    );
    await news.onWorldEvent({ payload: { phase: 'started' } } as never);
    expect(posts(tc, NEWS.xmen)).toHaveLength(1);
  });

  it('posts nothing without news channels, and survives a channel that fails', async () => {
    const { s, news } = await boot(false);
    const tc = t as TestContext;
    const x = await addMember(tc, '111', 'xmen');
    await s.war.staffStart();
    await s.war.score(x, 5, 'mission', 'war:mission:r:x');
    await news.standings();
    expect(tc.gateway.messages.filter((m) => Object.values(NEWS).includes(m.channelId))).toHaveLength(0);
    await tc.close();
    const again = await boot();
    const tc2 = t as TestContext;
    const y = await addMember(tc2, '111', 'xmen');
    await again.s.war.staffStart();
    await again.s.war.score(y, 5, 'mission', 'war:mission:r:y');
    tc2.gateway.failNext('sendMessage');
    await expect(again.news.standings()).resolves.toBeUndefined();
    expect(posts(tc2, NEWS.brotherhood)).toHaveLength(1);
  });
});
