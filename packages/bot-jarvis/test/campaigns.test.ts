import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CerebroRepo } from '@legion/bot-cerebro';
import type { TestContext } from '@legion/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import {
  type Campaign,
  campaignDirs,
  campaignImportIds,
  checkCampaignContent,
  jarvis,
  type Mission,
  missionDirs,
  parseCampaignYaml,
  readCampaigns,
  readContent,
  unmet,
} from '../src/index.js';
import { events, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const MISSIONS_CH = '300000000000000009';
const STAFF = '900';
const [A, B] = ['111', '222'];
const FACTIONS = [
  'independent',
  'xmen',
  'brotherhood',
  'avengers',
  'shield',
  'guardians',
  'defenders',
  'thunderbolts',
  'midnight_sons',
];

// ---------- fixtures ----------

const campaign = (o: Partial<Campaign> = {}): Campaign => ({
  id: 'sombras',
  kind: 'story',
  title: { 'pt-BR': 'Sombras sobre a cidade', en: 'Shadows over the city' },
  summary: { 'pt-BR': 'Um mistério em capítulos.', en: 'A mystery in chapters.' },
  ...o,
});

/** A short story mission: the first choice wins. */
const mission = (id: string, o: Partial<Mission> = {}): Mission =>
  ({
    id,
    kind: 'story',
    title: { 'pt-BR': `Capítulo ${id}`, en: `Chapter ${id}` },
    summary: 'Um capítulo.',
    minLevel: 1,
    party: 1,
    difficulty: 'normal',
    start: 'a',
    scenes: {
      a: {
        text: 'Início',
        choices: [
          { label: 'Vencer', next: 'b' },
          { label: 'Perder', next: 'c' },
        ],
      },
      b: { text: 'Fim bom', end: 'success' },
      c: { text: 'Fim ruim', end: 'failure' },
    },
    ...o,
  }) as Mission;

const chapter = (id: string, n: number, requires?: Mission['requires'], o: Partial<Mission> = {}) =>
  mission(id, {
    campaign: { id: o.campaign?.id ?? 'sombras', chapter: n },
    ...(requires ? { requires } : {}),
    ...o,
  });

/** The three chapters used by most tests: 2 needs 1; 3 needs 2, level 3 and a science/tech origin. */
const SOMBRAS = [
  chapter('sombras-1', 1),
  chapter('sombras-2', 2, { missions: ['sombras-1'] }),
  chapter('sombras-3', 3, { missions: ['sombras-2'], level: 3, origins: ['ciencia', 'tecnologia'] }),
];

function contentDir(campaigns: Campaign[], missions: Mission[]) {
  const d = mkdtempSync(join(tmpdir(), 'campaigns-'));
  mkdirSync(join(d, 'missions'));
  mkdirSync(join(d, 'campaigns'));
  for (const c of campaigns) writeFileSync(join(d, 'campaigns', `${c.id}.yaml`), stringify(c));
  for (const m of missions) writeFileSync(join(d, 'missions', `${m.id}.yaml`), stringify(m));
  return d;
}

async function setup(campaigns: Campaign[] = [campaign()], missions: Mission[] = SOMBRAS, config = {}) {
  t = await setupJarvis({ channels: { missions: MISSIONS_CH }, ...config });
  t.gateway.addChannel({ id: MISSIONS_CH, name: 'missoes', kind: 'text', parentId: null, overwrites: [] });
  const dir = contentDir(campaigns, missions);
  const s = servicesOf(t);
  // Only this test's files (not the shipped tutorial campaign).
  const res = await s.missions.reload([join(dir, 'missions')], [join(dir, 'campaigns')]);
  expect(res.errors).toEqual([]);
  return { t, s, dir };
}

/** A registered hero with an origin, a team and a level. */
async function hero(
  tc: TestContext,
  userId: string,
  o: { origin?: string; faction?: string; level?: number } = {},
) {
  tc.gateway.members.get(userId) ?? tc.gateway.addMember({ userId });
  const repo = new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId);
  const { row } = await repo.ensureMember(userId);
  await repo.updateMember(row.id, { onboardingStep: 'registered', faction: o.faction ?? 'independent' });
  await repo.insertMutant({
    memberId: row.id,
    codename: `Herói ${userId}`,
    codenameNormalized: `heroi ${userId}`,
    power: 'p',
    archetype: 'Elemental',
    origin: 'o',
    originType: o.origin ?? 'mutante',
  });
  if (o.level) await setLevel(tc, row.id, o.level);
  return row.id;
}

async function setLevel(tc: TestContext, memberId: string, level: number) {
  const s = servicesOf(tc);
  await s.repo.ensureProgress(memberId);
  await tc.db.orm
    .update(s.repo.t.jarvisProgress)
    .set({ level })
    .where(eq(s.repo.t.jarvisProgress.memberId, memberId));
}

