/** Discord OAuth2 (authorization code, `scope=identify`) for the dashboard login. */
export interface DashboardOAuth {
  authorizeUrl(state: string, redirectUri: string): string;
  /** Exchanges a one-use code for an access token. Throws `OAuthError` when Discord refuses it. */
  exchange(code: string, redirectUri: string): Promise<string>;
  /** The Discord user behind an access token. */
  identify(accessToken: string): Promise<{ id: string; username: string }>;
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export interface DiscordOAuthOptions {
  clientId: string;
  clientSecret: string;
  /** REST base (tests point it at an in-process fake). */
  apiBase?: string;
  authorizeBase?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class DiscordOAuth implements DashboardOAuth {
  private readonly apiBase: string;
  private readonly authorizeBase: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly o: DiscordOAuthOptions) {
    this.apiBase = (o.apiBase ?? 'https://discord.com/api/v10').replace(/\/+$/, '');
    this.authorizeBase = o.authorizeBase ?? 'https://discord.com/oauth2/authorize';
    this.fetch = o.fetch ?? globalThis.fetch;
  }

  authorizeUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: this.o.clientId,
      scope: 'identify',
      state,
      redirect_uri: redirectUri,
      prompt: 'none',
    });
    return `${this.authorizeBase}?${q}`;
  }

  async exchange(code: string, redirectUri: string): Promise<string> {
    const res = await this.call(`${this.apiBase}/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${this.o.clientId}:${this.o.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
    if (typeof body?.access_token !== 'string') throw new OAuthError('token response without access_token');
    return body.access_token;
  }

  async identify(accessToken: string): Promise<{ id: string; username: string }> {
    const res = await this.call(`${this.apiBase}/users/@me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json().catch(() => null)) as { id?: unknown; username?: unknown } | null;
    if (typeof body?.id !== 'string' || !/^\d{5,25}$/.test(body.id))
      throw new OAuthError('user response without a valid id');
    return { id: body.id, username: typeof body.username === 'string' ? body.username : body.id };
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetch(url, { ...init, signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000) });
    } catch (err) {
      throw new OAuthError(`Discord did not answer: ${(err as Error).message}`);
    }
    if (!res.ok) throw new OAuthError(`Discord answered ${res.status}`, res.status);
    return res;
  }
}
