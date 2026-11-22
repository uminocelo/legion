import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROLES } from '@legion/core';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  buildGuildTemplatePayload,
  type CreatedTemplate,
  createLegionTemplate,
  describeGuildFill,
  fillGuildTemplate,
  formatCreatedTemplate,
  formatFilledTemplate,
  formatTemplatePlan,
  guildFillBlockers,
  HIGH_TO_LOW_KEYS,
  type LiveChannel,
  type LiveRole,
  rolePositions,
  rolePositionsBelow,
  TemplateAccessError,
  type TemplateApi,
  type TemplateChannel,
  templateStatus,
} from './server-template.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const VIEW = PermissionFlagsBits.ViewChannel;
const WRITE =
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.CreatePublicThreads |
  PermissionFlagsBits.SendMessagesInThreads;

const payload = buildGuildTemplatePayload();
const roleId = (name: string) => {
  const role = payload.roles.find((item) => item.name === name);
  if (!role) throw new Error(name);
  return role.id;
};
const channel = (name: string): TemplateChannel => {
  const found = payload.channels.find((item) => item.name === name);
  if (!found) throw new Error(name);
  return found;
};
const hasBit = (value: string, bit: bigint) => (BigInt(value) & bit) === bit;

describe('buildGuildTemplatePayload', () => {
  it('uses every default role, staff highest', () => {
    expect(new Set(HIGH_TO_LOW_KEYS)).toEqual(new Set(DEFAULT_ROLES.map((role) => role.key)));
    expect(payload.roles[0]).toEqual({ id: 0 });
    expect(payload.roles.at(-1)?.name).toBe('Professor X');
    expect(payload.roles.find((role) => role.name === 'Professor X')?.hoist).toBe(true);
    expect(payload.roles.find((role) => role.name === 'X-Men')?.color).toBe(0x3498db);
    expect(payload.roles.find((role) => role.name === 'Recruta')?.permissions).toBe('0');
    expect(
      rolePositions(
        payload.roles.flatMap((role) => (role.name ? [{ id: String(role.id), name: role.name }] : [])),
      )[0],
    ).toEqual({
      id: String(roleId('Professor X')),
      position: DEFAULT_ROLES.length,
    });
  });

  it('follows the channels named in docs/TEMPLATE.md', () => {
    const doc = readFileSync(join(ROOT, 'docs/TEMPLATE.md'), 'utf8');
    const named = [
      'boas-vindas',
      'regras',
      'anuncios',
      'guia',
      'registro',
      'eventos',
      'missoes',
      'combate',
      'tutorial',
      'geral',
      'fan-art',
      'teorias',
      'taverna',
      'fila-moderacao',
      'staff',
      'logs',
      'sala-staff',
      'atualizacoes-discord',
      'alertas-seguranca',
    ];
    for (const name of named) expect(doc, name).toContain(`\`${name}\``);
    const slugs = [
      'x-men',
      'irmandade',
      'vingadores',
      'shield',
      'guardioes',
      'defensores',
      'thunderbolts',
      'filhos-da-meia-noite',
    ];
    const teamNames = slugs.flatMap((slug) =>
      ['quartel', 'noticias', 'esquadroes', 'planos', 'sala'].map((prefix) => `${prefix}-${slug}`),
    );
    expect(payload.channels.map((item) => item.name).sort()).toEqual(
      [
        '📜 Início',
        ...named.slice(0, 4),
        '🌍 O Mundo',
        ...named.slice(4, 9),
        '💬 Comunidade',
        ...named.slice(9, 13),
        '🔵 X-Men',
        '🔴 Irmandade',
        '🟡 Vingadores',
        '⚫ S.H.I.E.L.D.',
        '🟣 Guardiões',
        '🟠 Defensores',
        '⚡ Thunderbolts',
        '🌙 Filhos da Meia-Noite',
        ...teamNames,
        '🛡️ Staff',
        ...named.slice(13),
      ].sort(),
    );
    expect(channel('anuncios').type).toBe(ChannelType.GuildAnnouncement);
    expect(channel('fan-art').type).toBe(ChannelType.GuildForum);
    expect(channel('taverna').type).toBe(ChannelType.GuildVoice);
    expect(channel('planos-x-men').type).toBe(ChannelType.GuildForum);
    expect(payload.channels.filter((item) => item.type === ChannelType.GuildCategory)).toHaveLength(12);
    expect(payload.channels.some((item) => item.name.toLowerCase().includes('independente'))).toBe(false);
    expect(payload.roles.some((role) => role.name === 'Independente')).toBe(true);
  });

  it('opens welcome and rules, hides the rest, and syncs team channels with the category', () => {
    expect(channel('boas-vindas').permission_overwrites).toBeUndefined();
    expect(channel('regras').permission_overwrites).toBeUndefined();
    expect(channel('boas-vindas').parent_id).toBe(channel('📜 Início').id);

    const guia = channel('guia').permission_overwrites ?? [];
    expect(hasBit(guia.find((item) => item.id === 0)?.deny ?? '0', VIEW)).toBe(true);
    expect(hasBit(guia.find((item) => item.id === roleId('Herói Registrado'))?.allow ?? '0', VIEW)).toBe(
      true,
    );

    const news = channel('anuncios').permission_overwrites ?? [];
    expect(hasBit(news.find((item) => item.id === roleId('Herói Registrado'))?.deny ?? '0', WRITE)).toBe(
      true,
    );
    expect(hasBit(news.find((item) => item.id === roleId('Professor X'))?.allow ?? '0', WRITE)).toBe(true);
    expect(hasBit(news.find((item) => item.id === roleId('Herói Registrado'))?.allow ?? '0', VIEW)).toBe(
      true,
    );

    const team = channel('🔵 X-Men');
    const child = channel('quartel-x-men');
    expect(child.parent_id).toBe(team.id);
    expect(child.permission_overwrites).toEqual(team.permission_overwrites);
    const overwrites = team.permission_overwrites ?? [];
    expect(hasBit(overwrites.find((item) => item.id === 0)?.deny ?? '0', VIEW)).toBe(true);
    expect(hasBit(overwrites.find((item) => item.id === roleId('X-Men'))?.allow ?? '0', VIEW)).toBe(true);
    expect(
      hasBit(overwrites.find((item) => item.id === roleId('Conselho da Legião'))?.allow ?? '0', VIEW),
    ).toBe(true);
    expect(overwrites.some((item) => item.id === roleId('Herói Registrado'))).toBe(false);

    const staff = channel('🛡️ Staff').permission_overwrites ?? [];
    expect(hasBit(staff.find((item) => item.id === 0)?.deny ?? '0', VIEW)).toBe(true);
    expect(staff.some((item) => item.id === roleId('Herói Registrado'))).toBe(false);
    expect(channel('logs').permission_overwrites).toEqual(staff);
  });
});

