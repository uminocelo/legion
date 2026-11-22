import { DEFAULT_ROLES, roleSchema } from '@legion/core';
import { ChannelType, OverwriteType, PermissionFlagsBits } from 'discord.js';
import { RestError, retryAfterSeconds } from './rest.js';

const VIEW = PermissionFlagsBits.ViewChannel;
/** Posting in a channel, including threads. Announcements stay staff-only. */
const WRITE =
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.CreatePublicThreads |
  PermissionFlagsBits.SendMessagesInThreads;

/**
 * Top of the role list first. Staff sits above team and rank roles. Independente has a role and
 * no category. Servers made from the template still need the bot dragged above the team roles.
 */
export const HIGH_TO_LOW_KEYS = [
  'staff_owner',
  'staff_council',
  'staff_bots',
  'faction_xmen',
  'faction_brotherhood',
  'faction_avengers',
  'faction_shield',
  'faction_guardians',
  'faction_defenders',
  'faction_thunderbolts',
  'faction_midnight_sons',
  'faction_independent',
  'registered',
  'signal',
  'rank_veterano',
  'rank_agente',
  'rank_recruta',
  'tiktok_sub',
  'supporter',
  'live_ping',
  'rivals_vanguard',
  'rivals_duelist',
  'rivals_strategist',
] as const;

/** Channel suffix. ASCII so Discord's name normalization stays stable. Category names keep accents. */
export const TEAMS = [
  { category: '🔵 X-Men', slug: 'x-men', roleKey: 'faction_xmen' },
  { category: '🔴 Irmandade', slug: 'irmandade', roleKey: 'faction_brotherhood' },
  { category: '🟡 Vingadores', slug: 'vingadores', roleKey: 'faction_avengers' },
  { category: '⚫ S.H.I.E.L.D.', slug: 'shield', roleKey: 'faction_shield' },
  { category: '🟣 Guardiões', slug: 'guardioes', roleKey: 'faction_guardians' },
  { category: '🟠 Defensores', slug: 'defensores', roleKey: 'faction_defenders' },
  { category: '⚡ Thunderbolts', slug: 'thunderbolts', roleKey: 'faction_thunderbolts' },
  { category: '🌙 Filhos da Meia-Noite', slug: 'filhos-da-meia-noite', roleKey: 'faction_midnight_sons' },
] as const;
export type TemplateTeam = (typeof TEAMS)[number];

const TEAM_CHANNELS = [
  ['quartel', 'text'],
  ['noticias', 'text'],
  ['esquadroes', 'text'],
  ['planos', 'forum'],
  ['sala', 'voice'],
] as const;

const TEMPLATE_META = {
  name: 'Legion',
  description: 'Categorias, canais, cargos e permissões do Legion.',
} as const;

const parsedRoles = DEFAULT_ROLES.map((role) => roleSchema.parse(role));
const roleByKey = new Map(parsedRoles.map((role) => [role.key, role]));

export interface TemplateOverwrite {
  id: number;
  type: OverwriteType.Role;
  allow: string;
  deny: string;
}

export interface TemplateChannel {
  id: number;
  type: ChannelType;
  name: string;
  parent_id?: number;
  permission_overwrites?: TemplateOverwrite[];
}

export interface TemplateRole {
  id: number;
  name?: string;
  permissions?: string;
  color?: number;
  hoist?: boolean;
}

/** Body of `POST /guilds`. Placeholder ids link overwrites and categories; Discord replaces them. */
export interface GuildTemplatePayload {
  name: string;
  preferred_locale: string;
  roles: TemplateRole[];
  channels: TemplateChannel[];
}

export interface TemplateGuild {
  id: string;
  name: string;
  roles?: { id: string; name: string }[];
}

export interface LiveRole {
  id: string;
  name: string;
  position?: number;
  managed?: boolean;
}

export interface LiveChannel {
  id: string;
  name: string;
  type?: number;
  parent_id?: string | null;
}

export interface RoleWrite {
  name: string;
  permissions: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
}

export interface ChannelWrite {
  name: string;
  /** Omitted on update. Discord only accepts an announcement type when converting a text channel. */
  type?: number;
  parent_id?: string | null;
  permission_overwrites?: { id: string; type: 0 | 1; allow: string; deny: string }[];
}