const startCmd = (tc: TestContext, missao: string, userId = A) =>
  tc.interact({ kind: 'command', userId, commandName: 'missao', subcommand: 'iniciar', options: { missao } });
const scenes = (tc: TestContext) =>
  tc.gateway.messages.filter((m) => m.msg.persona === 'jarvis' && (m.msg.components?.[0]?.length ?? 0) > 0);
const lastButtons = (tc: TestContext) =>
  (scenes(tc).at(-1)?.msg.components?.[0] ?? []).map((b) => ('customId' in b ? (b.customId ?? '') : ''));
const reply = (tc: TestContext, id: string) => tc.gateway.lastReply(id);
/** The Publicar button of an import preview. */
const publishButton = (tc: TestContext, id: string) => {
  const btn = reply(tc, id)?.components?.[0]?.[0];
  return btn && 'customId' in btn ? (btn.customId ?? '') : '';
};

/** Plays a solo mission to its success ending. */
async function win(tc: TestContext, missionId: string, userId = A) {
  const id = await startCmd(tc, missionId, userId);
  expect(reply(tc, id)?.content).toMatch(/Missão iniciada/);
  await tc.interact({ kind: 'component', userId, customId: lastButtons(tc)[0] ?? '' });
}

const autocomplete = async (tc: TestContext, userId = A) => {
  const id = await tc.interact({
    kind: 'autocomplete',
    userId,
    commandName: 'missao',
    subcommand: 'iniciar',
    focused: { name: 'missao', value: '' },
  });
  const calls = tc.gateway.callsOf('respondAutocomplete') as [string, { value: string }[]][];
  return (calls.find((c) => c[0] === id)?.[1] ?? []).map((c) => c.value);
};
const campanha = (tc: TestContext, userId = A, campanhaId?: string) =>
  tc.interact({
    kind: 'command',
    userId,
    commandName: 'campanha',
    options: campanhaId ? { campanha: campanhaId } : {},
  });

// ---------- 1.1.1 schema and loading ----------

