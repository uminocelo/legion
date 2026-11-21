import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { desc } from 'drizzle-orm';
import type { DashboardConfig } from '../config/schema.js';
import { coreTables } from '../db/core-tables.js';
import type { LegionDb } from '../db/db.js';
import type { I18n, Vars } from '../i18n/i18n.js';
import type { Logger } from '../log/logger.js';
import { InMemoryRateLimiter } from '../ratelimit/rate-limiter.js';
import type { Clock } from '../time/clock.js';
import type { AuditLog } from './audit.js';
import { type FieldErrors, parseActionInput, renderActionForm } from './forms.js';
import {
  cookie,
  escapeHtml,
  parseCookies,
  readForm,
  redirect,
  SECURITY_HEADERS,
  SESSION_COOKIE,
  STATE_COOKIE,
  send,
} from './http.js';
import type { IdempotencyKeys } from './idempotency.js';
import { type DashboardOAuth, OAuthError } from './oauth.js';
import type { DashboardRegistry, RegisteredPanel } from './registry.js';
import { DASHBOARD_CSS, renderPanelView } from './render.js';
import { type DashboardSession, type DashboardSessionStore, randomToken } from './sessions.js';
import type { DashboardStaffChecker, StaffStatus } from './staff.js';

const STATE_MAX_AGE_S = 600;
const CALLBACK_LIMIT = 10;
const CALLBACK_WINDOW_MS = 60_000;
const AUDIT_PAGE = 50;
const PANEL_PATH = /^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)$/;
const ACTION_PATH = /^\/a\/([a-z0-9-]+)\/([a-z0-9-]+)$/;

export interface DashboardServerOptions {
  config: DashboardConfig;
  oauth: DashboardOAuth;
  sessions: DashboardSessionStore;
  staff: DashboardStaffChecker;
  i18n: I18n;
  registry: DashboardRegistry;
  db: LegionDb;
  audit: AuditLog;
  idempotency: IdempotencyKeys;
  /** Server timezone (`datetime` fields are read in it). */
  timezone: string;
  clock: Clock;
  log: Logger;
  /** Listen address (default all interfaces; compose publishes it on 127.0.0.1 only). */
  host?: string;
  /** Overrides `config.port` (tests listen on 0). */
  port?: number;
}

/** A logged-in staff request. */
export interface DashboardRequest {
  session: DashboardSession;
  staff: StaffStatus;
}

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void;

/** The staff dashboard HTTP server (US-20): Discord login, sessions and the staff re-check. */
export class DashboardServer {
  private server: Server | null = null;
  private readonly limiter: InMemoryRateLimiter;
  private readonly secure: boolean;
  private readonly origin: string;
  private readonly redirectUri: string;
  private readonly routes: Record<string, Partial<Record<string, Handler>>>;

  constructor(private readonly o: DashboardServerOptions) {
    this.limiter = new InMemoryRateLimiter(o.clock);
    const base = new URL(o.config.publicUrl);
    this.secure = base.protocol === 'https:';
    this.origin = base.origin;
    this.redirectUri = `${o.config.publicUrl}/callback`;
    this.routes = {
      '/': { GET: (req, res) => this.overview(req, res) },
      '/login': { GET: (_req, res) => this.login(res) },
      '/callback': { GET: (req, res, url) => this.callback(req, res, url) },
      '/logout': { POST: (req, res) => this.logout(req, res) },
      '/audit': { GET: (req, res, url) => this.audit(req, res, url) },
      '/assets/dashboard.css': {
        GET: (_req, res) => {
          res.writeHead(200, {
            ...SECURITY_HEADERS,
            'content-type': 'text/css; charset=utf-8',
            'cache-control': 'public, max-age=3600',
          });
          res.end(DASHBOARD_CSS);
        },
      },
    };
  }