export interface TemplateApi {
  me(): Promise<{ id: string; username: string }>;
  guilds(): Promise<{ id: string; name: string }[]>;
  guild(guildId: string): Promise<{ id: string; name: string; owner_id: string }>;
  guildMember(guildId: string, userId: string): Promise<{ roles: string[] } | null>;
  createGuild(body: GuildTemplatePayload): Promise<TemplateGuild>;
  guildRoles(guildId: string): Promise<LiveRole[]>;
  createRole(guildId: string, body: RoleWrite): Promise<LiveRole>;
  setRolePositions(guildId: string, positions: { id: string; position: number }[]): Promise<void>;
  guildChannels(guildId: string): Promise<LiveChannel[]>;
  createChannel(guildId: string, body: ChannelWrite): Promise<LiveChannel>;
  modifyChannel(channelId: string, body: Partial<ChannelWrite>): Promise<void>;
  deleteChannel(channelId: string): Promise<void>;
  modifyGuild(
    guildId: string,
    body: { system_channel_id?: string; preferred_locale?: string; name?: string },
  ): Promise<void>;
  createInvite(channelId: string): Promise<{ code: string } | null>;
  createTemplate(guildId: string, body: { name: string; description: string }): Promise<{ code: string }>;
  listTemplates(guildId: string): Promise<{ code: string }[]>;
  syncTemplate(
    guildId: string,
    code: string,
    body: { name: string; description: string },
  ): Promise<{ code: string }>;
}

/** The bot cannot see this guild, so it still needs an invite. */
export class TemplateAccessError extends Error {
  constructor(readonly guildId: string) {
    super(`O Cérebro não está no servidor ${guildId}.`);
    this.name = 'TemplateAccessError';
  }
}

export interface CreatedTemplate {
  guildId: string;
  guildName: string;
  url: string;
  inviteUrl: string | null;
  warnings?: string[];
}

const overwrite = (id: number, allow: bigint, deny: bigint): TemplateOverwrite => ({
  id,
  type: OverwriteType.Role,
  allow: allow.toString(),
  deny: deny.toString(),
});

const viewFor = (roleIds: readonly number[]): TemplateOverwrite[] => [
  overwrite(0, 0n, VIEW),
  ...roleIds.map((id) => overwrite(id, VIEW, 0n)),
];

const channelType = {
  text: ChannelType.GuildText,
  news: ChannelType.GuildAnnouncement,
  forum: ChannelType.GuildForum,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
} as const;

type ChannelKind = keyof typeof channelType;

/**
 * Layout from `docs/TEMPLATE.md`, with role names and colors from the default config.
 * Children repeat the category overwrites: Discord only treats a channel as synced when the
 * overwrites match, and the create-guild call does not copy them.
 */