describe('campaign rules', () => {
  const problems = (cs: Campaign[], ms: Mission[], o = {}) =>
    checkCampaignContent(cs, ms, { unknownRequires: 'error', ...o }).map(
      (p) => `${p.missionId} ${p.path}: ${p.message}`,
    );

  it('accepts the fixture campaign', () => {
    expect(problems([campaign()], SOMBRAS)).toEqual([]);
  });

  it('refuses an unknown mission in requires (a warning for files)', () => {
    const ms = [chapter('sombras-1', 1, { missions: ['nao-existe'] })];
    expect(problems([campaign()], ms)).toEqual([
      'sombras-1 requires.missions.0: missão "nao-existe" não existe',
    ]);
    expect(checkCampaignContent([campaign()], ms, { unknownRequires: 'warn' })[0]?.level).toBe('warn');
  });

  it('refuses a cycle', () => {
    const ms = [
      chapter('sombras-1', 1, { missions: ['sombras-3'] }),
      chapter('sombras-2', 2, { missions: ['sombras-1'] }),
      chapter('sombras-3', 3, { missions: ['sombras-2'] }),
    ];
    expect(problems([campaign()], ms)).toEqual([
      'sombras-1 requires.missions: ciclo em requires',
      'sombras-2 requires.missions: ciclo em requires',
      'sombras-3 requires.missions: ciclo em requires',
    ]);
    expect(problems([campaign()], [chapter('sombras-1', 1, { missions: ['sombras-1'] })])).toContain(
      'sombras-1 requires.missions.0: a missão não pode exigir ela mesma',
    );
  });

  it('refuses a repeated chapter and an unknown campaign', () => {
    expect(problems([campaign()], [chapter('sombras-1', 1), chapter('sombras-2', 1)])).toEqual([
      'sombras-2 campaign.chapter: capítulo 1 repetido (já é a missão "sombras-1")',
    ]);
    expect(problems([], [chapter('sombras-1', 1)])).toEqual([
      'sombras-1 campaign.id: campanha "sombras" não existe',
    ]);
  });

  it('joinFaction only in a recruitment campaign, for its own team, and the team must be enabled', () => {
    const recruit = campaign({ id: 'recrutamento-vingadores', kind: 'recruitment', faction: 'avengers' });
    const join = (to: string, c = recruit) =>
      chapter('rv-1', 1, undefined, { campaign: { id: c.id, chapter: 1 }, reward: { joinFaction: to } });
    expect(problems([recruit], [join('avengers')], { factions: FACTIONS })).toEqual([]);
    expect(problems([campaign()], [join('avengers', campaign())])).toEqual([
      'rv-1 reward.joinFaction: joinFaction só vale numa missão de campanha de recrutamento',
    ]);
    expect(problems([recruit], [join('xmen')])).toEqual([
      'rv-1 reward.joinFaction: a campanha recruta para "avengers", não "xmen"',
    ]);
    expect(problems([recruit], [join('avengers')], { factions: ['independent', 'xmen'] })).toEqual([
      'rv-1 reward.joinFaction: a equipe "avengers" não existe ou está desligada',
    ]);
    expect(problems([], [mission('solta', { reward: { joinFaction: 'avengers' } })])).toEqual([
      'solta reward.joinFaction: joinFaction só vale numa missão de campanha de recrutamento',
    ]);
  });

  it('a recruitment campaign needs a team, and only recruitment campaigns have one', () => {
    const dir = contentDir(
      [campaign({ id: 'sem-equipe', kind: 'recruitment' }), campaign({ id: 'com-equipe', faction: 'xmen' })],
      [],
    );
    expect(readCampaigns(campaignDirs(dir)).errors).toEqual([
      'com-equipe.yaml → faction: faction só vale em campanha de recrutamento',
      'sem-equipe.yaml → faction: campanha de recrutamento precisa de faction',
    ]);
  });

  it("the server's files override the shipped ones by id; a bad file is skipped with an error", () => {
    const shipped = contentDir([campaign()], []);
    const server = contentDir([campaign({ title: 'Versão do servidor' })], []);
    writeFileSync(join(server, 'campaigns', 'quebrada.yaml'), 'id: [quebrada');
    const res = readCampaigns([join(shipped, 'campaigns'), join(server, 'campaigns')]);
    expect(res.campaigns.map((c) => [c.id, c.title])).toEqual([['sombras', 'Versão do servidor']]);
    expect(res.errors[0]).toMatch(/^quebrada\.yaml \(linha 1\): YAML inválido/);
  });

  it('loading skips missions with errors and keeps the rest; unknown requires only warns', () => {
    const dir = contentDir(
      [campaign()],
      [
        chapter('sombras-1', 1),
        chapter('sombras-2', 1), // repeated chapter → skipped
        chapter('sombras-3', 3, { missions: ['falta-importar'] }), // loads, locked
      ],
    );
    const res = readContent(missionDirs(dir), campaignDirs(dir));
    expect(res.missions.map((m) => m.id).filter((id) => id.startsWith('sombras'))).toEqual([
      'sombras-1',
      'sombras-3',
    ]);
    expect(res.errors).toEqual([
      'missão "sombras-2" → campaign.chapter: capítulo 1 repetido (já é a missão "sombras-1")',
    ]);
    expect(res.warnings).toEqual([
      'missão "sombras-3" → requires.missions.0: missão "falta-importar" não existe',
    ]);
  });

  it('stores campaigns and the mission columns; the doctor fails on errors and warns on locked missions', async () => {
    const { t, s } = await setup();
    expect((await s.repo.campaign('sombras'))?.kind).toBe('story');
    expect(await s.repo.mission('sombras-3')).toMatchObject({
      campaignId: 'sombras',
      chapter: 3,
      requires: JSON.stringify({ missions: ['sombras-2'], level: 3, origins: ['ciencia', 'tecnologia'] }),
    });
    const check = jarvis.doctorChecks?.(t.ctxOf(jarvis)).find((c) => c.id === 'jarvis.missions');
    expect((await check?.run())?.status).toBe('warn'); // channels are fine; no data/content in tests
  });
});

// ---------- 1.1.2 requirements in play ----------

