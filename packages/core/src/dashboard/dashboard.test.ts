import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../config/load.js';
import { coreTables } from '../db/core-tables.js';
import { createLogger } from '../log/logger.js';
import { createTestContext, type TestContext } from '../testing/context.js';
import { cookie, escapeHtml, parseCookies, SESSION_COOKIE, STATE_COOKIE } from './http.js';
import { DiscordOAuth } from './oauth.js';
import type { DashboardServer } from './server.js';
import { hashToken } from './sessions.js';

const OWNER = '300000000000000001';
const ADMIN = '300000000000000002';
const COUNCIL = '300000000000000003';
const PLAYER = '300000000000000004';
const SECRET = 'super-secret-value';

/** In-process fake of Discord's OAuth2 endpoints (D28): one-use codes, tokens → users. */
async function fakeDiscord() {
  const codes = new Map<string, string>(); // code → user id
  const tokens = new Map<string, string>(); // access token → user id
  const seen: { path: string; auth: string | undefined; body: string }[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      seen.push({ path: req.url ?? '', auth: req.headers.authorization, body });
      const json = (status: number, v: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(v));
      };
      if (req.method === 'POST' && req.url === '/oauth2/token') {
        const code = new URLSearchParams(body).get('code') ?? '';
        const user = codes.get(code);
        codes.delete(code); // single use
        if (!user) return json(400, { error: 'invalid_grant' });
        const at = `at-${user}-${tokens.size}`;
        tokens.set(at, user);
        return json(200, { access_token: at, token_type: 'Bearer', scope: 'identify' });
      }
      if (req.method === 'GET' && req.url === '/users/@me') {
        const user = tokens.get((req.headers.authorization ?? '').replace('Bearer ', ''));
        if (!user) return json(401, { message: '401: Unauthorized' });
        return json(200, { id: user, username: `u${user.slice(-2)}` });
      }
      json(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    seen,
    issue(code: string, userId: string) {
      codes.set(code, userId);
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('dashboard login and sessions', () => {
  let t: TestContext;
  let discord: Awaited<ReturnType<typeof fakeDiscord>>;
  let dashboard: DashboardServer;
  let base: string;

  beforeEach(async () => {
    t = await createTestContext({ config: { dashboard: { enabled: true } } });
    discord = await fakeDiscord();
    const g = t.gateway;
    const admin = g.addRole({ name: 'Admins', permissions: ['Administrator'] });
    const council = g.addRole({ name: 'Conselho da Legião', permissions: ['ViewChannel'] });
    g.addRole({ id: g.guildId, name: '@everyone', position: 0, permissions: ['ViewChannel'] });
    g.addMember({ userId: OWNER, isOwner: true, displayName: 'Charles' });
    g.addMember({ userId: ADMIN, roleIds: [admin.id], displayName: 'Admin <b>' });
    g.addMember({ userId: COUNCIL, roleIds: [council.id], displayName: 'Jean' });
    g.addMember({ userId: PLAYER, displayName: 'Logan' });
    dashboard = t.runtime.dashboardServer({
      clientId: '400000000000000001',
      clientSecret: SECRET,
      oauth: new DiscordOAuth({
        clientId: '400000000000000001',
        clientSecret: SECRET,
        apiBase: discord.base,
        authorizeBase: 'https://discord.test/oauth2/authorize',
      }),
      host: '127.0.0.1',
      port: 0,
    });
    base = `http://127.0.0.1:${await dashboard.start()}`;
  });

  afterEach(async () => {
    await dashboard.stop();
    await discord.close();
    await t.close();
  });

  const get = (path: string, cookies: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      redirect: 'manual',
      headers: {
        cookie: Object.entries(cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
      },
    });

  const setCookies = (res: Response) => {
    const out = new Map<string, string>();
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = (pair ?? '').split('=');
      if (k) out.set(k, decodeURIComponent(v ?? ''));
    }
    return out;
  };

  /** /login → state cookie; Discord "approves" with a code; /callback. */
  const loginAs = async (userId: string) => {
    const login = await get('/login');
    const state = setCookies(login).get(STATE_COOKIE) ?? '';
    discord.issue(`code-${userId}`, userId);
    return get(`/callback?code=code-${userId}&state=${state}`, { [STATE_COOKIE]: state });
  };

  const sessionOf = async (userId: string) => {
    const res = await loginAs(userId);
    expect(res.status).toBe(302);
    const token = setCookies(res).get(SESSION_COOKIE);
    expect(token).toBeTruthy();
    return token as string;
  };

  const sessionRows = async () => {
    const s = coreTables(t.db).coreDashboardSessions;
    return t.db.orm.select().from(s);
  };

  it('sends no session to /login and /login to Discord with scope identify and a state cookie', async () => {
    const home = await get('/');
    expect(home.status).toBe(302);
    expect(home.headers.get('location')).toBe('/login');

    const login = await get('/login');
    expect(login.status).toBe(302);
    const to = new URL(login.headers.get('location') ?? '');
    expect(to.origin + to.pathname).toBe('https://discord.test/oauth2/authorize');
    expect(to.searchParams.get('scope')).toBe('identify');
    expect(to.searchParams.get('redirect_uri')).toBe('http://localhost:8081/callback');
    const state = setCookies(login).get(STATE_COOKIE);
    expect(state).toBe(to.searchParams.get('state'));
    const raw = login.headers.getSetCookie().join('\n');
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    expect(raw).toContain('Max-Age=600');
    expect(raw).not.toContain('Secure'); // http publicUrl
  });

  it.each([
    ['the owner', OWNER],
    ['an Administrator', ADMIN],
    ['the staff role', COUNCIL],
  ])('lets %s in with a hashed session and the security headers', async (_who, userId) => {
    const res = await loginAs(userId);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    const token = setCookies(res).get(SESSION_COOKIE) ?? '';
    const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? '';
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    expect(raw).toContain(`Max-Age=${12 * 3600}`);

    const rows = await sessionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashToken(token));
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(rows[0]?.discordUserId).toBe(userId);
    expect(rows[0]?.expiresAt).toBe('2026-11-17T03:00:00.000Z');

    // Discord got the secret only as Basic auth on the token call.
    const tokenCall = discord.seen.find((s) => s.path === '/oauth2/token');
    expect(tokenCall?.auth).toBe(`Basic ${Buffer.from(`400000000000000001:${SECRET}`).toString('base64')}`);
    expect(tokenCall?.body).not.toContain(SECRET);

    const home = await get('/', { [SESSION_COOKIE]: token });
    expect(home.status).toBe(200);
    expect(home.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(home.headers.get('x-frame-options')).toBe('DENY');
    expect(home.headers.get('referrer-policy')).toBe('same-origin');
    const html = await home.text();
    expect(html).not.toContain('<script');
    expect(html).toContain(`value="${rows[0]?.csrfToken}"`);
    if (userId === ADMIN) expect(html).toContain('Admin &lt;b&gt;');
  });

  it('refuses a player with 403 and no session', async () => {
    const res = await loginAs(PLAYER);
    expect(res.status).toBe(403);
    expect(setCookies(res).has(SESSION_COOKIE)).toBe(false);
    expect(await sessionRows()).toHaveLength(0);
  });

  it('refuses a wrong or missing state', async () => {
    const login = await get('/login');
    const state = setCookies(login).get(STATE_COOKIE) ?? '';
    discord.issue('c1', OWNER);
    expect((await get(`/callback?code=c1&state=other`, { [STATE_COOKIE]: state })).status).toBe(400);
    expect((await get(`/callback?code=c1&state=${state}`)).status).toBe(400);
    expect((await get(`/callback?state=${state}`, { [STATE_COOKIE]: state })).status).toBe(400);
    expect(await sessionRows()).toHaveLength(0);
    // the code was never sent to Discord
    expect(discord.seen.some((s) => s.path === '/oauth2/token')).toBe(false);
  });

  it('refuses an expired or reused code', async () => {
    const login = await get('/login');
    const state = setCookies(login).get(STATE_COOKIE) ?? '';
    const expired = await get(`/callback?code=never-issued&state=${state}`, { [STATE_COOKIE]: state });
    expect(expired.status).toBe(400);
    expect(await expired.text()).toContain('código pode ter expirado');

    discord.issue('once', OWNER);
    expect((await get(`/callback?code=once&state=${state}`, { [STATE_COOKIE]: state })).status).toBe(302);
    expect((await get(`/callback?code=once&state=${state}`, { [STATE_COOKIE]: state })).status).toBe(400);
  });

  it('ends a revoked staff session within 60 s', async () => {
    const token = await sessionOf(COUNCIL);
    t.gateway.addMember({ userId: COUNCIL, roleIds: [], displayName: 'Jean' }); // role removed
    expect((await get('/', { [SESSION_COOKIE]: token })).status).toBe(200); // cached answer
    t.clock.advance(60_000);
    const res = await get('/', { [SESSION_COOKIE]: token });
    expect(res.status).toBe(403);
    expect(setCookies(res).get(SESSION_COOKIE)).toBe('');
    expect(await sessionRows()).toHaveLength(0);
  });

  it('answers 503 without dropping the session when Discord cannot be reached', async () => {
    const token = await sessionOf(OWNER);
    t.clock.advance(60_000);
    t.gateway.failNext('fetchMember');
    expect((await get('/', { [SESSION_COOKIE]: token })).status).toBe(503);
    expect(await sessionRows()).toHaveLength(1);
    expect((await get('/', { [SESSION_COOKIE]: token })).status).toBe(200);
  });

  it('expires a session after sessionHours and purges it', async () => {
    const token = await sessionOf(OWNER);
    t.clock.advance(12 * 3_600_000);
    const res = await get('/', { [SESSION_COOKIE]: token });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
    expect(await sessionRows()).toHaveLength(0);

    await sessionOf(OWNER);
    t.clock.advance(13 * 3_600_000);
    expect(await t.runtime.dashboardSessions.purgeExpired()).toBe(1);
  });

  it('makes a new session on every login and drops the old one', async () => {
    const first = await sessionOf(OWNER);
    const login = await get('/login');
    const state = setCookies(login).get(STATE_COOKIE) ?? '';
    discord.issue('again', OWNER);
    const res = await get(`/callback?code=again&state=${state}`, {
      [STATE_COOKIE]: state,
      [SESSION_COOKIE]: first,
    });
    const second = setCookies(res).get(SESSION_COOKIE);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect((await sessionRows()).map((r) => r.tokenHash)).toEqual([hashToken(second as string)]);
  });

  it('logs out only with the CSRF token and a matching Origin', async () => {
    const token = await sessionOf(OWNER);
    const [row] = await sessionRows();
    const post = (body: string, headers: Record<string, string> = {}) =>
      fetch(`${base}/logout`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          cookie: `${SESSION_COOKIE}=${token}`,
          'content-type': 'application/x-www-form-urlencoded',
          ...headers,
        },
        body,
      });
    expect((await post('csrf=wrong')).status).toBe(403);
    expect((await post(`csrf=${row?.csrfToken}`, { origin: 'https://evil.test' })).status).toBe(403);
    expect(await sessionRows()).toHaveLength(1);

    const ok = await post(`csrf=${row?.csrfToken}`, { origin: 'http://localhost:8081' });
    expect(ok.status).toBe(200);
    expect(setCookies(ok).get(SESSION_COOKIE)).toBe('');
    expect(await sessionRows()).toHaveLength(0);
    expect((await get('/', { [SESSION_COOKIE]: token })).status).toBe(302);
  });

  it('answers 404 for unknown paths and 405 for other methods', async () => {
    expect((await get('/nope')).status).toBe(404);
    const res = await fetch(`${base}/logout`, { redirect: 'manual' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect((await fetch(`${base}/login`, { method: 'POST', redirect: 'manual' })).status).toBe(405);
  });

  it('rate limits the callback to 10 per minute per IP', async () => {
    for (let n = 0; n < 10; n++) expect((await get('/callback?code=x&state=y')).status).toBe(400);
    const limited = await get('/callback?code=x&state=y');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    t.clock.advance(60_000);
    expect((await get('/callback?code=x&state=y')).status).toBe(400);
  });

  it('keeps the session row keyed only by the hash', async () => {
    const token = await sessionOf(OWNER);
    const s = coreTables(t.db).coreDashboardSessions;
    expect(await t.db.orm.select().from(s).where(eq(s.tokenHash, token))).toHaveLength(0);
  });
});

describe('dashboard https cookies', () => {
  it('marks cookies Secure when publicUrl is https', async () => {
    const t = await createTestContext({
      config: { dashboard: { enabled: true, publicUrl: 'https://painel.example.com/' } },
    });
    const d = t.runtime.dashboardServer({ clientId: '1', clientSecret: 's', host: '127.0.0.1', port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${await d.start()}/login`, { redirect: 'manual' });
      expect(res.headers.getSetCookie().join()).toContain('Secure');
      expect(new URL(res.headers.get('location') ?? '').searchParams.get('redirect_uri')).toBe(
        'https://painel.example.com/callback',
      );
    } finally {
      await d.stop();
      await t.close();
    }
  });
});

describe('dashboard config, secret and helpers', () => {
  it('defaults to off with the spec values and rejects a non-http publicUrl', () => {
    expect(parseConfig({}).dashboard).toEqual({
      enabled: false,
      port: 8081,
      publicUrl: 'http://localhost:8081',
      sessionHours: 12,
      auditDays: 180,
    });
    expect(() => parseConfig({ dashboard: { publicUrl: 'ftp://x' } })).toThrow();
  });

  it('never logs the client secret', () => {
    const lines: string[] = [];
    const log = createLogger({ destination: { write: (s: string) => lines.push(s) } });
    log.info({ DASHBOARD_CLIENT_SECRET: SECRET, env: { DASHBOARD_CLIENT_SECRET: SECRET } }, 'boot');
    log.info({ oauth: { clientSecret: SECRET } }, 'x');
    expect(lines.join('')).not.toContain(SECRET);
  });

  it('escapes HTML and round-trips cookies', () => {
    expect(escapeHtml(`<script>"&'`)).toBe('&lt;script&gt;&quot;&amp;&#39;');
    const c = cookie('a', 'x y', { maxAgeSeconds: 5, secure: true });
    expect(parseCookies(c.split(';')[0]).get('a')).toBe('x y');
    expect(parseCookies('a=%E0%A4%A; b=2').get('b')).toBe('2');
  });
});
