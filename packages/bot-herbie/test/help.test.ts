import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { HERBIE_LOCALES_DIR, herbie, nextTip, searchGlossary } from '../src/index.js';
import { addMember, CH, emit, playerCreated, servicesOf, setupHerbie } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
const ajuda = (tc: TestContext, userId: string, extra: Record<string, unknown> = {}) =>
  tc.interact({ kind: 'command', userId, commandName: 'ajuda', ...extra });

describe('/ajuda', () => {
  it('unregistered: how to register; staff entries hidden; disabled bots hidden', async () => {
    t = await setupHerbie({ jarvis: false });
    t.gateway.addMember({ userId: '222' });
    const e = t.gateway.lastReply(await ajuda(t, '222'))?.embeds?.[0];
    expect(e?.description).toContain(`registre seu mutante no canal <#${CH.welcome}>`);
    const all = JSON.stringify(e?.fields);
    expect(all).toContain('/ajuda');
    expect(all).not.toContain('/herbie');
    expect(all).not.toContain('/trivia');
    expect(all).not.toContain('/cerebro`'); // staff command of Cérebro is admin-only
  });

  it('mid-tutorial shows the current step; done shows suggestions; staff sees admin entries', async () => {
    t = await setupHerbie();
    const m = await playerCreated(t, '111');
    expect(t.gateway.lastReply(await ajuda(t, '111'))?.embeds?.[0]?.description).toContain(
      '**Agora:** Conheça seu mutante',
    );
    await servicesOf(t).repo.updateProgress(m, { status: 'completed' });
    const d = t.gateway.lastReply(await ajuda(t, '111'))?.embeds?.[0]?.description ?? '';
    expect(d).toContain('Faça sua /trivia diária.');
    const staff = t.gateway.lastReply(await ajuda(t, '111', { isGuildOwner: true }))?.embeds?.[0];
    expect(JSON.stringify(staff?.fields)).toContain('/herbie');
    expect(staff?.fields?.map((f) => f.name)).toEqual(
      expect.arrayContaining(['Cérebro', 'J.A.R.V.I.S.', 'H.E.R.B.I.E.']),
    );
  });

  it('topico shows a glossary entry or a command', async () => {
    t = await setupHerbie();
    t.gateway.addMember({ userId: '222' });
    expect(
      t.gateway.lastReply(await ajuda(t, '222', { options: { topico: 'sequencia' } }))?.embeds?.[0]?.title,
    ).toBe('📖 Sequência');
    expect(
      t.gateway.lastReply(await ajuda(t, '222', { options: { topico: '/trivia' } }))?.embeds?.[0]?.title,
    ).toBe('/trivia');
  });
});

