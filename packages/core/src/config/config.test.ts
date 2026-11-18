import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigError } from './errors.js';
import { parseConfig, parseConfigText, parseEnv } from './load.js';
import { DEFAULT_FACTION_KEYS, DEFAULT_ROLES, factionAllowsOrigin, shownFaction } from './roles.js';

const errorsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return e.lines;
    throw e;
  }
  throw new Error('expected ConfigError');
};

describe('parseConfig', () => {
  it('fills every default from a minimal config', () => {
    const cfg = parseConfigText('bots: [cerebro]\n');
    expect(cfg.locale).toBe('pt-BR');
    expect(cfg.timezone).toBe('America/Sao_Paulo');
    expect(cfg.roles.find((r) => r.key === 'registered')?.name).toBe('Mutante Registrado');
    expect(cfg.factions.map((f) => f.key)).toEqual([...DEFAULT_FACTION_KEYS]);
    expect(cfg.channels.welcome).toBeNull();
    expect(cfg.scheduler.pollIntervalMs).toBe(5000);
  });

  describe('teams (factions)', () => {
    it('has the nine default teams, each with its role, and the Irmandade only takes mutants and inhumans', () => {
      const cfg = parseConfigText('bots: [cerebro]\n');
      expect(cfg.factions).toHaveLength(9);
      for (const f of cfg.factions) {
        expect(f.emoji).not.toBe('');
        expect(cfg.roles.find((r) => r.key === f.roleKey)?.group).toBe('faction');
      }
      // The v0 keys never change, so members keep their teams.
      expect(cfg.factions.slice(0, 3).map((f) => f.key)).toEqual(['independent', 'xmen', 'brotherhood']);
      const brotherhood = cfg.factions.find((f) => f.key === 'brotherhood');
      expect(brotherhood?.origins).toEqual(['mutante', 'inumano']);
      expect(brotherhood && factionAllowsOrigin(brotherhood, 'inumano')).toBe(true);
      expect(brotherhood && factionAllowsOrigin(brotherhood, 'tecnologia')).toBe(false);
      const avengers = cfg.factions.find((f) => f.key === 'avengers');
      expect(avengers && factionAllowsOrigin(avengers, 'mistico')).toBe(true);
    });

    it('a server with its own roles list (from v0.8) keeps booting with the teams it has roles for', () => {
      const roles = DEFAULT_ROLES.filter(
        (r) =>
          r.group !== 'faction' ||
          ['faction_xmen', 'faction_brotherhood', 'faction_independent'].includes(r.key),
      )
        .map((r) => `  - { key: ${r.key}, name: "${r.name}", group: ${r.group}, managedBy: ${r.managedBy} }`)
        .join('\n');
      const cfg = parseConfigText(`roles:\n${roles}\n`);
      expect(cfg.factions.map((f) => f.key)).toEqual(['independent', 'xmen', 'brotherhood']);
    });

    it('keeps a custom factions list as written', () => {
      const cfg = parseConfigText('factions:\n  - { key: xmen, roleKey: faction_xmen, emoji: 🔵 }\n');
      expect(cfg.factions).toEqual([{ key: 'xmen', roleKey: 'faction_xmen', emoji: '🔵' }]);
    });

    it('rejects an unknown origin and a repeated team key', () => {
      const origin = errorsOf(() =>
        parseConfigText('factions:\n  - { key: xmen, roleKey: faction_xmen, origins: [alien] }\n'),
      );
      expect(origin[0]).toContain('factions[0].origins[0]');
      expect(origin[0]).toContain('"mutante"');
      const repeated = errorsOf(() =>
        parseConfigText(
          'factions:\n  - { key: xmen, roleKey: faction_xmen }\n  - { key: xmen, roleKey: faction_xmen }\n',
        ),
      );
      expect(repeated[0]).toContain('factions[1].key');
      expect(repeated[0]).toContain('única');
    });

    it('shows a team key that is no longer configured as Independente', () => {
      const factions = [{ key: 'independent' }, { key: 'xmen' }];
      expect(shownFaction(factions, 'xmen')).toBe('xmen');
      expect(shownFaction(factions, 'thunderbolts')).toBe('independent');
      expect(shownFaction(factions, null)).toBeNull();
    });
  });

  it('accepts an empty file', () => {
    expect(parseConfigText('').bots).toEqual(['cerebro']);
  });

  it('requires cerebro when another bot is enabled', () => {
    const lines = errorsOf(() => parseConfigText('bots: [jarvis]'));
    expect(lines[0]).toContain('legion.config.yaml → bots:');
    expect(lines[0]).toContain('Cérebro é obrigatório');
  });

  it('requires sentinel when ultron is enabled', () => {
    expect(errorsOf(() => parseConfigText('bots: [cerebro, ultron]'))[0]).toContain(
      'o ULTRON precisa do Sentinel',
    );
    expect(parseConfigText('bots: [cerebro, sentinel, ultron]').bots).toContain('ultron');
  });

  it('gives a readable, localized error with path and example for bad colors', () => {
    const yaml = `roles:
  - { key: a, name: A, group: staff, managedBy: manual }
  - { key: b, name: B, group: staff, managedBy: manual }
  - { key: c, name: C, group: staff, managedBy: manual }
  - { key: d, name: D, group: staff, managedBy: manual, color: azul }
factions: []
`;
    expect(errorsOf(() => parseConfigText(yaml))).toEqual([
      'legion.config.yaml → roles[3].color: use uma cor hex como "#3498DB"',
    ]);
    const en = errorsOf(() => parseConfigText(`locale: en\n${yaml}`));
    expect(en[0]).toBe('legion.config.yaml → roles[3].color: use a hex color like "#3498DB"');
  });

  it('reports enum values and invalid timezones', () => {
    const lines = errorsOf(() => parseConfigText('locale: fr\ntimezone: Mars/Olympus'));
    expect(lines.some((l) => l.includes('locale') && l.includes('"pt-BR"'))).toBe(true);
    expect(lines.some((l) => l.includes('timezone') && l.includes('IANA'))).toBe(true);
  });

  it('refuses to manage the TikTok role', () => {
    const yaml = `roles:
  - { key: tiktok_sub, name: Assinante TikTok, group: community, managedBy: cerebro }
factions: []`;
    expect(errorsOf(() => parseConfigText(yaml))[0]).toContain('integração do TikTok');
  });

  it('reports YAML syntax errors', () => {
    expect(errorsOf(() => parseConfigText('bots: [cerebro'))[0]).toContain('YAML é inválido');
  });

  it('validates enabled bot sections with their schema and prefixes the path', () => {
    const schemas = { cerebro: z.object({ welcomePing: z.boolean().default(true) }) };
    expect(parseConfig({ bots: ['cerebro'] }, schemas).cerebro).toEqual({ welcomePing: true });
    const lines = errorsOf(() =>
      parseConfig({ bots: ['cerebro'], cerebro: { welcomePing: 'sim' } }, schemas),
    );
    expect(lines[0]).toMatch(/^legion\.config\.yaml → cerebro\.welcomePing: tipo inválido/);
  });
});