export function buildGuildTemplatePayload(): GuildTemplatePayload {
  const roleId = new Map<string, number>();
  // Lowest role first, so a create that uses array order still puts staff at the top.
  const roles: TemplateRole[] = [{ id: 0 }];
  for (const key of [...HIGH_TO_LOW_KEYS].reverse()) {
    const role = roleByKey.get(key);
    if (!role) throw new Error(`cargo padrão ausente: ${key}`);
    const id = roles.length;
    roleId.set(key, id);
    roles.push({
      id,
      name: role.name,
      permissions: '0',
      ...(role.color ? { color: Number.parseInt(role.color.slice(1), 16) } : {}),
      ...(role.hoist ? { hoist: true } : {}),
    });
  }

  const idOf = (key: string) => {
    const id = roleId.get(key);
    if (id === undefined) throw new Error(`cargo padrão ausente: ${key}`);
    return id;
  };
  const staffIds = ['staff_owner', 'staff_council', 'staff_bots'].map(idOf);
  const registeredId = idOf('registered');
  const registered = viewFor([registeredId]);
  const staffOnly = viewFor(staffIds);
  const announcements: TemplateOverwrite[] = [
    overwrite(0, 0n, VIEW | WRITE),
    overwrite(registeredId, VIEW, WRITE),
    ...staffIds.map((id) => overwrite(id, VIEW | WRITE, 0n)),
  ];

  // Channel placeholders start at 100 so they never share an integer with a role placeholder.
  let nextChannel = 100;
  const channels: TemplateChannel[] = [];
  const add = (
    name: string,
    kind: ChannelKind,
    parentId: number | undefined,
    overwrites: TemplateOverwrite[] | undefined,
  ) => {
    const channel: TemplateChannel = {
      id: nextChannel,
      type: channelType[kind],
      name,
      ...(parentId !== undefined ? { parent_id: parentId } : {}),
      ...(overwrites ? { permission_overwrites: overwrites } : {}),
    };
    nextChannel += 1;
    channels.push(channel);
    return channel.id;
  };
  const category = (
    name: string,
    overwrites: TemplateOverwrite[] | undefined,
    children: readonly (readonly [string, ChannelKind])[],
  ) => {
    const parentId = add(name, 'category', undefined, overwrites);
    for (const [childName, kind] of children) add(childName, kind, parentId, overwrites);
  };

  // Welcome and rules stay open. The other two channels in Início are hidden from newcomers,
  // so they cannot share the category's overwrites.
  const inicio = add('📜 Início', 'category', undefined, undefined);
  add('boas-vindas', 'text', inicio, undefined);
  add('regras', 'text', inicio, undefined);
  add('anuncios', 'news', inicio, announcements);
  add('guia', 'text', inicio, registered);

  category('🌍 O Mundo', registered, [
    ['registro', 'text'],
    ['eventos', 'text'],
    ['missoes', 'text'],
    ['combate', 'text'],
    ['tutorial', 'text'],
  ]);
  category('💬 Comunidade', registered, [
    ['geral', 'text'],
    ['fan-art', 'forum'],
    ['teorias', 'forum'],
    ['taverna', 'voice'],
  ]);
  for (const team of TEAMS) {
    const overwrites = viewFor([idOf(team.roleKey), ...staffIds]);
    category(
      team.category,
      overwrites,
      TEAM_CHANNELS.map(([prefix, kind]) => [`${prefix}-${team.slug}`, kind] as const),
    );
  }
  category('🛡️ Staff', staffOnly, [
    ['fila-moderacao', 'text'],
    ['staff', 'text'],
    ['logs', 'text'],
    ['sala-staff', 'voice'],
    ['atualizacoes-discord', 'text'],
    ['alertas-seguranca', 'text'],
  ]);

  return { name: 'Legion', preferred_locale: 'pt-BR', roles, channels };
}

/** Positions for `PATCH /guilds/{id}/roles`. `@everyone` stays at 0. Highest key gets the highest slot. */
export function rolePositions(
  existing: readonly { id: string; name: string }[],
): { id: string; position: number }[] {
  const byName = new Map(existing.map((role) => [role.name, role.id]));
  const present = HIGH_TO_LOW_KEYS.map((key) => roleByKey.get(key)?.name).filter((name): name is string =>
    Boolean(name && byName.has(name)),
  );
  return present.map((name, index) => ({
    id: byName.get(name) as string,
    position: present.length - index,
  }));
}

const orderedRoleNames = (existing: readonly { name: string }[]) => {
  const names = new Set(existing.map((role) => role.name));
  return HIGH_TO_LOW_KEYS.map((key) => roleByKey.get(key)?.name).filter((name): name is string =>
    Boolean(name && names.has(name)),
  );
};

/**
 * Puts Legion roles directly under the bot's own role. Discord will not move a role above the bot,
 * so Professor X gets `botPosition - 1` and the rest step down.
 */
export function rolePositionsBelow(
  existing: readonly LiveRole[],
  botRoleIds: readonly string[],
): { id: string; position: number }[] {
  const botPos = Math.max(
    ...existing.filter((role) => botRoleIds.includes(role.id)).map((role) => role.position ?? 0),
  );
  const byName = new Map(existing.map((role) => [role.name, role.id]));
  const present = orderedRoleNames(existing);
  if (!Number.isFinite(botPos) || botPos - present.length < 1)
    throw new Error('Arraste o cargo do Cérebro para o topo da lista de cargos e rode de novo.');
  return present.map((name, index) => ({
    id: byName.get(name) as string,
    position: botPos - 1 - index,
  }));
}