describe('/regras and the glossary', () => {
  it('autocomplete is accent-insensitive, uses aliases and returns at most 25', async () => {
    t = await setupHerbie();
    const entries = servicesOf(t).help.entries('pt-BR');
    expect(searchGlossary(entries, 'NIVEL').map((e) => e.id)).toEqual(['nivel']);
    expect(searchGlossary(entries, 'streak').map((e) => e.id)).toEqual(['sequencia']);
    expect(searchGlossary(entries, 'faccao')[0]?.id).toBe('faccoes');
    const many = Array.from({ length: 40 }, (_, n) => ({ id: `t${n}`, term: `Termo ${n}`, aliases: [] }));
    expect(searchGlossary(many, 'termo')).toHaveLength(25);
    const id = await t.interact({
      kind: 'autocomplete',
      userId: '111',
      commandName: 'regras',
      focused: { name: 'termo', value: 'seq' },
    });
    expect(t.gateway.callsOf('respondAutocomplete').find((c) => c[0] === id)?.[1]).toEqual([
      { name: 'Sequência', value: 'sequencia' },
    ]);
  });

  it('hides terms of disabled bots and shows the rules summary without a term', async () => {
    t = await setupHerbie({ config: { channels: { welcome: CH.welcome, rules: '300000000000000002' } } });
    const ids = servicesOf(t)
      .help.entries('pt-BR')
      .map((e) => e.id);
    expect(ids).toContain('xp');
    expect(ids).not.toContain('combate');
    t.gateway.addMember({ userId: '222' });
    const r = t.gateway.lastReply(
      await t.interact({ kind: 'command', userId: '222', commandName: 'regras' }),
    );
    expect(r?.embeds?.[0]?.description).toContain('Leia as regras completas em <#300000000000000002>.');
    const page = await t.interact({ kind: 'component', userId: '222', customId: 'herbie:v1:glossary:1' });
    expect(t.gateway.lastReply(page)?.embeds?.[0]?.title).toBe('📖 Glossário (2/2)');
  });

  it('ships the required entries in both languages with the same ids', () => {
    const read = (l: string) =>
      readFileSync(join(HERBIE_LOCALES_DIR, `../content/glossary.${l}.yaml`), 'utf8');
    const ids = (txt: string) => [...txt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
    const pt = ids(read('pt-BR'));
    expect(ids(read('en'))).toEqual(pt);
    for (const id of [
      'faccoes',
      'arquetipos',
      'codinome',
      'mutante-original',
      'xp',
      'nivel',
      'rank',
      'sequencia',
      'trivia',
      'cooldown',
      'tutorial',
      'combate',
      'poder',
      'defesa',
      'velocidade',
      'foco',
      'evento-mundial',
      'raid',
      'denuncia',
    ])
      expect(pt).toContain(id);
  });

  it('an invalid server glossary keeps the previous one and reports readable errors', async () => {
    t = await setupHerbie();
    const dir = mkdtempSync(join(tmpdir(), 'herbie-g-'));
    writeFileSync(join(dir, 'glossary.pt-BR.yaml'), '- id: um\n  term: Um\n  summary: s\n  details: d\n');
    expect(servicesOf(t).help.reload(dir)).toEqual([]);
    expect(
      servicesOf(t)
        .help.entries('pt-BR')
        .map((e) => e.id),
    ).toEqual(['um']);
    writeFileSync(join(dir, 'glossary.pt-BR.yaml'), '- id: um\n  term: Um\n');
    const errors = servicesOf(t).help.reload(dir);
    expect(errors).toContain(
      'content/glossary.pt-BR.yaml → 0.summary: Invalid input: expected string, received undefined'.replace(
        'content/',
        `${dir.split('/').pop()}/`,
      ),
    );
    expect(
      servicesOf(t)
        .help.entries('pt-BR')
        .map((e) => e.id),
    ).toEqual(['um']);
  });
});

describe('/idioma and the LocaleResolver', () => {
  it('a member with en gets English ephemeral replies from another bot; public messages keep pt-BR', async () => {
    t = await setupHerbie();
    await addMember(t, '111');
    const saved = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'idioma',
      options: { idioma: 'en' },
    });
    expect(t.gateway.lastReply(saved)?.content).toBe("Done! I'll answer you in English. 🇬🇧");
    const seq = await t.interact({ kind: 'command', userId: '111', commandName: 'sequencia' });
    expect(t.gateway.lastReply(seq)?.embeds?.[0]?.title).toBe('🔥 Your streak');
    expect(await t.runtime.i18n.localeFor('999')).toBe('pt-BR');
  });
});

describe('tips', () => {
  it('rotates without repeats and starts a new cycle', () => {
    const tips = [{ id: 'a' }, { id: 'b' }];
    expect(nextTip(tips, [])).toEqual({ tip: { id: 'a' }, cycle: 1 });
    expect(nextTip(tips, [{ tipId: 'a', cycle: 1 }])?.tip.id).toBe('b');
    expect(
      nextTip(tips, [
        { tipId: 'a', cycle: 1 },
        { tipId: 'b', cycle: 1 },
      ]),
    ).toEqual({ tip: { id: 'a' }, cycle: 2 });
  });

  it('are off by default; when on, the job posts once per run and dedupes across restarts', async () => {
    t = await setupHerbie();
    await t.runtime.ready({ startPolling: false });
    expect(await t.runtime.scheduler.tick()).toBe(0);
    await t.close();
    t = await setupHerbie({
      config: { herbie: { tips: { enabled: true, channelId: '300000000000000007' } } },
    });
    await t.runtime.ready({ startPolling: false });
    await t.runtime.scheduler.ensureRecurring(); // a second boot
    t.clock.advance(24 * 3600_000);
    await t.settle();
    const posts = t.gateway.callsOf('sendMessage').filter((c) => c[0] === '300000000000000007');
    expect(posts).toHaveLength(1);
    const staff = await t.interact({
      kind: 'command',
      userId: '1',
      isGuildOwner: true,
      commandName: 'herbie',
      subcommand: 'dica-agora',
    });
    expect(t.gateway.lastReply(staff)?.content).toMatch(/^Dica `\S+` postada\.$/);
    const log = (await servicesOf(t).repo.tipLog()).map((x) => x.tipId);
    expect(new Set(log).size).toBe(log.length);
  });
});