describe('parseEnv', () => {
  const base = { CEREBRO_TOKEN: 'x', CEREBRO_CLIENT_ID: '123456789', DISCORD_GUILD_ID: '987654321' };
  it('applies defaults', () => {
    const env = parseEnv({ ...base, DATABASE_URL: '' });
    expect(env.DATABASE_URL).toBe('file:./data/legion.db');
    expect(env.HEALTH_PORT).toBe(8080);
    expect(env.AI_MODEL).toBeUndefined();
  });
  it('explains missing secrets', () => {
    const lines = errorsOf(() => parseEnv({ CEREBRO_CLIENT_ID: 'abc' }));
    expect(lines.some((l) => l.startsWith('.env → CEREBRO_CLIENT_ID: use o ID numérico'))).toBe(true);
    expect(lines.some((l) => l.startsWith('.env → CEREBRO_TOKEN: obrigatório'))).toBe(true);
    const none = errorsOf(() => parseEnv({ DISCORD_GUILD_ID: '987654321' }));
    expect(none.filter((l) => /CEREBRO_(TOKEN|CLIENT_ID): obrigatório/.test(l))).toHaveLength(2);
  });
  it('still accepts the old DISCORD_TOKEN / DISCORD_CLIENT_ID names for the main app, flagged as legacy', () => {
    const env = parseEnv({
      DISCORD_TOKEN: 'old',
      DISCORD_CLIENT_ID: '123456789',
      DISCORD_GUILD_ID: '987654321',
    });
    expect(env.main).toMatchObject({
      token: 'old',
      tokenVar: 'DISCORD_TOKEN',
      clientIdVar: 'DISCORD_CLIENT_ID',
    });
    expect(env.legacyVars).toEqual(['DISCORD_TOKEN', 'DISCORD_CLIENT_ID']);
    expect(parseEnv(base).legacyVars).toEqual([]);
    expect(parseEnv(base).main.tokenVar).toBe('CEREBRO_TOKEN');
  });
});

describe('unquoted Discord IDs', () => {
  it('keeps every digit of 19-digit IDs and leaves small numbers as numbers', () => {
    const cfg = parseConfigText(
      'channels:\n  welcome: 1572018586715824168\nscheduler:\n  pollIntervalMs: 1000\n',
      {},
    );
    expect(cfg.channels.welcome).toBe('1572018586715824168');
    expect(cfg.scheduler.pollIntervalMs).toBe(1000);
  });
});
