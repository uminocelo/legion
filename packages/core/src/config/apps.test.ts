import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '../log/logger.js';
import { planApps } from './env.js';
import { parseEnv } from './load.js';

const base = { DISCORD_TOKEN: 'shared', DISCORD_CLIENT_ID: '111111', DISCORD_GUILD_ID: '222222' };
const plan = (extra: Record<string, string>, bots = ['cerebro', 'jarvis'] as const) =>
  planApps(parseEnv({ ...base, ...extra }), [...bots]);

describe('planApps', () => {
  it('puts every bot on the shared app by default', () => {
    expect(plan({})).toEqual({
      apps: [
        {
          key: 'main',
          token: 'shared',
          clientId: '111111',
          tokenVar: 'DISCORD_TOKEN',
          clientIdVar: 'DISCORD_CLIENT_ID',
          bots: ['cerebro', 'jarvis'],
        },
      ],
      errors: [],
    });
  });
  it('gives a bot with its own token its own app', () => {
    const { apps, errors } = plan({ JARVIS_TOKEN: 'j', JARVIS_CLIENT_ID: '333333' });
    expect(errors).toEqual([]);
    expect(apps.map((a) => [a.key, a.bots, a.clientIdVar])).toEqual([
      ['main', ['cerebro'], 'DISCORD_CLIENT_ID'],
      ['jarvis', ['jarvis'], 'JARVIS_CLIENT_ID'],
    ]);
  });
  it('makes the Cérebro app main even when Cérebro has its own token', () => {
    const { apps } = plan({ CEREBRO_TOKEN: 'c', CEREBRO_CLIENT_ID: '444444' }, [
      'jarvis',
      'cerebro',
    ] as never);
    expect(apps.map((a) => [a.key, a.bots, a.tokenVar])).toEqual([
      ['main', ['cerebro'], 'CEREBRO_TOKEN'],
      ['jarvis', ['jarvis'], 'DISCORD_TOKEN'],
    ]);
  });
  it("with the new names, every bot shares Cérebro's app", () => {
    const env = parseEnv({ CEREBRO_TOKEN: 'c', CEREBRO_CLIENT_ID: '444444', DISCORD_GUILD_ID: '222222' });
    expect(planApps(env, ['cerebro', 'jarvis', 'ultron']).apps).toEqual([
      {
        key: 'main',
        token: 'c',
        clientId: '444444',
        tokenVar: 'CEREBRO_TOKEN',
        clientIdVar: 'CEREBRO_CLIENT_ID',
        bots: ['cerebro', 'jarvis', 'ultron'],
      },
    ]);
  });
  it('reports a half-set pair by name', () => {
    expect(() => parseEnv({ ...base, CEREBRO_TOKEN: 'c' })).toThrow(/CEREBRO_CLIENT_ID: obrigatório/);
  });
  it('merges bots with the same token', () => {
    expect(plan({ JARVIS_TOKEN: 'shared', JARVIS_CLIENT_ID: '111111' }).apps).toHaveLength(1);
  });
  it('reports half-configured pairs and reused apps without values', () => {
    expect(plan({ JARVIS_TOKEN: 'j' }).errors).toEqual([
      'JARVIS_CLIENT_ID: obrigatório quando JARVIS_TOKEN está definido',
    ]);
    expect(plan({ JARVIS_CLIENT_ID: '333333' }).errors).toEqual([
      'JARVIS_TOKEN: obrigatório quando JARVIS_CLIENT_ID está definido',
    ]);
    const reused = plan({ JARVIS_TOKEN: 'other', JARVIS_CLIENT_ID: '111111' }).errors;
    expect(reused).toEqual(['JARVIS_CLIENT_ID: a mesma aplicação de DISCORD_CLIENT_ID com outro token']);
    expect(reused.join()).not.toContain('other');
  });
  it('rejects a non-numeric per-bot client id and redacts per-bot tokens in logs', () => {
    expect(() => parseEnv({ ...base, JARVIS_CLIENT_ID: 'abc' })).toThrow(/JARVIS_CLIENT_ID/);
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining(['JARVIS_TOKEN', 'env.JARVIS_TOKEN', '*.CEREBRO_TOKEN']),
    );
  });
});
