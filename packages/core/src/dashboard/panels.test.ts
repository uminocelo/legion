import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { coreTables } from '../db/core-tables.js';
import type { MemberView } from '../registries/read-models.js';
import { createTestContext, type TestContext } from '../testing/context.js';
import { SESSION_COOKIE } from './http.js';
import { DashboardRegistry } from './registry.js';
import { renderPanelView } from './render.js';
import type { DashboardServer } from './server.js';

const OWNER = '300000000000000001';

const member = (id: string, faction: string | null): MemberView => ({
  id,
  discordUserId: `5000000000000000${id}`,
  onboardingStep: 'registered',
  faction,
  factionChangedAt: null,
  rank: 'recruta',
  optIns: [],
  leftAt: null,
});

describe('dashboard panels', () => {
  let t: TestContext;
  let dashboard: DashboardServer;
  let base: string;
  let token: string;

  beforeEach(async () => {
    t = await createTestContext({ config: { dashboard: { enabled: true } } });
    t.gateway.addMember({ userId: OWNER, isOwner: true, displayName: 'Charles' });
    const levels: Record<string, number> = { '01': 1, '02': 7, '03': 12, '04': 25, '05': 3 };
    const members = [
      member('01', 'xmen'),
      member('02', 'xmen'),
      member('03', 'independent'),
      member('04', null),
      member('05', 'xmen'),
    ];
    t.runtime.providers.provide('members', {
      getById: async () => null,
      getByDiscordId: async () => null,
      listRegistered: async () => members,
    });
    t.runtime.providers.provide('progress', {
      get: async (id) => ({
        xp: 0,
        level: levels[id] ?? 1,
        rank: 'recruta',
        currentStreak: 0,
        bestStreak: 0,
      }),
    });
    t.runtime.dashboard.panel('jarvis', {
      id: 'heroes',
      titleKey: 'x.heroes',
      render: async () => ({ kind: 'table', columns: ['Codinome'], rows: [['<script>alert(1)</script>']] }),
    });
    t.runtime.dashboard.panel('jarvis', {
      id: 'broken',
      titleKey: 'x.broken',
      render: async () => {
        throw new Error('boom');
      },
    });
    dashboard = t.runtime.dashboardServer({ clientId: '1', clientSecret: 's', host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${await dashboard.start()}`;
    token = (await t.runtime.dashboardSessions.create(OWNER)).token;
  });

  afterEach(async () => {
    await dashboard.stop();
    await t.close();
  });

  const get = (path: string, auth = true) =>
    fetch(`${base}${path}`, {
      redirect: 'manual',
      headers: auth ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
    });

  it('shows the core members panel per faction and level band', async () => {
    const res = await get('/p/core/members');
    expect(res.status).toBe(200);
    const html = await res.text();
    const rows = [...html.matchAll(/<tr>(.*?)<\/tr>/g)].map((m) =>
      [...(m[1] ?? '').matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map((c) => c[1]),
    );
    expect(rows[0]).toEqual(['Facção', 'Registrados', 'Nível 1–4', 'Nível 5–9', 'Nível 10–19', 'Nível 20+']);
    expect(rows.find((r) => r[0]?.includes('X-Men'))?.slice(1)).toEqual(['3', '2', '1', '0', '0']);
    expect(rows.find((r) => r[0]?.includes('Independente'))?.slice(1)).toEqual(['1', '0', '0', '1', '0']);
    expect(rows.find((r) => r[0] === 'Sem facção')?.slice(1)).toEqual(['1', '0', '0', '0', '1']);
    expect(rows.at(-1)).toEqual(['Total', '5', '2', '1', '1', '1']);
  });

  it('escapes panel values and keeps pages script-free', async () => {
    const html = await (await get('/p/jarvis/heroes')).text();
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/style=/i);
    expect(html).toContain('<link rel="stylesheet" href="/assets/dashboard.css">');
  });

  it('answers 404 for an unknown panel and asks for login without a session', async () => {
    expect((await get('/p/core/nope')).status).toBe(404);
    expect((await get('/p/ghost/members')).status).toBe(404);
    const anon = await get('/p/core/members', false);
    expect(anon.status).toBe(302);
    expect(anon.headers.get('location')).toBe('/login');
  });

  it('renders every panel on the overview with navigation, isolating a failing panel', async () => {
    const html = await (await get('/')).text();
    expect(html).toContain('<a href="/" aria-current="page">');
    expect(html).toContain('<li><a href="/p/core/members">Membros</a></li>');
    expect(html).toContain('href="/p/jarvis/heroes"');
    expect(html).toContain('href="/audit"');
    expect(html).toContain('Não consegui carregar este painel.');
    expect(html).toContain('Total');
  });

  it('serves the stylesheet', async () => {
    const res = await get('/assets/dashboard.css', false);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    expect(await res.text()).toContain('overflow-x:auto');
  });

  it('shows the audit log empty, then newest first, 50 per page', async () => {
    expect(await (await get('/audit')).text()).toContain('Nenhuma ação da staff registrada ainda.');
    const a = coreTables(t.db).coreAuditLog;
    await t.db.orm.insert(a).values(
      Array.from({ length: 55 }, (_, n) => ({
        id: `a${String(n).padStart(3, '0')}`,
        guildId: t.gateway.guildId,
        actorDiscordId: OWNER,
        source: 'dashboard',
        action: `act-${n}`,
        target: null,
        details: '{}',
        createdAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(),
      })),
    );
    const first = await (await get('/audit')).text();
    expect(first.indexOf('act-54')).toBeLessThan(first.indexOf('act-53'));
    expect(first).not.toContain('act-4<');
    expect(first).toContain('href="/audit?page=2"');
    const second = await (await get('/audit?page=2')).text();
    expect(second).toContain('act-0<');
    expect(second).toContain('href="/audit?page=1"');
    expect(second).not.toContain('page=3');
  });
});

describe('panel registry and renderer', () => {
  it('rejects bad and duplicate ids and lists core first', () => {
    const r = new DashboardRegistry();
    const spec = { id: 'war', titleKey: 'k', render: async () => ({ kind: 'stats' as const, items: [] }) };
    r.panel('ultron', spec);
    r.panel('core', { ...spec, id: 'members' });
    expect(() => r.panel('ultron', spec)).toThrow(/already/);
    expect(() => r.panel('ultron', { ...spec, id: 'Bad/Id' })).toThrow(/invalid/);
    expect(r.list().map((p) => `${p.bot}/${p.id}`)).toEqual(['core/members', 'ultron/war']);
  });

  it('renders stats with translated labels and locale numbers', () => {
    const html = renderPanelView(
      {
        kind: 'stats',
        items: [
          { labelKey: 'k.credits', value: 12345 },
          { labelKey: 'k.<b>', value: '<i>' },
        ],
      },
      (k) => (k === 'k.credits' ? 'Créditos' : k),
      'pt-BR',
    );
    expect(html).toContain('<dt>Créditos</dt><dd>12.345</dd>');
    expect(html).toContain('<dt>k.&lt;b&gt;</dt><dd>&lt;i&gt;</dd>');
  });
});