describe('requirements', () => {
  const facts = (o: Partial<Parameters<typeof unmet>[1]> = {}) => ({
    level: 1,
    originType: 'mutante',
    faction: 'independent',
    done: new Set<string>(),
    ...o,
  });

  it('reports each missing requirement', () => {
    const m = {
      requires: { missions: ['a', 'b'], level: 5, origins: ['ciencia' as const], factions: ['xmen'] },
    };
    expect(unmet(m, facts({ done: new Set(['a']) }), null, FACTIONS)).toEqual({
      hidden: false,
      missing: [
        { key: 'missions', missions: ['b'] },
        { key: 'level', level: 5 },
        { key: 'origin', origins: ['ciencia'] },
        { key: 'faction', factions: ['xmen'] },
      ],
    });
    const ok = facts({ done: new Set(['a', 'b']), level: 5, originType: 'ciencia', faction: 'xmen' });
    expect(unmet(m, ok, null, FACTIONS)).toEqual({ hidden: false, missing: [] });
  });

  it('hides a recruitment arc from its own team and when the team is off; a disabled team counts as Independente', () => {
    const arc = { kind: 'recruitment' as const, faction: 'avengers' };
    expect(unmet({}, facts({ faction: 'avengers' }), arc, FACTIONS).hidden).toBe(true);
    expect(unmet({}, facts({ faction: 'xmen' }), arc, FACTIONS).hidden).toBe(false);
    expect(unmet({}, facts(), arc, ['independent', 'xmen']).hidden).toBe(true);
    const onlyIndependents = { requires: { factions: ['independent'] } };
    expect(
      unmet(onlyIndependents, facts({ faction: 'thunderbolts' }), null, ['independent']).missing,
    ).toEqual([]);
  });

  it('locked missions are hidden from autocomplete and unlock in order after a success', async () => {
    const { t } = await setup();
    await hero(t, A, { origin: 'ciencia' });
    expect((await autocomplete(t)).filter((id) => id.startsWith('sombras'))).toEqual(['sombras-1']);
    await win(t, 'sombras-1');
    expect((await autocomplete(t)).filter((id) => id.startsWith('sombras'))).toEqual(['sombras-2']);
  });

  it('a typed locked id names what is missing', async () => {
    const { t } = await setup();
    await hero(t, A, { origin: 'mutante' });
    const id = await startCmd(t, 'sombras-2');
    expect(reply(t, id)?.content).toBe('Bloqueada: falta concluir **Capítulo sombras-1**');
    await win(t, 'sombras-1');
    await win(t, 'sombras-2');
    const third = await startCmd(t, 'sombras-3');
    expect(reply(t, third)?.content).toBe(
      'Bloqueada: falta chegar ao nível 3; ser de origem Ciência, Tecnologia',
    );
  });

  it('the team requirement uses the current team', async () => {
    const { t } = await setup([campaign()], [chapter('sombras-1', 1, { factions: ['xmen', 'avengers'] })]);
    await hero(t, A, { faction: 'independent' });
    await hero(t, B, { faction: 'xmen' });
    expect(reply(t, await startCmd(t, 'sombras-1'))?.content).toBe(
      'Bloqueada: falta estar em X-Men, Vingadores',
    );
    expect(reply(t, await startCmd(t, 'sombras-1', B))?.content).toMatch(/Missão iniciada/);
  });

  it('a recruitment arc is hidden from members of that team (unknown when typed, missing in /missao lista)', async () => {
    const arc = campaign({ id: 'recrutamento-xmen', kind: 'recruitment', faction: 'xmen' });
    const { t } = await setup(
      [arc],
      [
        chapter('rx-1', 1, undefined, {
          campaign: { id: 'recrutamento-xmen', chapter: 1 },
          reward: { joinFaction: 'xmen' },
        }),
      ],
    );
    await hero(t, A, { faction: 'xmen' });
    await hero(t, B, { faction: 'independent' });
    expect(reply(t, await startCmd(t, 'rx-1'))?.content).toBe(
      'Não encontrei essa missão. Use /missao lista.',
    );
    expect(await autocomplete(t)).not.toContain('rx-1');
    expect(await autocomplete(t, B)).toContain('rx-1');
    const list = await t.interact({ kind: 'command', userId: A, commandName: 'missao', subcommand: 'lista' });
    expect(JSON.stringify(reply(t, list)?.embeds)).not.toContain('Capítulo rx-1');
  });

  it('in a party every member must meet the requirements; the lobby says who does not and the leader cannot start', async () => {
    const { t } = await setup(
      [campaign()],
      [chapter('sombras-1', 1), chapter('sombras-2', 2, { missions: ['sombras-1'] }, { party: 2 })],
    );
    await hero(t, A);
    await hero(t, B);
    await win(t, 'sombras-1', A);
    const open = await startCmd(t, 'sombras-2', A);
    expect(reply(t, open)?.content).toMatch(/Grupo aberto/);
    const lobby = () =>
      t?.gateway.messages.filter((m) => m.msg.embeds?.[0]?.title?.startsWith('Capítulo sombras-2')).at(-1);
    const btn = (action: string) =>
      (lobby()?.msg.components?.[0] ?? [])
        .map((b) => ('customId' in b ? (b.customId ?? '') : ''))
        .find((c) => c.endsWith(action)) ?? '';
    const joined = await t.interact({ kind: 'component', userId: B, customId: btn('join') });
    const fields = reply(t, joined)?.embeds?.[0]?.fields ?? [];
    expect(fields.at(-1)).toEqual({
      name: '⚠️ Falta para começar',
      value: `⚠️ <@${B}>: concluir **Capítulo sombras-1**`,
    });
    const start = await t.interact({ kind: 'component', userId: A, customId: btn('start') });
    expect(reply(t, start)?.content).toBe(
      `Ainda não dá para começar. Falta:\n⚠️ <@${B}>: concluir **Capítulo sombras-1**`,
    );
    const run = (
      await servicesOf(t).repo.runsOf((await t.ctxOf(jarvis).read.members.getByDiscordId(A))?.id ?? '', [
        'lobby',
      ])
    )[0];
    expect(run?.status).toBe('lobby');
  });
});

// ---------- 1.2.1 /campanha ----------

