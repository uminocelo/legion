import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { GUIDE_KEY, HerbieGuide, herbie, packEmbeds } from '../src/index.js';
import { servicesOf, setupHerbie } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const RULES = '300000000000000002';
const OTHER = '300000000000000005';
const STAFF = '900';
const publish = (tc: TestContext, canal?: string, userId = STAFF) =>
  tc.interact({
    kind: 'command',
    userId,
    isGuildOwner: userId === STAFF,
    commandName: 'herbie',
    subcommand: 'guia publicar',
    ...(canal ? { options: { canal } } : {}),
  });
async function setup(config: Record<string, unknown> = {}) {
  const tc = await setupHerbie({
    config: { channels: { welcome: '300000000000000001', rules: RULES }, ...config },
  });
  tc.gateway.addChannel({ id: RULES, name: 'regras', kind: 'text', parentId: null });
  tc.gateway.addChannel({ id: OTHER, name: 'guia', kind: 'text', parentId: null });
  return tc;
}
const titles = (tc: TestContext, channelId: string) =>
  tc.gateway.messages
    .filter((m) => m.channelId === channelId)
    .flatMap((m) => (m.msg.embeds ?? []).map((e) => e.title));

describe('how-to-play guide', () => {
  it('posts the guide in channels.rules, pins it and covers registration, powers, progress, missions and trivia', async () => {
    t = await setup();
    const id = await publish(t);
    expect(t.gateway.lastReply(id)?.content).toMatch(/Guia postado em <#300000000000000002>/);
    const posted = titles(t, RULES);
    expect(posted).toEqual(
      expect.arrayContaining([
        '📝 1. Registre seu herói',
        '🪪 2. Sua ficha',
        '⚡ Poderes e arquétipos',
        '📈 3. XP, nível e rank',
        '❓ Trivia',
        '🗺️ Missões',
      ]),
    );
    // Sentinel and ULTRON are off in this setup: their sections are skipped.
    expect(posted.some((x) => x?.includes('Combate'))).toBe(false);
    expect(posted.some((x) => x?.includes('Eventos mundiais'))).toBe(false);
    const first = t.gateway.messages.find((m) => m.channelId === RULES);
    expect(t.gateway.pinned.has(first?.messageId ?? '')).toBe(true);
  });

  it('covers combat, events and reports when Sentinel and ULTRON are on', () => {
    const guide = new HerbieGuide({
      config: { locale: 'en', bots: ['cerebro', 'jarvis', 'herbie', 'sentinel', 'ultron'] },
    } as unknown as ConstructorParameters<typeof HerbieGuide>[0]);
    expect(guide.sections().map((x) => x.id)).toEqual([
      'bem-vindo',
      'registro',
      'ficha',
      'poderes',
      'progresso',
      'trivia',
      'missoes',
      'combate',
      'eventos',
      'convivencia',
    ]);
    expect(guide.sections()[1]?.title).toBe('📝 1. Register your hero');
  });

  it('publishing again edits the same messages; another channel gets a new post', async () => {
    t = await setup();
    await publish(t);
    const count = t.gateway.messages.length;
    const again = await publish(t);
    expect(t.gateway.lastReply(again)?.content).toMatch(/Guia atualizado/);
    expect(t.gateway.messages.length).toBe(count);
    expect(t.gateway.callsOf('editMessage').length).toBeGreaterThan(0);
    await publish(t, OTHER);
    expect(titles(t, OTHER).length).toBeGreaterThan(0);
    expect((await t.ctxOf(herbie).kv.get<{ channelId: string }>(GUIDE_KEY))?.channelId).toBe(OTHER);
  });

  it('says how to pin by hand when it lacks Pin Messages; non-staff are refused', async () => {
    t = await setup();
    t.gateway.pinDenied.add(RULES);
    const id = await publish(t);
    expect(t.gateway.lastReply(id)?.content).toMatch(/Não consegui fixar/);
    const no = await publish(t, undefined, '111');
    expect(t.gateway.lastReply(no)?.content).toMatch(/staff/i);
  });

  it('a server guide file replaces the shipped one; an invalid file is reported', async () => {
    t = await setup();
    const dir = mkdtempSync(join(tmpdir(), 'guide-'));
    writeFileSync(join(dir, 'guide.pt-BR.yaml'), '- id: unico\n  title: Só isso\n  body: Bem-vindo!\n');
    const s = servicesOf(t);
    expect(s.guide.sections(dir).map((x) => x.title)).toEqual(['Só isso']);
    writeFileSync(join(dir, 'guide.pt-BR.yaml'), '- id: X\n');
    expect(() => s.guide.sections(dir)).not.toThrow(); // invalid server file → shipped guide
    expect(s.guide.sections(dir).length).toBeGreaterThan(1);
    expect(s.guide.lastErrors.join('\n')).toMatch(/guide\.pt-BR\.yaml → 0\.title/);
  });

  it('packs embeds under Discord limits (10 per message, 6000 characters)', () => {
    const big = Array.from({ length: 12 }, (_, i) => ({ title: `S${i}`, description: 'x'.repeat(1500) }));
    const pages = packEmbeds(big);
    expect(pages.every((p) => p.length <= 10)).toBe(true);
    expect(
      pages.every(
        (p) => p.reduce((n, e) => n + (e.title?.length ?? 0) + (e.description?.length ?? 0), 0) <= 6000,
      ),
    ).toBe(true);
    expect(pages.flat()).toHaveLength(12);
  });
});
