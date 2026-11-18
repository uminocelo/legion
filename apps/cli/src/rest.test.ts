import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiscordRest, RestError } from './rest.js';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe('Discord REST client', () => {
  it("waits Discord's retry_after on 429 and retries", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json(429, { message: 'You are being rate limited.', retry_after: 1.5, global: false }),
      )
      .mockResolvedValueOnce(json(200, [{ id: '1', name: 'geral', type: 0 }]));
    vi.stubGlobal('fetch', fetch);
    const waits: number[] = [];
    const rest = createDiscordRest('t', 'https://x', async (ms) => {
      waits.push(ms);
    });
    expect(await rest.guildChannels('9')).toEqual([{ id: '1', name: 'geral', type: 0 }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([1750]);
  });

  it('uses the Retry-After header when the body has no retry_after', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(json(200, []));
    vi.stubGlobal('fetch', fetch);
    const waits: number[] = [];
    await createDiscordRest('t', 'https://x', async (ms) => {
      waits.push(ms);
    }).guildRoles('9');
    expect(waits).toEqual([2250]);
  });

  it('gives up after 3 retries or when the wait is too long, with the status in the error', async () => {
    const limited = () => json(429, { retry_after: 1 });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => limited()),
    );
    const rest = createDiscordRest('t', 'https://x', async () => {});
    await expect(rest.guildChannels('9')).rejects.toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledTimes(4);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(429, { retry_after: 3600 })));
    const err = await createDiscordRest('t', 'https://x', async () => {})
      .guildChannels('9')
      .catch((e) => e);
    expect(err).toBeInstanceOf(RestError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