describe('/campanha', () => {
  it('lists campaigns with progress and the next chapter, then shows chapters with reasons', async () => {
    const { t } = await setup();
    await hero(t, A, { origin: 'mutante' });
    const first = await campanha(t);
    expect(reply(t, first)?.embeds?.[0]?.fields?.[0]).toEqual({
      name: 'Sombras sobre a cidade · História',
      value:
        'Um mistério em capítulos.\n0/3 capítulos\n▶️ Próximo: **Capítulo sombras-1** (`/missao iniciar sombras-1`)',
    });
    await win(t, 'sombras-1');
    await win(t, 'sombras-2');
    const after = await campanha(t);
    expect(reply(t, after)?.embeds?.[0]?.fields?.[0]?.value).toBe(
      'Um mistério em capítulos.\n2/3 capítulos\n🔒 Próximo: **Capítulo sombras-3** · falta chegar ao nível 3; ser de origem Ciência, Tecnologia',
    );
    const detail = await campanha(t, A, 'sombras');
    expect(reply(t, detail)?.embeds?.[0]).toMatchObject({
      title: 'Sombras sobre a cidade · 2/3 capítulos',
      description: [
        'Um mistério em capítulos.',
        '',
        '✅ 1. Capítulo sombras-1',
        '✅ 2. Capítulo sombras-2',
        '🔒 3. Capítulo sombras-3 · falta chegar ao nível 3; ser de origem Ciência, Tecnologia',
      ].join('\n'),
    });
  });

  it('a failed run does not count; a complete campaign says so', async () => {
    const { t } = await setup([campaign()], [chapter('sombras-1', 1)]);
    await hero(t, A);
    await startCmd(t, 'sombras-1');
    await t.interact({ kind: 'component', userId: A, customId: lastButtons(t)[1] ?? '' }); // failure
    expect(reply(t, await campanha(t))?.embeds?.[0]?.fields?.[0]?.value).toContain('0/1 capítulos');
    await servicesOf(t).repo.db.orm.update(servicesOf(t).repo.t.jarvisMissionRuns).set({ status: 'success' });
    expect(reply(t, await campanha(t))?.embeds?.[0]?.fields?.[0]?.value).toBe(
      'Um mistério em capítulos.\n1/1 capítulos\n✅ Campanha concluída!',
    );
  });

  it('speaks English and autocompletes campaign names', async () => {
    const { t } = await setup([campaign()], SOMBRAS, { locale: 'en' });
    await hero(t, A, { origin: 'mutante' });
    const id = await campanha(t, A, 'sombras');
    expect(reply(t, id)?.embeds?.[0]).toMatchObject({
      title: 'Shadows over the city · 0/3 chapters',
      description: expect.stringContaining(
        '🔒 3. Chapter sombras-3 · you still need to finish **Chapter sombras-2**; reach level 3; have origin Science, Technology',
      ),
    });
    const ac = await t.interact({
      kind: 'autocomplete',
      userId: A,
      commandName: 'campanha',
      focused: { name: 'campanha', value: 'shad' },
    });
    const calls = t.gateway.callsOf('respondAutocomplete') as [string, { name: string; value: string }[]][];
    expect(calls.find((c) => c[0] === ac)?.[1]).toEqual([
      { name: 'Shadows over the city', value: 'sombras' },
    ]);
  });

  it('an unknown campaign and an empty server', async () => {
    const { t } = await setup([], []);
    await hero(t, A);
    expect(reply(t, await campanha(t))?.content).toBe('Nenhuma campanha disponível por enquanto.');
    expect(reply(t, await campanha(t, A, 'nada'))?.content).toBe(
      'Não encontrei essa campanha. Use /campanha para ver a lista.',
    );
  });
});

// ---------- 1.2.2 /jarvis campanha importar ----------

const CDN = 'https://cdn.discordapp.com/attachments/1/2/';
function upload(tc: TestContext, text: string, name = 'campanha.yaml') {
  const url = `${CDN}${name}`;
  tc.gateway.cdn.set(url, text);
  return { url, name, size: Buffer.byteLength(text), contentType: 'text/yaml' };
}
const importCmd = (tc: TestContext, text: string, userId = STAFF) =>
  tc.interact({
    kind: 'command',
    userId,
    isGuildOwner: userId === STAFF,
    commandName: 'jarvis',
    subcommand: 'campanha importar',
    attachments: { arquivo: upload(tc, text) },
  });
const fileOf = (c: Campaign, ms: Mission[]) => stringify({ campaign: c, missions: ms });
const imported = () => {
  const c = campaign({ id: 'noite-longa', title: 'Noite longa' });
  return {
    c,
    ms: [
      chapter('noite-1', 1, undefined, { campaign: { id: 'noite-longa', chapter: 1 } }),
      chapter('noite-2', 2, { missions: ['noite-1'] }, { campaign: { id: 'noite-longa', chapter: 2 } }),
    ],
  };
};