describe('createLegionTemplate', () => {
  const roles = [
    { id: '1', name: '@everyone' },
    { id: '2', name: 'Professor X' },
    { id: '3', name: 'Recruta' },
  ];

  function api(guildCount: number, failAt?: 'positions' | 'template'): TemplateApi & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      me: async () => ({ id: 'bot', username: 'Cerebro' }),
      guilds: async () =>
        Array.from({ length: guildCount }, (_, index) => ({ id: String(index), name: `s${index}` })),
      guild: async () => ({ id: 'guild', name: 'Legion', owner_id: 'user' }),
      guildMember: async () => ({ roles: ['bot-role'] }),
      createGuild: async () => {
        calls.push('create');
        return { id: 'guild', name: 'Legion', roles };
      },
      createRole: async () => {
        throw new Error('unused');
      },
      createChannel: async () => {
        throw new Error('unused');
      },
      modifyChannel: async () => undefined,
      deleteChannel: async () => undefined,
      guildRoles: async () => roles,
      setRolePositions: async (_guild, positions) => {
        calls.push(`positions:${positions.map((item) => item.position).join(',')}`);
        if (failAt === 'positions') throw new Error('posição recusada');
      },
      guildChannels: async () => [{ id: 'ch', name: 'boas-vindas' }],
      modifyGuild: async () => {
        calls.push('system');
      },
      createInvite: async () => ({ code: 'invite' }),
      createTemplate: async () => {
        calls.push('template');
        if (failAt === 'template') throw new Error('modelo recusado');
        return { code: 'abc123' };
      },
      listTemplates: async () => [],
      syncTemplate: async () => ({ code: 'abc123' }),
    };
  }

  it('refuses a bot that is already in 10 servers', async () => {
    const rest = api(10);
    await expect(createLegionTemplate(rest)).rejects.toThrow(/menos de 10|abaixo de 10|10 servidores/);
    expect(rest.calls).toEqual([]);
  });

  it('creates the server, orders the roles, and returns the template link', async () => {
    const rest = api(2);
    const result = await createLegionTemplate(rest);
    expect(result).toEqual({
      guildId: 'guild',
      guildName: 'Legion',
      url: 'https://discord.new/abc123',
      inviteUrl: 'https://discord.gg/invite',
    } satisfies CreatedTemplate);
    expect(rest.calls[0]).toBe('create');
    expect(rest.calls).toContain('positions:2,1');
    expect(rest.calls.at(-1)).toBe('template');
    expect(formatCreatedTemplate(result)).toContain('https://discord.new/abc123');
  });

  it('names the server when a later step fails', async () => {
    await expect(createLegionTemplate(api(1, 'template'))).rejects.toThrow(/guild/);
  });

  it('shows how many servers the bot is in', async () => {
    expect(await templateStatus(api(2))).toMatch(/2 servidor/);
    expect(await templateStatus(api(10))).toMatch(/Saia de um servidor/);
    expect(formatTemplatePlan()).toContain('pnpm legion template --create');
  });
});

