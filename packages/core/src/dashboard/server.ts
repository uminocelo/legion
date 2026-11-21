import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DashboardConfig } from '../config/schema.js';
import type { I18n, Vars } from '../i18n/i18n.js';
import type { Logger } from '../log/logger.js';
import { InMemoryRateLimiter } from '../ratelimit/rate-limiter.js';
import type { Clock } from '../time/clock.js';
import {
  cookie,
  escapeHtml,
  parseCookies,
  readForm,
  redirect,
  SESSION_COOKIE,
  STATE_COOKIE,
  send,
} from './http.js';
import { type DashboardOAuth, OAuthError } from './oauth.js';
import { type DashboardSession, type DashboardSessionStore, randomToken } from './sessions.js';
import type { DashboardStaffChecker, StaffStatus } from './staff.js';

const STATE_MAX_AGE_S = 600;
const CALLBACK_LIMIT = 10;
const CALLBACK_WINDOW_MS = 60_000;

export interface DashboardServerOptions {
  config: DashboardConfig;
  oauth: DashboardOAuth;
  sessions: DashboardSessionStore;
  staff: DashboardStaffChecker;
  i18n: I18n;
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
      const route = this.routes[url.pathname];
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
      return this.page(res, 400, 'login_failed', {}, { 'set-cookie': clearState });
    }

    let staff: StaffStatus;
    try {
      staff = await this.o.staff.check(user.id, { fresh: true });
    } catch (err) {
      this.o.log.warn({ err }, 'dashboard staff check failed');
      return this.page(res, 503, 'unavailable', {}, { 'set-cookie': clearState });
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
    send(res, 200, this.layout(this.t('overview'), '', r));
  }

  // ── auth ────────────────────────────────────────────────────────────────

  /**
   * The staff session behind a request, or null after answering: no or expired session → 302 /login;
   * no longer staff → 403 and the session is deleted; Discord down → 503.
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
      this.page(res, 503, 'unavailable');
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
  ): void {
    const body = `<p>${escapeHtml(this.t(`errors.${key}`, vars))}</p>${
      status === 400 || status === 403
        ? `<p><a href="/login">${escapeHtml(this.t('login_again'))}</a></p>`
        : ''
    }`;
    send(res, status, this.layout(this.t('title'), body), headers);
  }

  private layout(heading: string, body: string, r?: DashboardRequest): string {
    const header = r
      ? `<header><p>${escapeHtml(this.t('signed_in_as', { name: r.staff.name }))}</p>` +
        `<form method="post" action="/logout"><input type="hidden" name="csrf" value="${escapeHtml(r.session.csrfToken)}">` +
        `<button type="submit">${escapeHtml(this.t('logout'))}</button></form></header>`
      : '';
    const lang = escapeHtml(this.o.i18n.defaultLocale);
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(this.t('title'))}</title></head><body>${header}<main><h1>${escapeHtml(heading)}</h1>${body}</main></body></html>`;
  }
}

/** Constant-time string compare (false on different lengths). */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
