/** The few Discord REST calls the CLI needs (no gateway connection). */
export interface ApiRole {
  id: string;
  name: string;
  permissions: string;
  position: number;
  managed: boolean;
  color: number;
}
export interface ApiOverwrite {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}
export interface ApiChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  permission_overwrites?: ApiOverwrite[];
}
export interface ApiMember {
  roles: string[];
  user?: { id: string; bot?: boolean };
  joined_at?: string;
}

export class RestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface DiscordRest {
  me(): Promise<{ id: string; username: string }>;
  application(): Promise<{ id: string; flags?: number; name: string }>;
  guild(guildId: string): Promise<{ id: string; name: string; owner_id: string }>;
  guildMember(guildId: string, userId: string): Promise<ApiMember | null>;
  guildRoles(guildId: string): Promise<ApiRole[]>;
  guildChannels(guildId: string): Promise<ApiChannel[]>;
  putGuildCommands(applicationId: string, guildId: string, commands: unknown[]): Promise<void>;
  guildCommands?(applicationId: string, guildId: string): Promise<{ id: string; name: string }[]>;
  guildCommandPermissions?(
    applicationId: string,
    guildId: string,
  ): Promise<{ id: string; permissions: { id: string; type: 1 | 2 | 3; permission: boolean }[] }[]>;
}

/** Waits Discord's `retry_after` on 429 up to this many times, each wait capped at `MAX_WAIT_MS`. */
const MAX_RETRIES = 3;
const MAX_WAIT_MS = 60_000;

/** Seconds to wait from a 429 (JSON `retry_after`, else the `Retry-After` header), or null when unknown. */
export async function retryAfterSeconds(res: Response): Promise<number | null> {
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { retry_after?: unknown } | null;
  const fromBody = typeof body?.retry_after === 'number' ? body.retry_after : null;
  const fromHeader = Number(res.headers.get('retry-after'));
  const s = fromBody ?? (Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : null);
  return s === null ? null : Math.max(0, s);
}

export function createDiscordRest(
  token: string,
  base = 'https://discord.com/api/v10',
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): DiscordRest {
  const call = async <T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        'User-Agent': 'DiscordBot (https://github.com/uminocelo/legion, 0.1.0)',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const s = await retryAfterSeconds(res);
      if (s !== null && s * 1000 <= MAX_WAIT_MS) {
        await wait(Math.ceil(s * 1000) + 250);
        return call<T>(method, path, body, attempt + 1);
      }
    }
    if (!res.ok)
      throw new RestError(
        res.status,
        `${method} ${path} → ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300),
      );
    return (res.status === 204 ? undefined : await res.json()) as T;
  };
  return {
    me: () => call('GET', '/users/@me'),
    application: () => call('GET', '/applications/@me'),
    guild: (g) => call('GET', `/guilds/${g}`),
    guildMember: async (g, u) => {
      try {
        return await call<ApiMember>('GET', `/guilds/${g}/members/${u}`);
      } catch (err) {
        if (err instanceof RestError && err.status === 404) return null;
        throw err;
      }
    },
    guildRoles: (g) => call('GET', `/guilds/${g}/roles`),
    guildChannels: (g) => call('GET', `/guilds/${g}/channels`),
    putGuildCommands: async (a, g, commands) => {
      await call('PUT', `/applications/${a}/guilds/${g}/commands`, commands);
    },
    guildCommands: (a, g) => call('GET', `/applications/${a}/guilds/${g}/commands`),
    guildCommandPermissions: (a, g) => call('GET', `/applications/${a}/guilds/${g}/commands/permissions`),
  };
}