/** Discord's default rooms on a brand-new server. Anything else stops the fill. */
const STARTER_CHANNELS = new Set([
  'general',
  'geral',
  'text channels',
  'voice channels',
  'canais de texto',
  'canais de voz',
]);

const isStarterChannel = (name: string) => STARTER_CHANNELS.has(name.toLowerCase());

export function guildFillBlockers(
  payload: GuildTemplatePayload,
  roles: readonly LiveRole[],
  channels: readonly LiveChannel[],
): string[] {
  const roleNames = new Set(payload.roles.flatMap((role) => (role.name ? [role.name] : [])));
  const channelNames = new Set(payload.channels.map((channel) => channel.name));
  const blockers: string[] = [];
  for (const role of roles) {
    if (role.managed || role.name === '@everyone' || roleNames.has(role.name)) continue;
    blockers.push(`cargo fora do modelo: ${role.name}`);
  }
  for (const channel of channels) {
    if (channelNames.has(channel.name) || isStarterChannel(channel.name)) continue;
    blockers.push(`canal fora do modelo: ${channel.name}`);
  }
  return blockers;
}

const roleWrite = (role: TemplateRole): RoleWrite => ({
  name: role.name ?? '',
  permissions: role.permissions ?? '0',
  color: role.color ?? 0,
  hoist: role.hoist ?? false,
  mentionable: false,
});

const channelWrite = (
  channel: TemplateChannel,
  roleIds: ReadonlyMap<number, string>,
  parentId: string | undefined,
): ChannelWrite => ({
  name: channel.name,
  // Announcement channels cannot be created directly. They start as text and are converted afterwards.
  type: channel.type === ChannelType.GuildAnnouncement ? ChannelType.GuildText : channel.type,
  ...(parentId !== undefined ? { parent_id: parentId } : {}),
  ...(channel.permission_overwrites
    ? {
        permission_overwrites: channel.permission_overwrites.map((entry) => ({
          id: roleIds.get(entry.id) ?? String(entry.id),
          type: 0 as const,
          allow: entry.allow,
          deny: entry.deny,
        })),
      }
    : {}),
});

const announcementUnsupported = (err: unknown) =>
  err instanceof RestError && err.status === 400 && /type/i.test(err.message);

/**
 * Discord server templates omit announcement channels. The snapshot must be taken while
 * `#anuncios` is still text. The live channel can become an announcement afterwards.
 */
const ANNOUNCEMENT_LIVE =
  '#anuncios ficou como canal de anúncio neste servidor. O link guarda a cópia em texto: o Discord não inclui canal de anúncio. Sincronizar o modelo pelo Discord tira esse canal do link. Rode este comando de novo para gravar o texto e restaurar o anúncio.';
const ANNOUNCEMENT_TEXT_ONLY =
  '#anuncios ficou como canal de texto. O Discord só deixa canal de anúncio num servidor Comunidade.';

interface LoadedGuild {
  guild: { id: string; name: string; owner_id: string };
  roles: LiveRole[];
  channels: LiveChannel[];
  botRoleIds: string[];
  botUserId: string;
}

async function loadGuild(api: TemplateApi, guildId: string): Promise<LoadedGuild> {
  try {
    const guild = await api.guild(guildId);
    const [roles, channels, me] = await Promise.all([
      api.guildRoles(guildId),
      api.guildChannels(guildId),
      api.me(),
    ]);
    const member = await api.guildMember(guildId, me.id);
    if (!member) throw new TemplateAccessError(guildId);
    return { guild, roles, channels, botRoleIds: member.roles, botUserId: me.id };
  } catch (err) {
    if (err instanceof TemplateAccessError) throw err;
    if (err instanceof RestError && (err.status === 404 || err.status === 403))
      throw new TemplateAccessError(guildId);
    throw err;
  }
}