const GUILD = '1573865099297300480';

describe('fillGuildTemplate', () => {
  it('places Legion roles under the bot and refuses when the bot role is too low', () => {
    expect(
      rolePositionsBelow(
        [
          { id: 'e', name: '@everyone', position: 0 },
          { id: 'x', name: 'Professor X', position: 1 },
          { id: 'r', name: 'Recruta', position: 2 },
          { id: 'b', name: 'Cerebro', position: 3 },
        ],
        ['b'],
      ),
    ).toEqual([
      { id: 'x', position: 2 },
      { id: 'r', position: 1 },
    ]);
    expect(() =>
      rolePositionsBelow(
        [
          { id: 'x', name: 'Professor X', position: 1 },
          { id: 'b', name: 'Cerebro', position: 1, managed: true },
        ],
        ['b'],
      ),
    ).toThrow(/topo/);
  });

  it('stops when the server already has a room that is not part of the template', () => {
    const payload = buildGuildTemplatePayload();
    expect(guildFillBlockers(payload, [], [{ id: '1', name: 'criadores' }])).toEqual([
      'canal fora do modelo: criadores',
    ]);
    expect(guildFillBlockers(payload, [{ id: '1', name: 'Cerebro', managed: true }], [])).toEqual([]);
  });

  it('builds into an existing server and deletes only Discord starter channels', async () => {
    const roles: LiveRole[] = [
      { id: GUILD, name: '@everyone', position: 0 },
      { id: 'bot-role', name: 'Cerebro', position: 1, managed: true },
    ];
    const channels: LiveChannel[] = [
      { id: 'general', name: 'general', type: 0 },
      { id: 'voice', name: 'Voice Channels', type: 4 },
    ];
    const created: string[] = [];
    const createdTypes = new Map<string, number | undefined>();
    const events: string[] = [];
    const deleted: string[] = [];
    const templates: { code: string }[] = [];
    let welcomeDeny = '';
    let botCanSeeNews = false;
    let seq = 1;
    const api: TemplateApi = {
      me: async () => ({ id: 'bot', username: 'Cerebro' }),
      guilds: async () => [],
      guild: async () => ({ id: GUILD, name: 'Vazio', owner_id: 'owner' }),
      guildMember: async () => ({ roles: ['bot-role'] }),
      createGuild: async () => {
        throw new Error('não cria servidor novo');
      },
      guildRoles: async () => roles.map((role) => ({ ...role })),
      createRole: async (_guild, body) => {
        const bot = roles.find((role) => role.id === 'bot-role');
        if (bot) bot.position = (bot.position ?? 1) + 1;
        const role = { id: `role-${seq}`, name: body.name, position: 1, managed: false };
        seq += 1;
        roles.push(role);
        return role;
      },
      setRolePositions: async (_guild, positions) => {
        const top = positions.find(
          (item) => item.id === roles.find((role) => role.name === 'Professor X')?.id,
        );
        if (top?.position !== (roles.find((role) => role.id === 'bot-role')?.position ?? 0) - 1)
          throw new Error(`posição ${top?.position}`);
      },
      guildChannels: async () => channels.map((channel) => ({ ...channel })),
      createChannel: async (_guild, body) => {
        const channel = { id: `ch-${seq}`, name: body.name, type: body.type, parent_id: body.parent_id };
        seq += 1;
        channels.push(channel);
        created.push(body.name);
        createdTypes.set(body.name, body.type);
        if (body.name === 'anuncios') {
          welcomeDeny = body.permission_overwrites?.find((entry) => entry.id === GUILD)?.deny ?? '';
          botCanSeeNews =
            body.permission_overwrites?.some((entry) => entry.id === 'bot' && entry.type === 1) ?? false;
        }
        return channel;
      },
      modifyChannel: async (id, body) => {
        if (body.type !== undefined) {
          events.push(`type:${body.type}`);
          const channel = channels.find((item) => item.id === id);
          if (channel) channel.type = body.type;
        }
      },
      deleteChannel: async (id) => {
        const index = channels.findIndex((channel) => channel.id === id);
        const [removed] = index >= 0 ? channels.splice(index, 1) : [];
        if (removed) deleted.push(removed.name);
      },
      modifyGuild: async (_guild, body) => {
        if (body.name !== 'Legion' || body.preferred_locale !== 'pt-BR') throw new Error('guild');
      },
      createInvite: async () => null,
      createTemplate: async () => {
        events.push('template');
        templates.push({ code: 'tpl' });
        return { code: 'tpl' };
      },
      listTemplates: async () => templates.map((template) => ({ ...template })),
      syncTemplate: async (_guild, code) => {
        events.push(`sync:${code}`);
        return { code };
      },
    };
    expect(await describeGuildFill(api, GUILD)).toContain('general');
    const result = await fillGuildTemplate(api, GUILD);
    expect(deleted).toEqual(['general', 'Voice Channels']);
    expect(created[0]).toBe('📜 Início');
    expect(created.indexOf('boas-vindas')).toBeLessThan(created.indexOf('anuncios'));
    expect(createdTypes.get('anuncios')).toBe(ChannelType.GuildText);
    expect(events.indexOf('template')).toBeLessThan(events.indexOf(`type:${ChannelType.GuildAnnouncement}`));
    expect(hasBit(welcomeDeny, VIEW)).toBe(true);
    expect(botCanSeeNews).toBe(true);
    expect(result).toEqual({
      guildId: GUILD,
      guildName: 'Legion',
      url: 'https://discord.new/tpl',
      inviteUrl: null,
      warnings: [expect.stringMatching(/não inclui canal de anúncio/)],
    });
    expect(formatFilledTemplate(result)).toContain('https://discord.new/tpl');

    events.length = 0;
    const again = await fillGuildTemplate(api, GUILD);
    expect(events.indexOf(`type:${ChannelType.GuildText}`)).toBeLessThan(events.indexOf('sync:tpl'));
    expect(events.indexOf('sync:tpl')).toBeLessThan(events.indexOf(`type:${ChannelType.GuildAnnouncement}`));
    expect(events).not.toContain('template');
    expect(again.url).toBe('https://discord.new/tpl');
  });

  it('says when the bot is not in the server', async () => {
    const api: TemplateApi = {
      me: async () => ({ id: 'bot', username: 'Cerebro' }),
      guilds: async () => [],
      guild: async () => {
        throw new TemplateAccessError(GUILD);
      },
      guildMember: async () => null,
      createGuild: async () => {
        throw new Error('unused');
      },
      guildRoles: async () => [],
      createRole: async () => {
        throw new Error('unused');
      },
      setRolePositions: async () => undefined,
      guildChannels: async () => [],
      createChannel: async () => {
        throw new Error('unused');
      },
      modifyChannel: async () => undefined,
      deleteChannel: async () => undefined,
      modifyGuild: async () => undefined,
      createInvite: async () => null,
      createTemplate: async () => ({ code: 'x' }),
      listTemplates: async () => [],
      syncTemplate: async () => ({ code: 'x' }),
    };
    await expect(describeGuildFill(api, GUILD)).rejects.toBeInstanceOf(TemplateAccessError);
  });
});
