import type { TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { strikeId } from '../src/index.js';
import { addMember, CH, servicesOf, setupUltron } from './helpers.js';

let t: TestContext;
afterEach(async () => t?.close());
const staff = (tc: TestContext, subcommand: string, options: Record<string, string> = {}) =>
  tc.interact({
    kind: 'command',
    userId: '1',
    isGuildOwner: true,
    commandName: 'ultron',
    subcommand,
    options,
  });

describe('commands', () => {
  it('registers /ameaca and /ultron with every subcommand Discord should show', async () => {
    t = await setupUltron();
    const json = t.runtime.router.commandJson() as {
      name: string;
      options?: { name: string; type: number; options?: { name: string }[] }[];
    }[];
    const ultron = json.find((c) => c.name === 'ultron');
    expect(ultron?.options?.map((o) => [o.name, o.type])).toEqual([
      ['spawn', 1],
      ['evento', 2],
      ['status', 1],
      ['inimigo', 2],
      ['guerra', 2],
    ]);
    expect(ultron?.options?.find((o) => o.name === 'guerra')?.options?.map((o) => o.name)).toEqual([
      'iniciar',
      'encerrar',
      'pontos',
    ]);
    expect(ultron?.options?.find((o) => o.name === 'inimigo')?.options?.map((o) => o.name)).toEqual([
      'importar',
      'lista',
      'desativar',
      'ativar',
    ]);
    expect(ultron?.options?.find((o) => o.name === 'evento')?.options?.map((o) => o.name)).toEqual([
      'agendar',
      'iniciar',
      'cancelar',
    ]);
    expect(json.some((c) => c.name === 'ameaca')).toBe(true);
    expect(json.some((c) => c.name === 'guerra')).toBe(true);
    const help = t.runtime.help.list?.() ?? [];
    expect(JSON.stringify(help)).toContain('/ameaca');
  });

  it('/ultron evento agendar validates the date, refuses overlaps and schedules', async () => {
    t = await setupUltron();
    expect(
      t.gateway.lastReply(await staff(t, 'evento agendar', { tipo: 'raid', quando: 'amanhã' }))?.content,
    ).toMatch(/^Não entendi a data/);
    const ok = await staff(t, 'evento agendar', { tipo: 'raid', quando: '2026-11-16 18:30' });
    expect(t.gateway.lastReply(ok)?.content).toMatch(/^Agendado para <t:\d+:F>/);
    const [ev] = await servicesOf(t).eventsRepo.openEvents('raid');
    expect(ev?.startsAt).toBe('2026-11-16T21:30:00.000Z'); // 18:30 in São Paulo
    expect(
      t.gateway.lastReply(await staff(t, 'evento agendar', { tipo: 'raid', quando: '2026-11-16 18:45' }))
        ?.content,
    ).toBe('Já existe um evento desse tipo nesse horário.');
    expect(
      t.gateway.lastReply(await staff(t, 'evento agendar', { tipo: 'raid', quando: '2026-11-01 10:00' }))
        ?.content,
    ).toBe('Esse horário já passou.');
    const no = await t.interact({
      kind: 'command',
      userId: '222',
      commandName: 'ultron',
      subcommand: 'status',
    });
    expect(t.gateway.lastReply(no)?.content).toBe('Apenas a staff pode usar este comando.');
  });

  it('/ultron evento iniciar starts now (still announcing); /ameaca shows HP, damage and cooldown; cancelar stops it', async () => {
    t = await setupUltron();
    await addMember(t, '111');
    const quiet = t.gateway.lastReply(
      await t.interact({ kind: 'command', userId: '111', commandName: 'ameaca' }),
    )?.embeds?.[0];
    expect(quiet?.description).toBe('Nenhuma ameaça no radar. Por enquanto.');
    expect(quiet?.fields?.map((f) => f.name)).toEqual(['Ameaça']);
    const r = await staff(t, 'evento iniciar', { tipo: 'invasion' });
    expect(t.gateway.lastReply(r)?.content).toBe(`Evento iniciado em <#${CH.events}>.`);
    const [ev] = await servicesOf(t).eventsRepo.openEvents('invasion');
    expect(ev?.status).toBe('active');
    expect(t.gateway.messages.filter((m) => m.channelId === CH.events)).toHaveLength(2);
    await t.interact({ kind: 'component', userId: '111', customId: strikeId(ev?.id ?? '') });
    await t.settle();
    const threat = t.gateway.lastReply(
      await t.interact({ kind: 'command', userId: '111', commandName: 'ameaca' }),
    );
    expect(threat?.embeds?.[0]?.title).toBe('☢️ Invasão: Enxame de Nanites');
    expect(threat?.embeds?.[0]?.description).toMatch(
      /Em andamento[\s\S]*█[\s\S]*Seu dano: \d+ em 1 ataque\(s\)\.\nPróximo ataque <t:\d+:R>\./,
    );
    const status = t.gateway.lastReply(await staff(t, 'status'));
    expect(status?.embeds?.[0]?.fields?.map((f) => f.name)).toEqual([
      'Próximos eventos',
      'Últimos resultados',
      'Últimos encontros',
      'Dificuldade adaptativa',
      'Texto de IA',
    ]);
    expect(status?.embeds?.[0]?.fields?.[4]?.value).toBe('desligado (frases fixas)');
    expect(t.gateway.lastReply(await staff(t, 'evento cancelar'))?.content).toBe(
      'Evento cancelado: Invasão: Enxame de Nanites.',
    );
    expect((await servicesOf(t).eventsRepo.event(ev?.id ?? ''))?.status).toBe('cancelled');
    expect(t.gateway.lastReply(await staff(t, 'evento cancelar'))?.content).toBe(
      'Não há evento agendado ou em andamento.',
    );
  });
});
