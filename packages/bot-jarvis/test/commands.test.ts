import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { periodStart } from '../src/index.js';
import { JARVIS_LOCALES_DIR } from '../src/paths.js';
import { addMember, award, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

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

describe('locales', () => {
  it('pt-BR and en have the same keys and placeholders', () => {
    const pt = flat(JSON.parse(readFileSync(join(JARVIS_LOCALES_DIR, 'pt-BR.json'), 'utf8')));
    const en = flat(JSON.parse(readFileSync(join(JARVIS_LOCALES_DIR, 'en.json'), 'utf8')));
    expect(Object.keys(en).sort()).toEqual(Object.keys(pt).sort());
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(pt)) expect([k, vars(en[k] ?? '')]).toEqual([k, vars(pt[k] ?? '')]);
  });
});

describe('periods', () => {
  it('week starts on Monday, month on the 1st', () => {
    expect(periodStart('semana', '2026-11-16')).toBe('2026-11-16'); // Monday
    expect(periodStart('semana', '2026-11-22')).toBe('2026-11-16'); // Sunday
    expect(periodStart('mes', '2026-11-22')).toBe('2026-11-01');
    expect(periodStart('total', '2026-11-22')).toBeNull();
  });
});

describe('/ranking', () => {
  it('shows top members with the caller position, hides members who left, and has a channel cooldown', async () => {
    t = await setupJarvis();
    const a = await addMember(t, '111', 'xmen', 'Tempestade');
    const b = await addMember(t, '222', 'brotherhood', 'Mística');
    const c = await addMember(t, '333', 'xmen', 'Gambit');
    await award(t, a, 100, 'k1');
    await award(t, b, 300, 'k2');
    await award(t, c, 50, 'k3');
    const s = servicesOf(t);
    const { CerebroRepo } = await import('@legion/bot-cerebro');
    await new CerebroRepo(t.db, t.gateway.guildId, t.clock, t.runtime.newId).updateMember(c, {
      leftAt: t.clock.now().toISOString(),
    });
    const id = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'ranking',
      options: { periodo: 'total' },
    });
    const desc = t.gateway.lastReply(id)?.embeds?.[0]?.description ?? '';
    expect(desc.indexOf('Mística')).toBeLessThan(desc.indexOf('Tempestade'));
    expect(desc).not.toContain('Gambit');
    expect(desc).toContain('Você: **2º** com 105 XP');
    const again = await t.interact({ kind: 'command', userId: '222', commandName: 'ranking' });
    expect(t.gateway.lastReply(again)?.content).toMatch(/^O ranking acabou de ser mostrado aqui/);
    expect((await s.board.rows('total', 'xmen')).map((r) => r.codename)).toEqual(['Tempestade']);
  });
});

describe('/sequencia and /perfil', () => {
  it('shows the streak and adds level/XP/streak to the profile', async () => {
    t = await setupJarvis();
    const m = await addMember(t, '111', 'xmen', 'Tempestade');
    await award(t, m, 60, 'k1');
    const id = await t.interact({ kind: 'command', userId: '111', commandName: 'sequencia' });
    const e = t.gateway.lastReply(id)?.embeds?.[0];
    expect(e?.fields?.[0]?.value).toBe('1 dia(s)');
    expect(e?.description).toContain('✅ Hoje já conta para a sequência.');
    expect(e?.description).toContain('Bônus de amanhã: +10 XP');
    const fields = await t.runtime.profile.render({ memberId: m, discordUserId: '111' }, 'pt-BR');
    expect(fields.map((f) => f.name)).toEqual(['Nível', 'XP', 'Sequência']);
    expect(fields[0]?.value).toBe('2');
  });
});

describe('/jarvis staff', () => {
  it('refuses non-staff and lets staff adjust XP, reload and recalculate', async () => {
    t = await setupJarvis();
    const m = await addMember(t, '111');
    const no = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'jarvis',
      subcommand: 'xp',
      options: { membro: '111', quantidade: 50, motivo: 'x' },
    });
    expect(t.gateway.lastReply(no)?.content).toBe('Apenas a staff pode usar este comando.');
    const staff = { userId: '999', isGuildOwner: true };
    t.gateway.addMember({ userId: '999' });
    const ok = await t.interact({
      kind: 'command',
      ...staff,
      commandName: 'jarvis',
      subcommand: 'xp',
      options: { membro: '111', quantidade: 50, motivo: 'evento' },
    });
    expect(t.gateway.lastReply(ok)?.content).toContain(
      'XP ajustado: +50 para <@111> (motivo: evento). Total: 50 XP',
    );
    const bad = await t.interact({
      kind: 'command',
      ...staff,
      commandName: 'jarvis',
      subcommand: 'xp',
      options: { membro: '111', quantidade: 0, motivo: 'x' },
    });
    expect(t.gateway.lastReply(bad)?.content).toBe(
      'A quantidade deve estar entre -1000 e 1000 e não pode ser 0.',
    );
    const rl = await t.interact({
      kind: 'command',
      ...staff,
      commandName: 'jarvis',
      subcommand: 'trivia recarregar',
    });
    expect(t.gateway.lastReply(rl)?.content).toBe(
      'Perguntas recarregadas: 0 novas, 0 atualizadas, 0 desativadas, 118 iguais.',
    );
    const st = await t.interact({
      kind: 'command',
      ...staff,
      commandName: 'jarvis',
      subcommand: 'trivia estatisticas',
    });
    expect(t.gateway.lastReply(st)?.embeds?.[0]?.fields?.[0]?.value).toBe(
      'Quadrinhos: 10\nMarvel Rivals: 10\nGeral: 10\nVingadores: 22\nQuarteto Fantástico: 22\nCósmico: 22\nMístico: 22',
    );
    await servicesOf(t).repo.updateProgress(m, { xp: 9999 });
    const rc = await t.interact({
      kind: 'command',
      ...staff,
      commandName: 'jarvis',
      subcommand: 'recalcular',
      options: { membro: '111' },
    });
    expect(t.gateway.lastReply(rc)?.content).toContain('9999 → 50 XP');
  });
});