describe('/jarvis campanha importar', () => {
  it('previews, publishes and plays; the file round-trips', async () => {
    const { t, s } = await setup();
    await hero(t, A);
    const { c, ms } = imported();
    const text = fileOf(c, ms);
    const parsed = parseCampaignYaml(text);
    // Round trip: parse → write → parse gives the same data.
    if (!('file' in parsed)) throw new Error(parsed.errors.join('\n'));
    expect(parse(fileOf(parsed.file.campaign, parsed.file.missions))).toEqual(parse(text));
    const id = await importCmd(t, text);
    expect(reply(t, id)?.embeds?.[0]).toMatchObject({
      title: 'Prévia: Noite longa',
      description: expect.stringContaining(
        '`noite-longa` · História · 2 capítulo(s)\n1. Capítulo noite-1 (`noite-1`)',
      ),
    });
    expect(await s.repo.campaign('noite-longa')).toBeNull();
    const publish = publishButton(t, id);
    const done = await t.interact({
      kind: 'component',
      userId: STAFF,
      isGuildOwner: true,
      customId: publish,
    });
    expect(reply(t, done)?.content).toBe(
      '✅ Campanha `noite-longa` publicada com 2 missão(ões). Já aparece em /campanha e /missao.',
    );
    expect(await s.repo.campaign('noite-longa')).toMatchObject({
      origin: 'staff',
      importedBy: STAFF,
      active: 1,
    });
    expect(await s.repo.mission('noite-2')).toMatchObject({
      origin: 'staff',
      campaignId: 'noite-longa',
      chapter: 2,
    });
    await win(t, 'noite-1');
    expect(reply(t, await campanha(t, A, 'noite-longa'))?.embeds?.[0]?.description).toContain(
      '▶️ 2. **Capítulo noite-2**',
    );
    // A file reload keeps staff imports.
    await s.missions.reload(missionDirs('/nonexistent'), campaignDirs('/nonexistent'));
    expect((await s.repo.campaign('noite-longa'))?.active).toBe(1);
  });

  it('an error anywhere changes nothing', async () => {
    const { t, s } = await setup();
    const { c, ms } = imported();
    const bad = [
      ms[0] as Mission,
      chapter('noite-2', 1, undefined, { campaign: { id: 'noite-longa', chapter: 1 } }),
    ];
    const id = await importCmd(t, fileOf(c, bad));
    expect(reply(t, id)?.content).toContain('missions.1.campaign.chapter: capítulo 1 repetido');
    expect(reply(t, id)?.components ?? []).toEqual([]);
    expect(await s.repo.campaign('noite-longa')).toBeNull();
    expect(await s.repo.mission('noite-1')).toBeNull();

    const cycle = [
      chapter('noite-1', 1, { missions: ['noite-2'] }, { campaign: { id: 'noite-longa', chapter: 1 } }),
      chapter('noite-2', 2, { missions: ['noite-1'] }, { campaign: { id: 'noite-longa', chapter: 2 } }),
    ];
    expect(reply(t, await importCmd(t, fileOf(c, cycle)))?.content).toContain('ciclo em requires');
    const unknown = [
      chapter('noite-1', 1, { missions: ['fantasma'] }, { campaign: { id: 'noite-longa', chapter: 1 } }),
    ];
    expect(reply(t, await importCmd(t, fileOf(c, unknown)))?.content).toContain(
      'missão "fantasma" não existe',
    );
    const other = [chapter('noite-1', 1, undefined, { campaign: { id: 'sombras', chapter: 9 } })];
    expect(reply(t, await importCmd(t, fileOf(c, other)))?.content).toContain(
      'missions.0.campaign: use { id: noite-longa, chapter: N }',
    );
  });

  it('refuses shipped ids, and joinFaction for a team that is off', async () => {
    const { t } = await setup();
    const { c, ms } = imported();
    const shippedMission = [
      chapter('patrulha-noturna', 1, undefined, { campaign: { id: 'noite-longa', chapter: 1 } }),
    ];
    expect(reply(t, await importCmd(t, fileOf(c, shippedMission)))?.content).toContain(
      'missions.0.id: "patrulha-noturna" é uma missão que vem com o Legion; use outro id',
    );
    expect(
      reply(
        t,
        await importCmd(
          t,
          fileOf(
            campaign(),
            ms.map((m) => ({ ...m, campaign: { id: 'sombras', chapter: m.campaign?.chapter ?? 1 } })),
          ),
        ),
      )?.content,
    ).toContain('campaign.id: "sombras" é uma campanha que vem com o Legion; use outro id');
    const arc = campaign({ id: 'recrutamento-wakanda', kind: 'recruitment', faction: 'wakanda' });
    const join = [
      chapter('rw-1', 1, undefined, {
        campaign: { id: arc.id, chapter: 1 },
        reward: { joinFaction: 'wakanda' },
      }),
    ];
    expect(reply(t, await importCmd(t, fileOf(arc, join)))?.content).toContain(
      'a equipe "wakanda" não existe ou está desligada',
    );
  });

  it('is staff only, at the command and at Publicar', async () => {
    const { t } = await setup();
    await hero(t, A);
    const { c, ms } = imported();
    expect(reply(t, await importCmd(t, fileOf(c, ms), A))?.content).toContain('Apenas a staff');
    const id = await importCmd(t, fileOf(c, ms));
    const publish = publishButton(t, id);
    expect(publish).toBe(campaignImportIds.decide(publish.split(':')[3] ?? '', 'publish'));
    const notStaff = await t.interact({ kind: 'component', userId: A, customId: publish });
    expect(reply(t, notStaff)?.content).toContain('Apenas a staff');
    expect(await servicesOf(t).repo.campaign('noite-longa')).toBeNull();
  });
});

