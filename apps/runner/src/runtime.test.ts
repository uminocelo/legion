import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONSUMERS_SINCE_KEY,
  ConfigError,
  coreTables,
  createTestDb,
  FakeClock,
  FakeDiscordGateway,
  FakeRandomSource,
  parseEnv,
  silentLogger,
} from '@legion/core';
import { GatewayIntentBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { UnavailableBotError } from './bots.js';
import { intentsFor } from './discord.js';
import { buildRuntime, describeBootError, enabledBotIds, loadConfigAndBots } from './runtime.js';

const write = (text: string) => {
  const file = join(mkdtempSync(join(tmpdir(), 'legion-cfg-')), 'legion.config.yaml');
  writeFileSync(file, text);
  return file;
};
const env = parseEnv({
  CEREBRO_TOKEN: 't',
  CEREBRO_CLIENT_ID: '123456789',
  DISCORD_GUILD_ID: '100000000000000001',
});

describe('config loading', () => {
  it('explains a missing file', async () => {
    const err = await loadConfigAndBots('/nope/legion.config.yaml').catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(describeBootError(err)).toContain('legion.config.example.yaml');
  });

  it('validates the enabled bot sections with readable errors', async () => {
    const err = await loadConfigAndBots(write('bots: [cerebro]\ncerebro:\n  welcomePing: talvez\n')).catch(
      (e) => e,
    );
    expect(describeBootError(err)).toMatch(
      /Configuração inválida:\n {2}legion\.config\.yaml → cerebro\.welcomePing:/,
    );
  });

  it('ships every bot in this version', async () => {
    const { bots } = await loadConfigAndBots(write('bots: [cerebro, jarvis, herbie, sentinel, ultron]\n'));
    expect(bots.map((b) => b.id)).toEqual(['cerebro', 'jarvis', 'herbie', 'sentinel', 'ultron']);
    expect(new UnavailableBotError(['ultron']).message).toContain('ultron');
  });

  it('loads the enabled bots', async () => {
    const { bots, config } = await loadConfigAndBots(write('bots: [cerebro]\nlocale: en\n'));
    expect(bots.map((b) => b.id)).toEqual(['cerebro']);
    expect(config.locale).toBe('en');
    expect(enabledBotIds('not: [valid')).toEqual(['cerebro']);
  });
});

describe('buildRuntime', () => {
  it('migrates, loads bots, replays pending events on ready and stops cleanly', async () => {
    const { bots, config } = await loadConfigAndBots(write('bots: [cerebro]\n'));
    const db = await createTestDb();
    const gateway = new FakeDiscordGateway();
    const runtime = await buildRuntime({
      env,
      config,
      bots,
      gateway,
      log: silentLogger(),
      clock: new FakeClock('2026-11-16T15:00:00.000Z'),
      random: new FakeRandomSource(),
      db,
    });
    expect(runtime.enabledBotIds()).toEqual(['cerebro']);
    // A previous boot knew the consumer; an event was logged while the process was down.
    await db.orm.insert(coreTables(db).coreKv).values({
      key: CONSUMERS_SINCE_KEY,
      value: JSON.stringify({ 'cerebro.rank-roles': '2026-11-16T13:00:00.000Z' }),
      updatedAt: '2026-11-16T13:00:00.000Z',
    });
    await db.orm.insert(coreTables(db).coreEventLog).values({
      id: '01JDOWN00000000000000000000',
      type: 'rank.changed',
      version: 1,
      guildId: env.DISCORD_GUILD_ID,
      source: 'jarvis',
      payload: JSON.stringify({ memberId: 'unknown', discordUserId: '1', from: 'recruta', to: 'agente' }),
      occurredAt: '2026-11-16T14:00:00.000Z',
    });
    await runtime.ready({ startPolling: false });
    const consumed = await db.orm.select().from(coreTables(db).coreEventConsumption);
    expect(consumed).toMatchObject([{ consumerId: 'cerebro.rank-roles', status: 'done' }]);
    expect(gateway.registeredCommands?.map((c) => (c as { name: string }).name)).toEqual([
      'cerebro',
      'mutante',
      'perfil',
    ]);
    expect(gateway.roleByName('Mutante Registrado')).toBeDefined();
    await runtime.stop(1000);
    await runtime.close();
  });

  it('unions the intents of enabled bots', async () => {
    const { bots } = await loadConfigAndBots(write('bots: [cerebro]\n'));
    expect(intentsFor(bots).sort()).toEqual(
      [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers].sort(),
    );
  });
});