export async function describeGuildFill(api: TemplateApi, guildId: string): Promise<string> {
  const loaded = await loadGuild(api, guildId);
  const payload = buildGuildTemplatePayload();
  const blockers = guildFillBlockers(payload, loaded.roles, loaded.channels);
  const starters = loaded.channels
    .filter((channel) => isStarterChannel(channel.name))
    .map((channel) => channel.name);
  const lines = [
    `Servidor: ${loaded.guild.name} (${loaded.guild.id})`,
    blockers.length
      ? 'Não vou mudar nada. Tem coisa que não faz parte do modelo:'
      : 'Dá para montar o modelo aqui.',
    ...blockers.map((line) => `  • ${line}`),
  ];
  if (!blockers.length)
    lines.push(
      starters.length
        ? `Canais padrão que serão apagados: ${starters.join(', ')}`
        : 'Nenhum canal padrão para apagar.',
      'O nome do servidor passa a ser Legion e o idioma pt-BR, porque o modelo copia os dois.',
      `Para montar e publicar: pnpm legion template --guild ${guildId} --create`,
    );
  return lines.join('\n');
}

/** Builds the template inside a server the user already owns. Refuses if that server has extra rooms or roles. */
export async function fillGuildTemplate(api: TemplateApi, guildId: string): Promise<CreatedTemplate> {
  const loaded = await loadGuild(api, guildId);
  const payload = buildGuildTemplatePayload();
  const blockers = guildFillBlockers(payload, loaded.roles, loaded.channels);
  if (blockers.length)
    throw new Error(`O servidor não está vazio o bastante para virar o modelo:\n${blockers.join('\n')}`);

  try {
    return await writeGuildTemplate(api, guildId, loaded, payload);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${detail}\nO servidor ${guildId} pode ter ficado pela metade. Rode o mesmo comando de novo; ele reaproveita cargos e canais que já existem.`,
    );
  }
}

const keepBotIn = (body: ChannelWrite, guildId: string, botUserId: string): ChannelWrite => {
  const hidden = (body.permission_overwrites ?? []).some(
    (entry) => entry.id === guildId && (BigInt(entry.deny) & VIEW) === VIEW,
  );
  if (!hidden) return body;
  // A member overwrite is not a role, so it is not part of the template people copy.
  // Without it, denying @everyone View Channel locks the bot out of the channel it just created.
  return {
    ...body,
    permission_overwrites: [
      ...(body.permission_overwrites ?? []),
      {
        id: botUserId,
        type: OverwriteType.Member,
        allow: (
          PermissionFlagsBits.ViewChannel |
          PermissionFlagsBits.ManageChannels |
          PermissionFlagsBits.SendMessages |
          PermissionFlagsBits.EmbedLinks |
          PermissionFlagsBits.ReadMessageHistory
        ).toString(),
        deny: '0',
      },
    ],
  };
};

async function writeGuildTemplate(
  api: TemplateApi,
  guildId: string,
  loaded: LoadedGuild,
  payload: GuildTemplatePayload,
): Promise<CreatedTemplate> {
  const roles = await api.guildRoles(guildId);
  for (const channel of loaded.channels) {
    if (isStarterChannel(channel.name)) await api.deleteChannel(channel.id);
  }

  const roleIds = new Map<number, string>([[0, guildId]]);
  const rolesByName = new Map(roles.map((role) => [role.name, role]));
  for (const role of payload.roles) {
    if (!role.name) continue;
    const existing = rolesByName.get(role.name);
    const saved = existing ?? (await api.createRole(guildId, roleWrite(role)));
    roleIds.set(role.id, saved.id);
  }
  await api.setRolePositions(guildId, rolePositionsBelow(await api.guildRoles(guildId), loaded.botRoleIds));

  const channelIds = new Map<number, string>();
  const channelsByName = new Map(
    (await api.guildChannels(guildId)).map((channel) => [channel.name, channel]),
  );
  const announcementIds: string[] = [];
  for (const channel of payload.channels) {
    const parentId = channel.parent_id === undefined ? undefined : channelIds.get(channel.parent_id);
    const body = keepBotIn(channelWrite(channel, roleIds, parentId), guildId, loaded.botUserId);
    const announcement = channel.type === ChannelType.GuildAnnouncement;
    const existing = channelsByName.get(channel.name);
    // Updates omit type so a category or text channel is not sent a type Discord rejects.
    // An announcement channel is the exception: the snapshot has to see it as text.
    const { type: _createdAs, ...update } = body;
    let id: string;
    if (existing) {
      await api.modifyChannel(
        existing.id,
        announcement ? { ...update, type: ChannelType.GuildText } : update,
      );
      id = existing.id;
    } else {
      id = (await api.createChannel(guildId, body)).id;
    }
    channelIds.set(channel.id, id);
    if (announcement) announcementIds.push(id);
  }

  const welcome = payload.channels.find((channel) => channel.name === 'boas-vindas');
  const welcomeId = welcome ? channelIds.get(welcome.id) : undefined;
  await api.modifyGuild(guildId, {
    name: 'Legion',
    preferred_locale: 'pt-BR',
    ...(welcomeId ? { system_channel_id: welcomeId } : {}),
  });
  const existingTemplate = (await api.listTemplates(guildId)).find((template) => template.code);
  const template = existingTemplate
    ? await api.syncTemplate(guildId, existingTemplate.code, { ...TEMPLATE_META })
    : await api.createTemplate(guildId, { ...TEMPLATE_META });

  const warnings: string[] = [];
  for (const id of announcementIds) {
    try {
      await api.modifyChannel(id, { type: ChannelType.GuildAnnouncement });
      warnings.push(ANNOUNCEMENT_LIVE);
    } catch (err) {
      if (!announcementUnsupported(err)) throw err;
      warnings.push(ANNOUNCEMENT_TEXT_ONLY);
    }
  }
  return {
    guildId,
    guildName: 'Legion',
    url: `https://discord.new/${template.code}`,
    inviteUrl: null,
    ...(warnings.length ? { warnings } : {}),
  };
}

