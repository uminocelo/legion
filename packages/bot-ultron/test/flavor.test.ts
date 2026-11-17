import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterFlavor, flavorOverrides } from '../src/index.js';
import { addMember, CH, emit, servicesOf, setupUltron } from './helpers.js';

let t: TestContext;
afterEach(async () => {
  await t?.close();
  delete flavorOverrides.env;
  delete flavorOverrides.fetch;
  vi.unstubAllGlobals();
});
const ENV = { AI_BASE_URL: 'http://ollama:11434/v1', AI_MODEL: 'llama3.2' };
const answer = (content: string) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }));
const ai = (extra: Record<string, unknown> = {}) => ({
  ultron: { ai: { provider: 'openai-compatible', ...extra } },
});

describe('flavor text', () => {
  it('filters mentions, links and newlines, trims to 200 chars and rejects canon names', () => {
    expect(filterFlavor('"Ajoelhem-se <@123> e @everyone!\nVejam https://x.io agora"')).toBe(
      'Ajoelhem-se e ! Vejam agora',
    );
    expect(filterFlavor('a'.repeat(300))?.length).toBe(200);
    expect(filterFlavor('Nem o Wolverine vai salvar vocês.')).toBeNull();
    expect(filterFlavor('  \n ')).toBeNull();
  });

  it('provider none (default) never touches the network', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    t = await setupUltron();
    const a = await addMember(t, '111');
    await emit(t, 'mission.started', {
      missionId: 'm1',
      missionType: 'combat',
      memberIds: [a],
      partyLevel: 1,
      difficulty: 'normal',
      channelId: CH.combat,
    });
    const taunt = t.gateway.messages.find((m) => m.msg.persona === 'ultron')?.msg.content ?? '';
    expect(taunt).toMatch(/^🤖 /);
    expect(f).not.toHaveBeenCalled();
  });

  it('openai-compatible: sends only decided facts, uses the filtered answer and logs no text', async () => {
    t = await setupUltron({ config: ai() });
    const f = answer('Seus esforços são inúteis. <@1> https://evil.example');
    flavorOverrides.env = ENV;
    flavorOverrides.fetch = f as never;
    const s = servicesOf(t);
    // services are cached per runtime: build the provider config through a fresh one
    const text = await new (s.flavor.constructor as typeof import('../src/flavor.js').FlavorText)({
      i18n: t.ctxOf((await import('../src/index.js')).ultron).i18n,
      locale: () => 'pt-BR',
      cfg: () => ({ provider: 'openai-compatible', timeoutMs: 1000, maxCallsPerHour: 30 }),
      repo: s.repo,
      clock: t.clock,
      log: t.ctxOf((await import('../src/index.js')).ultron).log,
      env: ENV,
      fetch: f as never,
    }).text('enemy_taunt', { enemies: 'Drone Vigia' }, 1);
    expect(text).toBe('🤖 ULTRON: Seus esforços são inúteis.');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://ollama:11434/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: 'llama3.2', max_tokens: 80, temperature: 0.9 });
    expect(body.messages[1].content).toContain('"enemies":"Drone Vigia"');
    const log = await t.db.orm.select().from(s.repo.t.ultronFlavorLog);
    expect(log.map((r) => [r.kind, r.ok])).toEqual([['enemy_taunt', 1]]);
    expect(Object.keys(log[0] ?? {})).not.toContain('text');
  });

  it('timeout, canon answers and the hourly budget fall back to the static line', async () => {
    t = await setupUltron();
    const s = servicesOf(t);
    const { FlavorText } = await import('../src/flavor.js');
    const { ultron } = await import('../src/index.js');
    const ctx = t.ctxOf(ultron);
    const make = (fetchFn: unknown, max = 30) =>
      new FlavorText({
        i18n: ctx.i18n,
        locale: () => 'pt-BR',
        cfg: () => ({ provider: 'openai-compatible', timeoutMs: 50, maxCallsPerHour: max }),
        repo: s.repo,
        clock: t.clock,
        log: ctx.log,
        env: ENV,
        fetch: fetchFn as never,
      });
    const slow = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted')))),
    );
    const staticLine = make(slow).staticLine('event_defeat', {}, 7);
    expect(await make(slow).text('event_defeat', {}, 7)).toBe(staticLine);
    expect(await make(answer('O Magneto manda lembranças.')).text('event_defeat', {}, 7)).toBe(staticLine);
    const budget = answer('Frase nova.');
    expect(await make(budget, 2).text('event_defeat', {}, 7)).toBe(staticLine); // 2 calls already this hour
    expect(budget).not.toHaveBeenCalled();
    t.clock.advance(3_600_001);
    expect(await make(budget, 2).text('event_defeat', {}, 7)).toBe('🤖 ULTRON: Frase nova.');
  });
});