describe('/jarvis missao importar with campaign fields', () => {
  const importMission = (tc: TestContext, m: Mission) =>
    tc.interact({
      kind: 'command',
      userId: STAFF,
      isGuildOwner: true,
      commandName: 'jarvis',
      subcommand: 'missao importar',
      attachments: { arquivo: upload(tc, stringify(m), `${m.id}.yaml`) },
    });

  it('checks the mission against the campaigns and missions on the server', async () => {
    const { t } = await setup();
    const unknown = chapter('extra-1', 9, undefined, { campaign: { id: 'nao-existe', chapter: 1 } });
    expect(reply(t, await importMission(t, unknown))?.content).toContain(
      'campaign.id: campanha "nao-existe" não existe',
    );
    expect(reply(t, await importMission(t, chapter('extra-2', 2)))?.content).toContain(
      'campaign.chapter: capítulo 2 repetido (já é a missão "sombras-2")',
    );
    expect(
      reply(t, await importMission(t, chapter('extra-3', 4, { missions: ['fantasma'] })))?.content,
    ).toContain('requires.missions.0: missão "fantasma" não existe');
    const ok = await importMission(t, chapter('sombras-4', 4, { missions: ['sombras-3'] }));
    expect(reply(t, ok)?.embeds?.[0]?.title).toBe('Prévia: Capítulo sombras-4');
    // File / pack ids cannot be replaced (same rule as trivia/item import).
    expect(
      reply(t, await importMission(t, chapter('sombras-2', 2, { missions: ['sombras-1'] })))?.content,
    ).toContain('sombras-2: id de uma missão dos arquivos');
    // A staff-owned chapter can be re-imported without counting as a chapter repeat.
    await t.interact({
      kind: 'component',
      userId: STAFF,
      isGuildOwner: true,
      customId: (reply(t, ok)?.components?.[0]?.[0] as { customId?: string } | undefined)?.customId ?? '',
    });
    const again = await importMission(t, chapter('sombras-4', 4, { missions: ['sombras-3'] }));
    expect(reply(t, again)?.embeds?.[0]?.title).toBe('Prévia: Capítulo sombras-4');
  });
});

// ---------- US-28: recruitment arcs join the team ----------