export function formatFilledTemplate(result: CreatedTemplate): string {
  return [
    `Modelo publicado a partir de ${result.guildName} (${result.guildId}).`,
    `Link: ${result.url}`,
    '',
    'Esse servidor é a origem do modelo. Apagar o servidor apaga o link.',
    'No servidor de quem usar o link, arraste o cargo do bot para cima dos cargos de equipe e de rank.',
    'Me mande o link para eu colocar em docs/TEMPLATE.md.',
    ...(result.warnings ?? []).flatMap((warning) => ['', warning]),
  ].join('\n');
}

export function formatTemplatePlan(payload = buildGuildTemplatePayload()): string {
  const categories = payload.channels.filter((channel) => channel.type === ChannelType.GuildCategory);
  const lines = [
    'Modelo do Legion. Este comando ainda não cria nada no Discord.',
    '',
    `Servidor: ${payload.name} (${payload.preferred_locale})`,
    `Cargos: ${payload.roles.length - 1}, além de @everyone`,
    `Categorias: ${categories.length}`,
    `Canais: ${payload.channels.length - categories.length}`,
    '',
    'Categorias:',
  ];
  for (const category of categories) {
    const children = payload.channels
      .filter((channel) => channel.parent_id === category.id)
      .map((channel) => channel.name);
    lines.push(`  ${category.name}: ${children.join(', ')}`);
  }
  lines.push(
    '',
    'Para montar o modelo num servidor que você já criou (o Cérebro precisa estar nele):',
    '  pnpm legion template --guild <id>',
    '  pnpm legion template --guild <id> --create',
    '',
    'Para o bot criar um servidor novo (só se ele estiver em menos de 10; o bot fica dono):',
    '  pnpm legion template --create',
  );
  return lines.join('\n');
}

export async function templateStatus(api: TemplateApi): Promise<string> {
  const guilds = await api.guilds();
  const lines = [
    `O Cérebro está em ${guilds.length} servidor(es). Para criar outro, precisa estar em menos de 10.`,
    ...guilds.map((guild) => `  • ${guild.name} (${guild.id})`),
  ];
  lines.push(
    guilds.length >= 10
      ? 'Saia de um servidor com o bot e rode este comando de novo.'
      : 'Pode criar: pnpm legion template --create',
  );
  return lines.join('\n');
}

