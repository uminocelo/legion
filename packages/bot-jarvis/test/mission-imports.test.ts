import { readFileSync } from 'node:fs';
import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { JARVIS_CONTENT_DIR, missionImportIds } from '../src/index.js';
import { addMember, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const STAFF = '900';
const CDN = 'https://cdn.discordapp.com/attachments/1/2/';
const shipped = readFileSync(`${JARVIS_CONTENT_DIR}/missions/patrulha-noturna.yaml`, 'utf8');
const shangChi = shipped
  .replace('id: patrulha-noturna', 'id: shang-chi-4')
  .replace('pt-BR: Patrulha noturna', 'pt-BR: Os Cinco Anéis');

function upload(tc: TestContext, text: string, name = 'missao.yaml', size = Buffer.byteLength(text)) {
  const url = `${CDN}${name}`;
  tc.gateway.cdn.set(url, text);
  return { url, name, size, contentType: 'text/yaml' };
}
const importCmd = (tc: TestContext, att: ReturnType<typeof upload> | undefined, userId = STAFF) =>
  tc.interact({
    kind: 'command',
    userId,
    isGuildOwner: userId === STAFF,
    commandName: 'jarvis',
    subcommand: 'missao importar',
    ...(att ? { attachments: { arquivo: att } } : {}),
  });
const reply = (tc: TestContext, id: string) => tc.gateway.lastReply(id);
const MISSIONS_CH = '300000000000000009';
async function setup() {
  const tc = await setupJarvis({ channels: { missions: MISSIONS_CH } });
  tc.gateway.addChannel({ id: MISSIONS_CH, name: 'missoes', kind: 'text', parentId: null, overwrites: [] });
  return tc;
}
const buttons = (tc: TestContext, id: string) =>
  (reply(tc, id)?.components?.[0] ?? []).map((b) => ('customId' in b ? (b.customId ?? '') : ''));
const click = (tc: TestContext, customId: string, userId = STAFF) =>
  tc.interact({ kind: 'component', userId, isGuildOwner: userId === STAFF, customId });

describe('mission imports', () => {
  it('validates, previews and publishes a mission that plays at once', async () => {
    t = await setup();
    const s = servicesOf(t);
    const id = await importCmd(t, upload(t, shangChi));
    const preview = reply(t, id)?.embeds?.[0];
    expect(preview?.title).toBe('Prévia: Os Cinco Anéis');
    expect(preview?.description).toMatch(/`shang-chi-4` · Diária · nível 1\+/);
    expect(await s.repo.mission('shang-chi-4')).toBeNull();
    const [publish] = buttons(t, id);
    const done = await click(t, publish ?? '');
    expect(reply(t, done)?.content).toMatch(/Missão `shang-chi-4` publicada/);
    expect(await s.repo.mission('shang-chi-4')).toMatchObject({
      active: 1,
      origin: 'staff',
      importedBy: STAFF,
    });

    await addMember(t, '111');
    const play = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'missao',
      subcommand: 'iniciar',
      options: { missao: 'shang-chi-4' },
    });
    expect(reply(t, play)?.content).toMatch(/Missão iniciada em <#\d+>/);

    const again = await click(t, publish ?? '');
    expect(reply(t, again)?.content).toMatch(/expirou ou já foi usada/);
  });

  it('reports schema and graph errors and changes nothing', async () => {
    t = await setup();
    const broken = shangChi.replace('next: conteiner', 'next: nowhere');
    const id = await importCmd(t, upload(t, broken));
    expect(reply(t, id)?.content).toMatch(/O arquivo tem erros e nada mudou/);
    expect(reply(t, id)?.content).toMatch(/nowhere/);
    const yaml = await importCmd(t, upload(t, 'id: [x', 'ruim.yaml'));
    expect(reply(t, yaml)?.content).toMatch(/YAML inválido \(linha \d+\)/);
    const canon = await importCmd(
      t,
      upload(t, shangChi.replace('pt-BR: Os Cinco Anéis', 'pt-BR: Wolverine'), 'canon.yaml'),
    );
    expect(reply(t, canon)?.content).toMatch(/title\.pt-BR: nome de personagem existente/);
    expect(await servicesOf(t).repo.mission('shang-chi-4')).toBeNull();
  });

  it('refuses wrong files, big files, other hosts and non-staff', async () => {
    t = await setup();
    const txt = await importCmd(t, upload(t, shangChi, 'missao.txt'));
    expect(reply(t, txt)?.content).toMatch(/\.yaml ou \.yml/);
    const big = await importCmd(t, upload(t, shangChi, 'big.yaml', 200_000));
    expect(reply(t, big)?.content).toMatch(/passa de 64 KB/);
    const host = await importCmd(t, {
      url: 'https://example.com/m.yaml',
      name: 'm.yaml',
      size: 10,
      contentType: null,
    });
    expect(reply(t, host)?.content).toMatch(/enviados pelo próprio Discord/);
    expect(t.gateway.callsOf('fetchAttachment')).toHaveLength(0);
    await addMember(t, '111');
    const no = await importCmd(t, upload(t, shangChi), '111');
    expect(reply(t, no)?.content).toMatch(/Apenas a staff/);
    const fake = await click(t, missionImportIds.decide('x', 'publish'), '111');
    expect(reply(t, fake)?.content).toMatch(/Apenas a staff/);
  });

  it('cancel changes nothing; replacing a file mission warns and wins over reloads', async () => {
    t = await setup();
    const s = servicesOf(t);
    const first = await importCmd(t, upload(t, shangChi));
    await click(t, buttons(t, first)[1] ?? '');
    expect(await s.repo.mission('shang-chi-4')).toBeNull();

    const override = shipped.replace('pt-BR: Patrulha noturna', 'pt-BR: Patrulha da staff');
    const id = await importCmd(t, upload(t, override, 'override.yaml'));
    expect(reply(t, id)?.embeds?.[0]?.description).toMatch(/Substitui a missão `patrulha-noturna`/);
    await click(t, buttons(t, id)[0] ?? '');
    const res = await s.missions.reload();
    expect(res.errors).toEqual([]);
    const row = await s.repo.mission('patrulha-noturna');
    expect(row).toMatchObject({ origin: 'staff', active: 1 });
    expect(row?.definition).toMatch(/Patrulha da staff/);
  });

  it('lists origins; disable hides a mission at once and survives reloads', async () => {
    t = await setup();
    const s = servicesOf(t);
    const id = await importCmd(t, upload(t, shangChi));
    await click(t, buttons(t, id)[0] ?? '');
    const list = await t.interact({
      kind: 'command',
      userId: STAFF,
      isGuildOwner: true,
      commandName: 'jarvis',
      subcommand: 'missao lista',
    });
    const desc = reply(t, list)?.embeds?.[0]?.description ?? '';
    expect(desc).toMatch(/✅ `shang-chi-4` · Os Cinco Anéis · Diária · <@900>/);
    expect(desc).toMatch(/`patrulha-noturna` .* arquivo/);

    const off = (missao: string, sub = 'missao desativar') =>
      t?.interact({
        kind: 'command',
        userId: STAFF,
        isGuildOwner: true,
        commandName: 'jarvis',
        subcommand: sub,
        options: { missao },
      });
    await off('patrulha-noturna');
    await s.missions.reload();
    expect(await s.repo.mission('patrulha-noturna')).toMatchObject({ active: 0, disabledBy: STAFF });
    await addMember(t, '111');
    const play = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'missao',
      subcommand: 'iniciar',
      options: { missao: 'patrulha-noturna' },
    });
    expect(reply(t, play)?.content).toMatch(/Não encontrei essa missão/);
    await off('patrulha-noturna', 'missao ativar');
    await s.missions.reload();
    expect(await s.repo.mission('patrulha-noturna')).toMatchObject({ active: 1, disabledBy: null });
  });
});