  /** Starts listening; resolves with the bound port. */
  async start(): Promise<number> {
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.o.port ?? this.o.config.port, this.o.host ?? '0.0.0.0', () => resolve());
    });
    this.server = server;
    return (server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', this.origin);
      const panel = PANEL_PATH.exec(url.pathname);
      const action = ACTION_PATH.exec(url.pathname);
      const route: Partial<Record<string, Handler>> | undefined = panel
        ? { GET: () => this.panel(req, res, panel[1] ?? '', panel[2] ?? '') }
        : action
          ? {
              GET: () => this.actionForm(req, res, action[1] ?? '', action[2] ?? ''),
              POST: () => this.actionRun(req, res, action[1] ?? '', action[2] ?? ''),
            }
          : this.routes[url.pathname];
      if (!route) return this.page(res, 404, 'not_found');
      const handler = route[req.method ?? 'GET'];
      if (!handler) {
        res.setHeader('allow', Object.keys(route).join(', '));
        return this.page(res, 405, 'method_not_allowed');
      }
      await handler(req, res, url);
    } catch (err) {
      this.o.log.error({ err, path: req.url?.split('?')[0] }, 'dashboard request failed');
      if (!res.headersSent) this.page(res, 500, 'error');
      else res.end();
    }
  }

  // ── routes ──────────────────────────────────────────────────────────────

  private login(res: ServerResponse): void {
    const state = randomToken(16);
    redirect(res, this.o.oauth.authorizeUrl(state, this.redirectUri), {
      'set-cookie': cookie(STATE_COOKIE, state, { maxAgeSeconds: STATE_MAX_AGE_S, secure: this.secure }),
    });
  }

  private async callback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const limit = await this.limiter.consume(`dashboard.callback:${ip}`, CALLBACK_LIMIT, CALLBACK_WINDOW_MS);
    if (!limit.allowed) {
      const seconds = Math.ceil(limit.retryAfterMs / 1000);
      return this.page(res, 429, 'rate_limited', { seconds }, { 'retry-after': String(seconds) });
    }
    const cookies = parseCookies(req.headers.cookie);
    const clearState = cookie(STATE_COOKIE, '', { maxAgeSeconds: 0, secure: this.secure });
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const expected = cookies.get(STATE_COOKIE);
    if (!code || !state || !expected || !safeEqual(state, expected))
      return this.page(res, 400, 'bad_state', {}, { 'set-cookie': clearState });

    let user: { id: string; username: string };
    try {
      // The access token is used once here and never stored.
      user = await this.o.oauth.identify(await this.o.oauth.exchange(code, this.redirectUri));
    } catch (err) {
      if (!(err instanceof OAuthError)) throw err;
      this.o.log.warn({ reason: err.message }, 'dashboard login failed');
      // Discord refused the code (expired, reused) → 400; Discord unreachable or erroring → 502.
      const down = err.status === null || err.status >= 500;
      return this.page(
        res,
        down ? 502 : 400,
        down ? 'unavailable' : 'login_failed',
        {},
        { 'set-cookie': clearState },
      );
    }

    let staff: StaffStatus;
    try {
      staff = await this.o.staff.check(user.id, { fresh: true });
    } catch (err) {
      this.o.log.warn({ err }, 'dashboard staff check failed');
      return this.page(res, 502, 'unavailable', {}, { 'set-cookie': clearState });
    }
    if (!staff.staff) {
      this.o.log.info({ discordUserId: user.id }, 'dashboard login refused: not staff');
      return this.page(res, 403, 'forbidden', {}, { 'set-cookie': clearState });
    }

    // A new session on every login; the old one (if any) is dropped.
    const old = cookies.get(SESSION_COOKIE);
    if (old) await this.o.sessions.delete(old);
    const { token } = await this.o.sessions.create(user.id);
    this.o.log.info({ discordUserId: user.id }, 'dashboard login');
    redirect(res, '/', {
      'set-cookie': [
        clearState,
        cookie(SESSION_COOKIE, token, {
          maxAgeSeconds: this.o.config.sessionHours * 3600,
          secure: this.secure,
        }),
      ],
    });
  }

  private async logout(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.sameOrigin(req)) return this.page(res, 403, 'csrf');
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    const session = token ? await this.o.sessions.find(token) : null;
    if (session) {
      const form = await readForm(req);
      const csrf = form?.get('csrf') ?? '';
      if (!safeEqual(csrf, session.csrfToken)) return this.page(res, 403, 'csrf');
      await this.o.sessions.deleteHash(session.tokenHash);
    }
    send(
      res,
      200,
      this.layout(this.t('logged_out'), `<p><a href="/login">${escapeHtml(this.t('login_again'))}</a></p>`),
      {
        'set-cookie': this.clearSession(),
      },
    );
  }

  private async overview(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const r = await this.authenticate(req, res);
    if (!r) return;
    const panels = this.o.registry.list();
    const body = panels.length
      ? (await Promise.all(panels.map((p) => this.section(p, true)))).join('')
      : `<p class="muted">${escapeHtml(this.t('no_panels'))}</p>`;
    send(res, 200, this.layout(this.t('overview'), body, r, '/'));
  }

  private async panel(req: IncomingMessage, res: ServerResponse, bot: string, id: string): Promise<void> {
    const r = await this.authenticate(req, res);
    if (!r) return;
    const p = this.o.registry.get(bot, id);
    if (!p) return this.page(res, 404, 'not_found', {}, {}, r);
    send(
      res,
      200,
      this.layout(this.o.i18n.t(p.titleKey), await this.section(p, false), r, `/p/${bot}/${id}`),
    );
  }

  private async audit(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const r = await this.authenticate(req, res);
    if (!r) return;
    const page = Math.max(1, Math.min(10_000, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1));
    const a = coreTables(this.o.db).coreAuditLog;
    const rows = await this.o.db.orm
      .select()
      .from(a)
      .orderBy(desc(a.createdAt), desc(a.id))
      .limit(AUDIT_PAGE + 1)
      .offset((page - 1) * AUDIT_PAGE);
    const locale = this.o.i18n.defaultLocale;
    const when = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
    const view = {
      kind: 'table' as const,
      columns: ['when', 'actor', 'source', 'action', 'target', 'details'].map((c) => this.t(`audit.${c}`)),
      rows: rows
        .slice(0, AUDIT_PAGE)
        .map((x) => [
          when.format(new Date(x.createdAt)),
          x.actorDiscordId,
          x.source,
          x.action,
          x.target ?? '',
          x.details,
        ]),
    };
    const pager = [
      page > 1 ? `<a href="/audit?page=${page - 1}">${escapeHtml(this.t('audit.newer'))}</a>` : '',
      rows.length > AUDIT_PAGE
        ? `<a href="/audit?page=${page + 1}">${escapeHtml(this.t('audit.older'))}</a>`
        : '',
    ].join('');
    const body = rows.length
      ? `<section>${renderPanelView(view, (k) => k, locale)}<div class="pager">${pager}</div></section>`
      : `<p class="muted">${escapeHtml(this.t('audit.empty'))}</p>`;
    send(res, 200, this.layout(this.t('audit.title'), body, r, '/audit'));
  }

  private async actionForm(
    req: IncomingMessage,
    res: ServerResponse,
    bot: string,
    id: string,
  ): Promise<void> {
    const r = await this.authenticate(req, res);
    if (!r) return;
    const a = this.o.registry.getAction(bot, id);
    if (!a) return this.page(res, 404, 'not_found', {}, {}, r);
    this.sendForm(res, 200, r, bot, id, new URLSearchParams(), {});
  }

  /**
   * POST pipeline (US-21): session → CSRF → Origin → one-use key → input → handler → audit.
   * Every refusal before the handler changes nothing and is not audited.
   */
  private async actionRun(req: IncomingMessage, res: ServerResponse, bot: string, id: string): Promise<void> {
    const r = await this.authenticate(req, res);
    if (!r) return;
    const a = this.o.registry.getAction(bot, id);
    if (!a) return this.page(res, 404, 'not_found', {}, {}, r);
    const form = await readForm(req, 16_384);
    if (!form || !safeEqual(form.get('csrf') ?? '', r.session.csrfToken))
      return this.page(res, 403, 'csrf', {}, {}, r);
    if (!this.sameOrigin(req)) return this.page(res, 403, 'csrf', {}, {}, r);
    if (!(await this.o.idempotency.claim(r.session.tokenHash, form.get('idem') ?? '')))
      return this.page(res, 409, 'already_submitted', {}, {}, r);
    const { input, errors } = parseActionInput(a.fields, form, this.o.timezone);
    if (Object.keys(errors).length) return this.sendForm(res, 400, r, bot, id, form, errors);

    const actor = { discordUserId: r.session.discordUserId, name: r.staff.name };
    let result: { ok: boolean; message: string };
    try {
      result = await a.run(input, actor);
    } catch (err) {
      this.o.log.error({ err, action: `${bot}/${id}` }, 'dashboard action failed');
      result = { ok: false, message: this.t('errors.error') };
    }
    const target = a.fields.find((f) => f.type === 'member' && typeof input[f.name] === 'string');
    await this.o.audit.record({
      actorDiscordId: actor.discordUserId,
      source: 'dashboard',
      action: `${bot}/${id}`,
      target: target ? String(input[target.name]) : null,
      details: { ok: result.ok, message: result.message, input },
    });
    this.o.log.info(
      { action: `${bot}/${id}`, ok: result.ok, discordUserId: actor.discordUserId },
      'dashboard action',
    );
    this.sendForm(res, 200, r, bot, id, result.ok ? new URLSearchParams() : form, {}, result);
  }

  private sendForm(
    res: ServerResponse,
    status: number,
    r: DashboardRequest,
    bot: string,
    id: string,
    values: URLSearchParams,
    errors: FieldErrors,
    result?: { ok: boolean; message: string },
  ): void {
    const a = this.o.registry.getAction(bot, id);
    if (!a) {
      this.page(res, 404, 'not_found', {}, {}, r);
      return;
    }
    const banner = result
      ? `<p class="result ${result.ok ? 'ok' : 'fail'}" role="status">${escapeHtml(result.message)}</p>`
      : Object.keys(errors).length
        ? `<p class="result fail" role="alert">${escapeHtml(this.t('form_has_errors'))}</p>`
        : '';
    const form = renderActionForm({
      action: a,
      csrf: r.session.csrfToken,
      idem: randomToken(16),
      values,
      errors,
      t: (k, v) => this.o.i18n.t(k, v),
    });
    send(
      res,
      status,
      this.layout(this.o.i18n.t(a.titleKey), `<section>${banner}${form}</section>`, r, `/a/${bot}/${id}`),
    );
  }

  /** One panel as a card; a failing panel shows an error instead of breaking the page. */
  private async section(p: RegisteredPanel, linkTitle: boolean): Promise<string> {
    const title = escapeHtml(this.o.i18n.t(p.titleKey));
    const heading = linkTitle ? `<h2><a href="/p/${p.bot}/${p.id}">${title}</a></h2>` : '';
    try {
      const view = await p.render();
      const locale = this.o.i18n.defaultLocale;
      return `<section>${heading}${renderPanelView(view, (k) => this.o.i18n.t(k), locale)}</section>`;
    } catch (err) {
      this.o.log.error({ err, panel: `${p.bot}/${p.id}` }, 'dashboard panel failed');
      return `<section>${heading}<p class="muted">${escapeHtml(this.t('errors.panel_failed'))}</p></section>`;
    }
  }

  // ── auth ────────────────────────────────────────────────────────────────

  /**
   * The staff session behind a request, or null after answering: no or expired session → 302 /login;
   * no longer staff → 403 and the session is deleted; Discord down → 502.
   */
  async authenticate(req: IncomingMessage, res: ServerResponse): Promise<DashboardRequest | null> {
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    const session = token ? await this.o.sessions.find(token) : null;
    if (!session) {
      redirect(res, '/login', token ? { 'set-cookie': this.clearSession() } : {});
      return null;
    }
    let staff: StaffStatus;
    try {
      staff = await this.o.staff.check(session.discordUserId);
    } catch (err) {
      this.o.log.warn({ err }, 'dashboard staff check failed');
      this.page(res, 502, 'unavailable');
      return null;
    }
    if (!staff.staff) {
      await this.o.sessions.deleteHash(session.tokenHash);
      this.o.log.info({ discordUserId: session.discordUserId }, 'dashboard session ended: no longer staff');
      this.page(res, 403, 'forbidden', {}, { 'set-cookie': this.clearSession() });
      return null;
    }
    return { session, staff };
  }

  /** `Origin`, when the browser sends it, must be the dashboard's own. */
  private sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    return origin === undefined || origin === this.origin;
  }

  private clearSession(): string {
    return cookie(SESSION_COOKIE, '', { maxAgeSeconds: 0, secure: this.secure });
  }

  // ── rendering ───────────────────────────────────────────────────────────

  private t(key: string, vars: Vars = {}): string {
    return this.o.i18n.t(`core.dashboard.${key}`, vars);
  }

  private page(
    res: ServerResponse,
    status: number,
    key: string,
    vars: Vars = {},
    headers: Record<string, string | string[]> = {},
    r?: DashboardRequest,
  ): void {
    const body = `<p>${escapeHtml(this.t(`errors.${key}`, vars))}</p>${
      status === 400 || status === 403
        ? `<p><a href="/login">${escapeHtml(this.t('login_again'))}</a></p>`
        : ''
    }`;
    send(res, status, this.layout(this.t('title'), body, r), headers);
  }

  private layout(heading: string, body: string, r?: DashboardRequest, current?: string): string {
    const links = [
      ['/', this.t('overview')],
      ...this.o.registry.list().map((p) => [`/p/${p.bot}/${p.id}`, this.o.i18n.t(p.titleKey)]),
      ...this.o.registry.listActions().map((a) => [`/a/${a.bot}/${a.id}`, this.o.i18n.t(a.titleKey)]),
      ['/audit', this.t('audit.title')],
    ];
    const nav = r
      ? `<nav><ul>${links
          .map(
            ([href, label]) =>
              `<li><a href="${href}"${href === current ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a></li>`,
          )
          .join('')}</ul></nav>`
      : '';
    const header = r
      ? `<header><p>${escapeHtml(this.t('signed_in_as', { name: r.staff.name }))}</p>` +
        `<form method="post" action="/logout"><input type="hidden" name="csrf" value="${escapeHtml(r.session.csrfToken)}">` +
        `<button type="submit">${escapeHtml(this.t('logout'))}</button></form></header>`
      : '';
    const lang = escapeHtml(this.o.i18n.defaultLocale);
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(this.t('title'))}</title><link rel="stylesheet" href="/assets/dashboard.css"></head><body>${header}${nav}<main><h1>${escapeHtml(heading)}</h1>${body}</main></body></html>`;
  }
}

/** Constant-time string compare (false on different lengths). */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
