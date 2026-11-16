import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from '../ratelimit/rate-limiter.js';
import { FakeClock } from '../time/clock.js';
import { HelpRegistry, ProfileRegistry } from './help.js';
import { ProviderRegistry } from './read-models.js';

describe('ProviderRegistry / ReadModels', () => {
  it('returns null and [] while the owner is disabled', async () => {
    const read = new ProviderRegistry().readModels();
    expect(await read.members.getByDiscordId('1')).toBeNull();
    expect(await read.members.listRegistered()).toEqual([]);
    expect(await read.mutants.getByMemberId('m')).toBeNull();
    expect(await read.progress.get('m')).toBeNull();
  });

  it('delegates to the provider registered later', async () => {
    const reg = new ProviderRegistry();
    const read = reg.readModels();
    reg.provide(
      'progress',
      { get: async () => ({ xp: 10, level: 1, rank: 'recruta', currentStreak: 0, bestStreak: 0 }) },
      'jarvis',
    );
    expect((await read.progress.get('m'))?.xp).toBe(10);
  });

  it('lets a bot replace the core rate limiter, but not another bot provider', () => {
    const reg = new ProviderRegistry();
    const a = new InMemoryRateLimiter(new FakeClock());
    const b = new InMemoryRateLimiter(new FakeClock());
    reg.provide('rateLimiter', a);
    reg.provide('rateLimiter', b, 'sentinel');
    expect(reg.get('rateLimiter')).toBe(b);
    expect(() => reg.provide('rateLimiter', a, 'jarvis')).toThrow(/already provided by sentinel/);
  });
});

describe('HelpRegistry', () => {
  it('filters admin entries and disabled bots', () => {
    const h = new HelpRegistry();
    h.add({ bot: 'cerebro', command: '/perfil', descriptionKey: 'x' });
    h.add({ bot: 'cerebro', command: '/cerebro setup', descriptionKey: 'y', adminOnly: true });
    h.add({ bot: 'jarvis', command: '/trivia', descriptionKey: 'z' });
    expect(h.list().map((e) => e.command)).toEqual(['/perfil', '/trivia']);
    expect(h.list({ includeAdmin: true, bots: ['cerebro'] })).toHaveLength(2);
  });
});

describe('ProfileRegistry', () => {
  it('concatenates sections and skips failing ones', async () => {
    const p = new ProfileRegistry();
    p.add('jarvis', async () => [{ name: 'XP', value: '10' }]);
    p.add('herbie', async () => {
      throw new Error('x');
    });
    const errors: string[] = [];
    const fields = await p.render({ memberId: 'm', discordUserId: 'u' }, 'pt-BR', (bot) => errors.push(bot));
    expect(fields).toEqual([{ name: 'XP', value: '10' }]);
    expect(errors).toEqual(['herbie']);
  });
});

describe('InMemoryRateLimiter', () => {
  it('enforces the limit within a window and resets after it', async () => {
    const clock = new FakeClock('2026-01-01T00:00:00.000Z');
    const rl = new InMemoryRateLimiter(clock);
    for (let n = 0; n < 3; n++) expect((await rl.consume('k', 3, 10_000)).allowed).toBe(true);
    const blocked = await rl.consume('k', 3, 10_000);
    expect(blocked).toEqual({ allowed: false, retryAfterMs: 10_000 });
    expect((await rl.consume('other', 3, 10_000)).allowed).toBe(true);
    clock.advance(10_000);
    expect((await rl.consume('k', 3, 10_000)).allowed).toBe(true);
  });
});