describe('world events', () => {
  it('explains an announced event once in the events channel', async () => {
    t = await setupHerbie({ config: { channels: { welcome: CH.welcome, events: CH.events } } });
    const p = {
      worldEventId: 'w1',
      kind: 'invasion' as const,
      phase: 'announced' as const,
      title: 'Sentinelas',
      startsAt: '2026-11-17T12:00:00.000Z',
      endsAt: null,
      outcome: null,
      participantMemberIds: [],
    };
    await emit(t, 'world.event', p, 'core');
    await emit(t, 'world.event', p, 'core');
    await emit(t, 'world.event', { ...p, phase: 'started' }, 'core');
    const posts = t.gateway.callsOf('sendMessage').filter((c) => c[0] === CH.events);
    expect(posts).toHaveLength(1);
    expect((posts[0]?.[1] as { embeds: { title: string }[] }).embeds[0]?.title).toBe(
      '🤖 O que é uma invasão? (Sentinelas)',
    );
  });
});

describe('staff, doctor, locales and own app', () => {
  it('/herbie status shows the funnel', async () => {
    t = await setupHerbie();
    await playerCreated(t, '111');
    const id = await t.interact({
      kind: 'command',
      userId: '1',
      isGuildOwner: true,
      commandName: 'herbie',
      subcommand: 'status',
    });
    const f = t.gateway.lastReply(id)?.embeds?.[0]?.fields ?? [];
    expect(f.find((x) => x.name === 'Começaram')?.value).toBe('1');
    expect(f.find((x) => x.name === 'Dicas')?.value).toBe('desligadas');
    const no = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'herbie',
      subcommand: 'status',
    });
    expect(t.gateway.lastReply(no)?.content).toBe('Apenas a staff pode usar este comando.');
  });

  it('doctor warns without a fallback channel and fails for a missing tips channel', async () => {
    t = await setupHerbie({
      config: {
        channels: { welcome: null },
        herbie: { tips: { enabled: true, channelId: '300000000000000077' } },
      },
    });
    const check = herbie.doctorChecks?.(t.ctxOf(herbie))[0];
    const res = await check?.run();
    expect(res?.status).toBe('fail');
    expect(res?.message).toContain('herbie.tips.channelId: canal 300000000000000077 não encontrado');
    expect(herbie.doctorChannels?.(t.ctxOf(herbie).botConfig)).toEqual([
      { key: 'herbie.tips.channelId', id: '300000000000000077' },
    ]);
  });

  it('pt-BR and en locales have the same keys and placeholders', () => {
    const flat = (o: Record<string, unknown>, p = ''): Record<string, string> =>
      Object.entries(o).reduce(
        (acc, [k, v]) =>
          Object.assign(
            acc,
            typeof v === 'object' && v
              ? flat(v as Record<string, unknown>, `${p}${k}.`)
              : { [`${p}${k}`]: String(v) },
          ),
        {} as Record<string, string>,
      );
    const pt = flat(JSON.parse(readFileSync(join(HERBIE_LOCALES_DIR, 'pt-BR.json'), 'utf8')));
    const en = flat(JSON.parse(readFileSync(join(HERBIE_LOCALES_DIR, 'en.json'), 'utf8')));
    expect(Object.keys(en).sort()).toEqual(Object.keys(pt).sort());
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(pt)) expect([k, vars(en[k] ?? '')]).toEqual([k, vars(pt[k] ?? '')]);
  });

  it('works as its own Discord app: intro DM and /ajuda go through the H.E.R.B.I.E. app', async () => {
    t = await setupHerbie({ apps: [{ key: 'herbie', bots: ['herbie'] }] });
    const hg = t.appGateways.get('herbie');
    if (!hg) throw new Error('no herbie app');
    await playerCreated(t, '111');
    expect(hg.callsOf('sendDm')).toHaveLength(1);
    expect(t.gateway.callsOf('sendDm')).toHaveLength(0);
    const id = await t.interact({ kind: 'command', userId: '111', commandName: 'ajuda' }, 'herbie');
    expect(hg.lastReply(id)?.embeds?.[0]?.title).toBe('🤖 Ajuda do H.E.R.B.I.E.');
  });
});
