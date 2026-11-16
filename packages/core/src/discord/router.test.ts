import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LegionBot } from '../bot.js';
import { coreTables } from '../db/core-tables.js';
import { createTestContext, type TestContext } from '../testing/context.js';
import { COMMAND_HASH_KEY, canonicalJson, hashCommands } from './command-sync.js';
import { customId, parseCustomId } from './custom-id.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const calls: string[] = [];
const testBot: LegionBot<{ greeting: string }> = {
  id: 'cerebro',
  version: '0.0.0',
  configSchema: z.object({ greeting: z.string().default('oi') }),
  intents: [],
  permissions: [],
  commands: (ctx) => [
    {
      name: 'ping',
      json: { name: 'ping', description: 'ping' },
      execute: async (_i, r) => {
        calls.push(`ping:${ctx.botConfig.greeting}`);
        await r.reply({
          persona: 'cerebro',
          content: '@everyone pong',
          embeds: [{ title: 'x' }],
          allowedMentions: { parse: ['everyone', 'users'] },
          ephemeral: true,
        });
      },
    },
    {
      name: 'quebra',
      json: { name: 'quebra', description: 'breaks' },
      execute: async () => {
        throw new Error('boom');
      },
    },
    {
      name: 'lento',
      json: { name: 'lento', description: 'defers then breaks' },
      execute: async (_i, r) => {
        await r.defer();
        throw new Error('late boom');
      },
    },
  ],
  components: () => [
    {
      action: 'hello',
      version: 1,
      handle: async (_i, r, args) => {
        calls.push(`hello:${args.join(',')}`);
        await r.reply({ persona: 'cerebro', content: 'hi', ephemeral: true });
      },
    },
  ],
  register: () => {},
};

describe('custom ids', () => {
  it('round-trips and validates', () => {
    const id = customId('jarvis', 1, 'trivia', '01J9', 2);
    expect(id).toBe('jarvis:v1:trivia:01J9:2');
    expect(parseCustomId(id)).toEqual({ bot: 'jarvis', version: 1, action: 'trivia', args: ['01J9', '2'] });
    expect(parseCustomId('nobody:v1:x')).toBeNull();
    expect(parseCustomId('cerebro:1:x')).toBeNull();
    expect(() => customId('cerebro', 1, 'x'.repeat(100))).toThrow(/too long/);
  });
});

describe('InteractionRouter', () => {
  it('routes commands, applies the persona, blocks @everyone and emits command.executed', async () => {
    t = await createTestContext({ bots: [testBot] });
    const id = await t.interact({ kind: 'command', userId: '42', commandName: 'ping', subcommand: null });
    expect(calls).toContain('ping:oi');
    const reply = t.gateway.lastReply(id);
    expect(reply?.allowedMentions?.parse).toEqual(['users']);
    expect(reply?.embeds?.[0]?.author?.name).toBe('Cérebro');
    expect(reply?.embeds?.[0]?.footer?.text).toContain('Legion');
    const log = coreTables(t.db).coreEventLog;
    const rows = await t.db.orm.select().from(log).where(eq(log.type, 'command.executed'));
    expect(JSON.parse(rows[0]?.payload ?? '{}')).toEqual({
      discordUserId: '42',
      memberId: null,
      bot: 'cerebro',
      command: 'ping',
      subcommand: null,
    });
  });

  it('routes components by prefix and version, and expires unknown ones', async () => {
    t = await createTestContext({ bots: [testBot] });
    await t.interact({ kind: 'component', userId: '42', customId: 'cerebro:v1:hello:a:b' });
    expect(calls).toContain('hello:a,b');
    for (const cid of ['cerebro:v2:hello', 'cerebro:v1:nope', 'garbage']) {
      const id = await t.interact({ kind: 'component', userId: '42', customId: cid });
      expect(t.gateway.lastReply(id)?.content).toBe('Este botão expirou. Use o comando de novo.');
    }
  });

  it('replies with the generic error when a handler throws, and keeps going', async () => {
    t = await createTestContext({ bots: [testBot] });
    const a = await t.interact({ kind: 'command', userId: '42', commandName: 'quebra' });
    expect(t.gateway.lastReply(a)).toMatchObject({
      content: 'Algo deu errado, tente novamente.',
      ephemeral: true,
    });
    const b = await t.interact({ kind: 'command', userId: '42', commandName: 'lento' });
    expect(t.gateway.repliesTo(b).map((r) => r.kind)).toEqual(['deferReply', 'editReply']);
    const c = await t.interact({ kind: 'command', userId: '42', commandName: 'ping' });
    expect(t.gateway.lastReply(c)?.content).toBe('@everyone pong');
  });

  it('rate limits commands per member', async () => {
    t = await createTestContext({ bots: [testBot] });
    let last = '';
    for (let n = 0; n < 21; n++)
      last = await t.interact({ kind: 'command', userId: '7', commandName: 'ping' });
    expect(t.gateway.lastReply(last)?.content).toMatch(/^Calma, mutante! Tente de novo em \d+s\.$/);
  });

  it('fails at startup when two bots define the same command', async () => {
    const twin = { ...testBot, id: 'jarvis' as const, components: undefined };
    await expect(
      createTestContext({ bots: [testBot, twin], config: { bots: ['cerebro', 'jarvis'] } }),
    ).rejects.toThrow(/defined by both cerebro and jarvis/);
  });
});

describe('command registration', () => {
  it('hashes canonically and skips registration when nothing changed', async () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
    expect(hashCommands([{ a: 1, b: 2 }])).toBe(hashCommands([{ b: 2, a: 1 }]));
    t = await createTestContext({ bots: [testBot] });
    await t.runtime.ready({ startPolling: false });
    await t.runtime.ready({ startPolling: false });
    expect(t.gateway.callsOf('registerCommands')).toHaveLength(1);
    expect(await t.runtime.kv.get(COMMAND_HASH_KEY)).toMatch(/^[0-9a-f]{64}$/);
  });
});