describe('recruitment arcs: finishing the arc joins the team', () => {
  const DAY = 86_400_000;
  const RECRUIT = campaign({
    id: 'recrutamento-vingadores',
    kind: 'recruitment',
    faction: 'avengers',
    title: { 'pt-BR': 'Teste dos Vingadores', en: 'Avengers trial' },
  });
  const rv = (n: number, o: Partial<Mission> = {}) =>
    chapter(`rv-${n}`, n, n > 1 ? { missions: [`rv-${n - 1}`] } : undefined, {
      campaign: { id: RECRUIT.id, chapter: n },
      party: 2,
      ...o,
    });
  const ARC = [rv(1), rv(2, { reward: { joinFaction: 'avengers' } })];

  const thread = (tc: TestContext) =>
    tc.gateway.messages
      .filter((m) => m.msg.persona === 'jarvis' && !m.msg.components?.length)
      .map((m) => m.msg.content ?? '');
  const memberOf = async (tc: TestContext, userId: string) =>
    new CerebroRepo(tc.db, tc.gateway.guildId, tc.clock, tc.runtime.newId).memberByDiscordId(userId);

  /** A opens the group, B joins, A starts, both vote for `choice` (0 = success). */
  async function playParty(tc: TestContext, missionId: string, choice = 0) {
    await startCmd(tc, missionId, A);
    const lobby = tc.gateway.messages
      .filter((m) => m.msg.embeds?.[0]?.title?.startsWith(`Capítulo ${missionId}`))
      .at(-1);
    const btn = (action: string) =>
      (lobby?.msg.components?.[0] ?? [])
        .map((b) => ('customId' in b ? (b.customId ?? '') : ''))
        .find((c) => c.endsWith(action)) ?? '';
    await tc.interact({ kind: 'component', userId: B, customId: btn('join') });
    await tc.interact({ kind: 'component', userId: A, customId: btn('start') });
    const vote = lastButtons(tc)[choice] ?? '';
    await tc.interact({ kind: 'component', userId: A, customId: vote });
    await tc.interact({ kind: 'component', userId: B, customId: vote });
    await tc.settle();
    return vote;
  }

  it('a party plays a 2-chapter arc; both join, get the role and the thread says so', async () => {
    const { t } = await setup([RECRUIT], ARC);
    await t.runtime.ready({ startPolling: false }); // Cérebro creates the team roles
    const [a, b] = [await hero(t, A), await hero(t, B)];
    await playParty(t, 'rv-1');
    expect((await memberOf(t, A))?.faction).toBe('independent'); // only the last chapter joins
    await playParty(t, 'rv-2');
    for (const userId of [A, B]) {
      expect((await memberOf(t, userId))?.faction).toBe('avengers');
      expect(t.gateway.memberRoleNames(userId)).toContain('Vingadores');
    }
    const requests = await events(t, 'faction.join_requested');
    expect(requests.map((e) => e.memberId).sort()).toEqual([a, b].sort());
    expect(requests.every((e) => /^arc:[^:]+:[^:]+$/.test(e.sourceKey))).toBe(true);
    const changed = await events(t, 'player.faction_changed');
    expect(changed.map((e) => [e.reason, e.from, e.to])).toEqual([
      ['arc', 'independent', 'avengers'],
      ['arc', 'independent', 'avengers'],
    ]);
    const posts = thread(t).filter((c) => c.includes('entrou para'));
    expect(posts.sort()).toEqual([
      `🎉 **Herói ${A}** entrou para **🟡 Vingadores**!`,
      `🎉 **Herói ${B}** entrou para **🟡 Vingadores**!`,
    ]);
  });

  it('a member who switched less than 30 days ago is refused with the date; the other joins', async () => {
    const { t } = await setup([RECRUIT], ARC);
    await hero(t, A);
    const b = await hero(t, B, { faction: 'shield' });
    const changedAt = new Date(t.clock.now().getTime() - 10 * DAY);
    await new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId).updateMember(b, {
      factionChangedAt: changedAt.toISOString(),
    });
    await playParty(t, 'rv-1');
    await playParty(t, 'rv-2');
    expect((await memberOf(t, A))?.faction).toBe('avengers');
    expect((await memberOf(t, B))?.faction).toBe('shield');
    const until = Math.floor((changedAt.getTime() + 30 * DAY) / 1000);
    expect(thread(t)).toContain(
      `**Herói ${B}** cumpriu o arco, mas só pode trocar de equipe a partir de <t:${until}:D>. O capítulo conta como feito.`,
    );
    // The arc still counts as done for the campaign.
    const id = await campanha(t, B, RECRUIT.id);
    expect(JSON.stringify(reply(t, id))).toMatch(/2\/2/);
  });

  it('a replayed ending asks once', async () => {
    const { t } = await setup([RECRUIT], ARC);
    await hero(t, A);
    await hero(t, B);
    await playParty(t, 'rv-1');
    const vote = await playParty(t, 'rv-2');
    await t.interact({ kind: 'component', userId: A, customId: vote }); // stale click on the last scene
    await t.settle();
    expect((await events(t, 'faction.join_requested')).length).toBe(2);
    expect(thread(t).filter((c) => c.includes('entrou para')).length).toBe(2);
  });

  it('a failure ending asks nothing', async () => {
    const { t } = await setup([RECRUIT], ARC);
    await hero(t, A);
    await hero(t, B);
    await playParty(t, 'rv-1');
    await playParty(t, 'rv-2', 1);
    expect(await events(t, 'faction.join_requested')).toEqual([]);
    expect((await memberOf(t, A))?.faction).toBe('independent');
  });

  it('an arc for a team that does not take my origin stays locked and says why', async () => {
    const BRO = campaign({ id: 'recrutamento-irmandade', kind: 'recruitment', faction: 'brotherhood' });
    const { t } = await setup(
      [BRO],
      [
        chapter('ri-1', 1, undefined, {
          campaign: { id: BRO.id, chapter: 1 },
          reward: { joinFaction: 'brotherhood' },
        }),
      ],
    );
    await hero(t, A, { origin: 'tecnologia' });
    await hero(t, B, { origin: 'mutante' });
    expect(await autocomplete(t, A)).not.toContain('ri-1');
    expect(await autocomplete(t, B)).toContain('ri-1');
    const id = await startCmd(t, 'ri-1', A);
    expect(reply(t, id)?.content).toMatch(/Bloqueada: falta ser de origem Mutante, Inumano/);
  });
});

describe('replaying a lost chapter', () => {
  it('a lost campaign chapter can be tried again; a won one cannot; a standalone story stays once only', async () => {
    const { t } = await setup([campaign()], [chapter('sombras-1', 1), mission('avulsa')]);
    await hero(t, A);
    await startCmd(t, 'sombras-1');
    await t.interact({ kind: 'component', userId: A, customId: lastButtons(t)[1] ?? '' }); // failure
    await win(t, 'sombras-1');
    expect(reply(t, await startCmd(t, 'sombras-1'))?.content).toBe('Você já jogou esta história');
    await startCmd(t, 'avulsa');
    await t.interact({ kind: 'component', userId: A, customId: lastButtons(t)[1] ?? '' }); // failure
    expect(reply(t, await startCmd(t, 'avulsa'))?.content).toBe('Você já jogou esta história');
  });
});
