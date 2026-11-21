import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { coreTables } from '../db/core-tables.js';
import { createTestContext, type TestContext } from '../testing/context.js';
import { auditDetails } from './audit.js';
import { parseActionInput, zonedLocalToIso } from './forms.js';
import { SESSION_COOKIE } from './http.js';
import type { ActionInput } from './registry.js';
import type { DashboardServer } from './server.js';

const OWNER = '300000000000000001';
const ORIGIN = 'http://localhost:8081';

describe('dashboard actions pipeline', () => {
  let t: TestContext;
  let dashboard: DashboardServer;
  let base: string;
  let token: string;
  let csrf: string;
  let calls: ActionInput[];
  let answer: { ok: boolean; message: string };

  beforeEach(async () => {
    t = await createTestContext({ config: { dashboard: { enabled: true } } });
    t.gateway.addMember({ userId: OWNER, isOwner: true, displayName: 'Charles' });
    calls = [];
    answer = { ok: true, message: '50 créditos para Tempestade.' };
    t.runtime.dashboard.action('jarvis', {
      id: 'give',
      titleKey: 'x.give',
      fields: [
        { name: 'member', type: 'member', labelKey: 'x.member', required: true },
        { name: 'amount', type: 'int', labelKey: 'x.amount', required: true, min: 1, max: 1000 },
        { name: 'reason', type: 'text', labelKey: 'x.reason', required: true, max: 200 },
        {
          name: 'kind',
          type: 'select',
          labelKey: 'x.kind',
          options: [{ value: 'bonus' }, { value: 'event' }],
        },
        { name: 'when', type: 'datetime', labelKey: 'x.when' },
      ],
      run: async (input) => {
        calls.push(input);
        return answer;
      },
    });
    dashboard = t.runtime.dashboardServer({ clientId: '1', clientSecret: 's', host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${await dashboard.start()}`;
    const s = await t.runtime.dashboardSessions.create(OWNER);
    token = s.token;
    csrf = s.session.csrfToken;
  });

  afterEach(async () => {
    await dashboard.stop();
    await t.close();
  });

  const audits = () => t.db.orm.select().from(coreTables(t.db).coreAuditLog);
  const formKey = async () => {
    const html = await (
      await fetch(`${base}/a/jarvis/give`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } })
    ).text();
    return /name="idem" value="([^"]+)"/.exec(html)?.[1] ?? '';
  };
  const valid = {
    member: '<@500000000000000001>',
    amount: '50',
    reason: 'evento',
    kind: 'bonus',
    when: '2026-12-01T20:00',
  };
  const post = async (
    fields: Record<string, string>,
    o: { csrf?: string | null; origin?: string | null; idem?: string; cookie?: string } = {},
  ) => {
    const body = new URLSearchParams(fields);
    if (o.csrf !== null) body.set('csrf', o.csrf ?? csrf);
    body.set('idem', o.idem ?? (await formKey()));
    return fetch(`${base}/a/jarvis/give`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: o.cookie ?? `${SESSION_COOKIE}=${token}`,
        'content-type': 'application/x-www-form-urlencoded',
        ...(o.origin === null ? {} : { origin: o.origin ?? ORIGIN }),
      },
      body,
    });
  };

  it('renders every field type with CSRF and a one-use key', async () => {
    const html = await (
      await fetch(`${base}/a/jarvis/give`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } })
    ).text();
    expect(html).toContain('id="f-member" name="member" required');
    expect(html).toMatch(/type="number" id="f-amount"[^>]* min="1" max="1000"/);
    expect(html).toMatch(/type="text" id="f-reason"[^>]* maxlength="200"/);
    expect(html).toContain(
      '<select id="f-kind" name="kind"><option value=""></option><option value="bonus">bonus</option>',
    );
    expect(html).toContain('type="datetime-local" id="f-when"');
    expect(html).toContain(`name="csrf" value="${csrf}"`);
    expect(html).toContain('href="/a/jarvis/give"'); // nav
    expect(html).not.toMatch(/<script/i);
  });

  it('runs the handler once with parsed input and audits it', async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('class="result ok" role="status">50 créditos para Tempestade.');
    expect(calls).toEqual([
      {
        member: '500000000000000001',
        amount: 50,
        reason: 'evento',
        kind: 'bonus',
        when: '2026-12-01T23:00:00.000Z',
      },
    ]);
    const [row] = await audits();
    expect(row).toMatchObject({
      actorDiscordId: OWNER,
      source: 'dashboard',
      action: 'jarvis/give',
      target: '500000000000000001',
    });
    expect(JSON.parse(row?.details ?? '{}')).toMatchObject({ ok: true, input: { amount: 50 } });
  });

  it('shows a service refusal and audits it as ok: false', async () => {
    answer = { ok: false, message: 'Saldo insuficiente.' };
    const html = await (await post(valid)).text();
    expect(html).toContain('class="result fail" role="status">Saldo insuficiente.');
    expect(html).toContain('value="evento"'); // values kept to fix and resend
    expect(JSON.parse((await audits())[0]?.details ?? '{}').ok).toBe(false);
  });

  it('changes nothing on a missing or bad CSRF token, a wrong Origin or an expired session', async () => {
    expect((await post(valid, { csrf: null })).status).toBe(403);
    expect((await post(valid, { csrf: 'nope' })).status).toBe(403);
    expect((await post(valid, { origin: 'https://evil.test' })).status).toBe(403);
    t.clock.advance(12 * 3_600_000);
    const expired = await post(valid, { idem: 'k'.repeat(22) });
    expect(expired.status).toBe(302);
    expect(expired.headers.get('location')).toBe('/login');
    expect(calls).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });

  it('runs a reused key once', async () => {
    const idem = await formKey();
    expect((await post(valid, { idem })).status).toBe(200);
    const again = await post(valid, { idem });
    expect(again.status).toBe(409);
    expect(await again.text()).toContain('já foi enviado');
    expect(calls).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  });

  it('shows field errors for invalid input and changes nothing', async () => {
    const res = await post({
      member: 'fulano',
      amount: '5000',
      reason: '',
      kind: 'other',
      when: '2026-02-30T10:00',
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    for (const [f, msg] of [
      ['member', 'Use o ID do Discord'],
      ['amount', 'Fora do limite (1 a 1000)'],
      ['reason', 'Obrigatório'],
      ['kind', 'Escolha uma das opções'],
      ['when', 'Data e hora inválidas'],
    ])
      expect(html).toContain(`id="f-${f}-err">${msg}`);
    expect(html).toContain('aria-invalid="true"');
    expect(calls).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });

  it('audits a handler crash as a refusal without leaking the error', async () => {
    t.runtime.dashboard.action('jarvis', {
      id: 'boom',
      titleKey: 'x',
      fields: [],
      run: async () => {
        throw new Error('db exploded at /secret/path');
      },
    });
    const page = await (
      await fetch(`${base}/a/jarvis/boom`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } })
    ).text();
    const idem = /name="idem" value="([^"]+)"/.exec(page)?.[1] ?? '';
    const res = await fetch(`${base}/a/jarvis/boom`, {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${token}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf, idem }),
    });
    const html = await res.text();
    expect(html).not.toContain('exploded');
    expect(html).toContain('Algo deu errado');
    expect(JSON.parse((await audits())[0]?.details ?? '{}').ok).toBe(false);
  });

  it('lists audited actions at /audit, newest first', async () => {
    await post(valid);
    t.clock.advance(60_000);
    answer = { ok: false, message: 'não' };
    await post(valid);
    const html = await (
      await fetch(`${base}/audit`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } })
    ).text();
    expect(html.match(/jarvis\/give/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.indexOf('&quot;ok&quot;:false')).toBeLessThan(html.indexOf('&quot;ok&quot;:true'));
  });

  it('answers 404 for an unknown action', async () => {
    const res = await fetch(`${base}/a/jarvis/nope`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(404);
  });
});

describe('action helpers', () => {
  it('reads datetime-local in the server timezone, DST included', () => {
    expect(zonedLocalToIso('2026-12-01T20:00', 'America/Sao_Paulo')).toBe('2026-12-01T23:00:00.000Z');
    expect(zonedLocalToIso('2026-07-01T12:00', 'America/New_York')).toBe('2026-07-01T16:00:00.000Z');
    expect(zonedLocalToIso('2026-01-15T12:00', 'America/New_York')).toBe('2026-01-15T17:00:00.000Z');
    expect(zonedLocalToIso('2026-13-01T12:00', 'UTC')).toBeNull();
    expect(zonedLocalToIso('amanhã', 'UTC')).toBeNull();
  });

  it('turns empty optional fields into null', () => {
    const r = parseActionInput(
      [
        { name: 'note', type: 'text', labelKey: 'x' },
        { name: 'n', type: 'int', labelKey: 'x' },
      ],
      new URLSearchParams({ note: '  ', n: '' }),
      'UTC',
    );
    expect(r).toEqual({ input: { note: null, n: null }, errors: {} });
  });

  it('cuts free text at 200 chars and the details at 2 KB', () => {
    const long = 'x'.repeat(500);
    expect(JSON.parse(auditDetails({ ok: true, input: { reason: long } })).input.reason).toHaveLength(201);
    const huge = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, long]));
    const out = auditDetails({ ok: false, input: huge });
    expect(out.length).toBeLessThanOrEqual(2048);
    expect(JSON.parse(out)).toEqual({ truncated: true, ok: false });
  });

  it('refuses bad action field names', async () => {
    const { DashboardRegistry } = await import('./registry.js');
    const r = new DashboardRegistry();
    const run = async () => ({ ok: true, message: '' });
    expect(() =>
      r.action('x', { id: 'a', titleKey: 'k', fields: [{ name: 'csrf', type: 'text', labelKey: 'k' }], run }),
    ).toThrow();
    expect(() =>
      r.action('x', { id: 'b', titleKey: 'k', fields: [{ name: 's', type: 'select', labelKey: 'k' }], run }),
    ).toThrow();
  });
});
