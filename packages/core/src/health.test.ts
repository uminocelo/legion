import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { startHealthServer } from './health.js';

describe('health server', () => {
  it('is 503 until Discord is ready, then 200', async () => {
    let ready = false;
    const server = await startHealthServer(
      0,
      { dbOk: async () => true, discordReady: () => ready },
      '127.0.0.1',
    );
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/healthz`;
    try {
      expect((await fetch(url)).status).toBe(503);
      ready = true;
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok', db: true, discord: true });
      expect((await fetch(url.replace('healthz', 'x'))).status).toBe(404);
    } finally {
      server.close();
    }
  });

  it('is 503 when the DB does not answer', async () => {
    const server = await startHealthServer(
      0,
      { dbOk: async () => false, discordReady: () => true },
      '127.0.0.1',
    );
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/healthz`);
      expect(res.status).toBe(503);
    } finally {
      server.close();
    }
  });
});
