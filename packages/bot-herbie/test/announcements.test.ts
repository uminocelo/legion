import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { announceOrigins, herbie, ORIGINS_ANNOUNCEMENT_KEY } from '../src/index.js';
import { addMember, CH, setupHerbie } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const posts = (tc: TestContext) =>
  tc.gateway.messages.filter((m) => m.msg.embeds?.[0]?.title === '🌟 Novidade na Legião: origens!');

describe('origins announcement (v0.9)', () => {
  it('posts once per server in the tutorial channel, never DMs, and not again after a restart', async () => {
    t = await setupHerbie({ config: { channels: { welcome: CH.welcome, tutorial: CH.tutorial } } });
    await addMember(t, '111');
    await addMember(t, '222');
    await t.runtime.ready({ startPolling: false });
    expect(posts(t)).toHaveLength(1);
    expect(posts(t)[0]?.channelId).toBe(CH.tutorial);
    expect(posts(t)[0]?.msg.embeds?.[0]?.description).toContain('/heroi origem');
    expect(t.gateway.calls.filter((c) => c.method === 'sendDm')).toEqual([]);
    // Restart: onReady runs again; the kv record stops a second post.
    await t.runtime.ready({ startPolling: false });
    expect(await announceOrigins(t.ctxOf(herbie))).toBe('done');
    expect(posts(t)).toHaveLength(1);
    expect(await t.ctxOf(herbie).kv.get(ORIGINS_ANNOUNCEMENT_KEY)).toMatchObject({
      channelId: CH.tutorial,
      posted: true,
    });
  });

  it('a new server with no heroes is marked done without a post', async () => {
    t = await setupHerbie();
    expect(await announceOrigins(t.ctxOf(herbie))).toBe('skipped');
    await addMember(t, '111');
    expect(await announceOrigins(t.ctxOf(herbie))).toBe('done');
    expect(posts(t)).toHaveLength(0);
  });

  it('falls back to the welcome channel, and retries next start when it cannot post', async () => {
    t = await setupHerbie();
    await addMember(t, '111');
    t.gateway.failNext('sendMessage', new Error('Missing Access'));
    expect(await announceOrigins(t.ctxOf(herbie))).toBe('no_channel');
    expect(await announceOrigins(t.ctxOf(herbie))).toBe('posted');
    expect(posts(t).map((p) => p.channelId)).toEqual([CH.welcome]);
  });
});