export async function createLegionTemplate(api: TemplateApi): Promise<CreatedTemplate> {
  const guilds = await api.guilds();
  if (guilds.length >= 10)
    throw new Error(
      `O Cérebro já está em ${guilds.length} servidores. O Discord só deixa um bot criar um servidor novo abaixo de 10. Saia de um e rode de novo.`,
    );
  const guild = await api.createGuild(buildGuildTemplatePayload());
  try {
    const roles = guild.roles?.length ? guild.roles : await api.guildRoles(guild.id);
    await api.setRolePositions(guild.id, rolePositions(roles));
    const channels = await api.guildChannels(guild.id);
    const welcome = channels.find((channel) => channel.name === 'boas-vindas');
    if (welcome) await api.modifyGuild(guild.id, { system_channel_id: welcome.id });
    const invite = welcome ? await api.createInvite(welcome.id) : null;
    const template = await api.createTemplate(guild.id, { ...TEMPLATE_META });
    return {
      guildId: guild.id,
      guildName: guild.name,
      url: `https://discord.new/${template.code}`,
      inviteUrl: invite ? `https://discord.gg/${invite.code}` : null,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${detail}\nO servidor "${guild.name}" (${guild.id}) já foi criado e continua com o bot. Apague-o no Discord se quiser desfazer.`,
    );
  }
}

export function formatCreatedTemplate(result: CreatedTemplate): string {
  return [
    `Servidor criado: ${result.guildName} (${result.guildId})`,
    `Modelo: ${result.url}`,
    result.inviteUrl
      ? `Entre para conferir (o convite vale 24h e 5 usos): ${result.inviteUrl}`
      : 'Não gerei convite. O bot é o dono do servidor; o link do modelo mesmo assim funciona.',
    '',
    'O servidor em que você já joga não foi alterado.',
    'Guarde este servidor. O link do modelo aponta para ele.',
    'Guarde o aplicativo do Cérebro. Ele é o dono deste servidor.',
    'Me mande o link discord.new para eu colocar em docs/TEMPLATE.md.',
  ].join('\n');
}

const MAX_RETRIES = 8;
const MAX_WAIT_MS = 60_000;

/** Discord REST for the template command. Same retry behavior as the rest of the CLI. */
export function createTemplateApi(
  token: string,
  base = 'https://discord.com/api/v10',
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): TemplateApi {
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
      const seconds = await retryAfterSeconds(res);
      if (seconds !== null && seconds * 1000 <= MAX_WAIT_MS) {
        await wait(Math.ceil(seconds * 1000) + 250);
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
    guilds: () => call('GET', '/users/@me/guilds?limit=200'),
    guild: (guildId) => call('GET', `/guilds/${guildId}`),
    guildMember: async (guildId, userId) => {
      try {
        return await call<{ roles: string[] }>('GET', `/guilds/${guildId}/members/${userId}`);
      } catch (err) {
        if (err instanceof RestError && err.status === 404) return null;
        throw err;
      }
    },
    createGuild: (body) => call('POST', '/guilds', body),
    guildRoles: (guildId) => call('GET', `/guilds/${guildId}/roles`),
    createRole: (guildId, body) => call('POST', `/guilds/${guildId}/roles`, body),
    setRolePositions: (guildId, positions) => call('PATCH', `/guilds/${guildId}/roles`, positions),
    guildChannels: (guildId) => call('GET', `/guilds/${guildId}/channels`),
    createChannel: (guildId, body) => call('POST', `/guilds/${guildId}/channels`, body),
    modifyChannel: (channelId, body) => call('PATCH', `/channels/${channelId}`, body),
    deleteChannel: (channelId) => call('DELETE', `/channels/${channelId}`),
    modifyGuild: (guildId, body) => call('PATCH', `/guilds/${guildId}`, body),
    createInvite: async (channelId) => {
      try {
        return await call<{ code: string }>('POST', `/channels/${channelId}/invites`, {
          max_age: 86_400,
          max_uses: 5,
          unique: true,
        });
      } catch {
        return null;
      }
    },
    createTemplate: (guildId, body) => call('POST', `/guilds/${guildId}/templates`, body),
    listTemplates: (guildId) => call('GET', `/guilds/${guildId}/templates`),
    syncTemplate: (guildId, code, body) => call('PUT', `/guilds/${guildId}/templates/${code}`, body),
  };
}
