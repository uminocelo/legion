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

export function createDiscordRest(token: string, base = 'https://discord.com/api/v10'): DiscordRest {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        'User-Agent': 'DiscordBot (https://github.com/uminocelo/legion, 0.1.0)',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
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
