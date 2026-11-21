import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseConfig, parseEnv } from '@legion/core';
import { describe, expect, it } from 'vitest';
import { dashboardCheck } from './doctor.js';
import { msg } from './messages.js';

const SECRET = 'very-secret-dashboard-value';
const t = (k: Parameters<typeof msg>[1], v?: Record<string, string | number>) => msg('pt-BR', k, v);
const env = (secret?: string) =>
  parseEnv({
    CEREBRO_TOKEN: 't',
    CEREBRO_CLIENT_ID: '123456789',
    DISCORD_GUILD_ID: '100000000000000001',
    ...(secret ? { DASHBOARD_CLIENT_SECRET: secret } : {}),
  });
const cfg = (dashboard: Record<string, unknown>) => parseConfig({ dashboard });
const free = async () => true;

describe('doctor dashboard check', () => {
  it('is info when off', async () => {
    expect((await dashboardCheck(cfg({}), env(), t, free)).status).toBe('info');
  });

  it('fails when on without the secret', async () => {
    const r = await dashboardCheck(cfg({ enabled: true }), env(), t, free);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('DASHBOARD_CLIENT_SECRET');
  });

  it('fails when the port is taken by another program', async () => {
    const other = createServer((_q, s) => s.end('not legion'));
    await new Promise<void>((r) => other.listen(0, '0.0.0.0', () => r()));
    const port = (other.address() as AddressInfo).port;
    try {
      const r = await dashboardCheck(cfg({ enabled: true, port }), env(SECRET), t);
      expect(r.status).toBe('fail');
      expect(r.message).toContain(String(port));
    } finally {
      other.close();
    }
  });

  it('warns for a publicUrl that is neither localhost nor https', async () => {
    const r = await dashboardCheck(
      cfg({ enabled: true, publicUrl: 'http://192.168.0.10:8081' }),
      env(SECRET),
      t,
      free,
    );
    expect(r.status).toBe('warn');
    expect(
      (
        await dashboardCheck(
          cfg({ enabled: true, publicUrl: 'https://painel.example.com' }),
          env(SECRET),
          t,
          free,
        )
      ).status,
    ).toBe('ok');
  });

  it('is ok on localhost and never shows the secret', async () => {
    const results = await Promise.all([
      dashboardCheck(cfg({ enabled: true }), env(SECRET), t, free),
      dashboardCheck(cfg({ enabled: true, publicUrl: 'http://10.0.0.1' }), env(SECRET), t, free),
      dashboardCheck(cfg({ enabled: true }), env(SECRET), t, async () => false),
    ]);
    expect(results[0]?.status).toBe('ok');
    expect(JSON.stringify(results)).not.toContain(SECRET);
  });
});
