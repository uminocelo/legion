import { ChannelType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { fillChannelIds } from './channel-fill.js';
import type { ApiChannel } from './rest.js';
import { TEAMS } from './server-template.js';

const text = (id: string, name: string, type = ChannelType.GuildText): ApiChannel => ({
  id,
  name,
  type,
});
const category = (id: string, name: string): ApiChannel => ({
  id,
  name,
  type: ChannelType.GuildCategory,
});

const TEMPLATE_CHANNELS: ApiChannel[] = [
  text('1001', 'boas-vindas'),
  text('1002', 'regras'),
  text('1003', 'registro'),
  text('1004', 'eventos'),
  text('1005', 'missoes'),
  text('1006', 'combate'),
  text('1007', 'tutorial'),
  text('1008', 'fila-moderacao'),
  text('1009', 'guia'),
  ...TEAMS.flatMap((t, i) => {
    const n = i + 1;
    return [
      category(`2${n}00`, t.category),
      text(`2${n}01`, `noticias-${t.slug}`),
      text(`2${n}02`, `esquadroes-${t.slug}`),
    ];
  }),
];

describe('fillChannelIds', () => {
  it('fills every template channel name and herbie tips', () => {
    const r = fillChannelIds(TEMPLATE_CHANNELS);
    expect(r.channels).toEqual({
      welcome: '1001',
      rules: '1002',
      registry: '1003',
      events: '1004',
      missions: '1005',
      combat: '1006',
      tutorial: '1007',
      modQueue: '1008',
      trivia: null,
    });
    expect(r.herbieTipsChannelId).toBe('1009');
    expect(r.report.some((l) => l.startsWith('filled  channels.welcome'))).toBe(true);
    expect(r.report.some((l) => l.startsWith('filled  herbie.tips.channelId'))).toBe(true);
    expect(r.channels.trivia).toBeNull();
  });

  it('fills category, news and squad for all 8 teams', () => {
    const r = fillChannelIds(TEMPLATE_CHANNELS);
    for (const [i, t] of TEAMS.entries()) {
      const n = i + 1;
      const key = t.roleKey.slice('faction_'.length);
      const f = r.factions.find((x) => x.key === key);
      expect(f, key).toEqual({
        key,
        roleKey: t.roleKey,
        categoryId: `2${n}00`,
        newsChannelId: `2${n}01`,
        squadChannelId: `2${n}02`,
      });
    }
    expect(r.factions).toHaveLength(9);
  });

  it('never assigns area IDs to independent', () => {
    const r = fillChannelIds(TEMPLATE_CHANNELS, {
      factions: [
        {
          key: 'independent',
          roleKey: 'faction_independent',
          categoryId: '999',
          newsChannelId: '998',
          squadChannelId: '997',
        },
        { key: 'xmen', roleKey: 'faction_xmen' },
      ],
    });
    const ind = r.factions.find((f) => f.key === 'independent');
    expect(ind).toEqual({ key: 'independent', roleKey: 'faction_independent' });
    expect(ind?.categoryId).toBeUndefined();
    expect(ind?.newsChannelId).toBeUndefined();
    expect(ind?.squadChannelId).toBeUndefined();
    expect(r.report.every((l) => !l.includes('factions.independent'))).toBe(true);
  });

  it('leaves trivia null even when a trivia-named channel exists', () => {
    const r = fillChannelIds([...TEMPLATE_CHANNELS, text('777', 'trivia')]);
    expect(r.channels.trivia).toBeNull();
  });

  it.each([
    {
      name: 'missing',
      channels: [] as ApiChannel[],
      path: 'channels.welcome',
      expectId: null as string | null,
      report: 'skipped channels.welcome (missing)',
    },
    {
      name: 'duplicate',
      channels: [text('1', 'boas-vindas'), text('2', 'boas-vindas')],
      path: 'channels.welcome',
      expectId: null,
      report: 'ambiguous channels.welcome (1, 2)',
    },
    {
      name: 'wrong_type',
      channels: [category('1', 'boas-vindas')],
      path: 'channels.welcome',
      expectId: null,
      report: 'skipped channels.welcome (wrong_type)',
    },
    {
      name: 'category wrong_type',
      channels: [text('1', '🔵 X-Men')],
      path: 'factions.xmen.categoryId',
      expectId: null,
      report: 'skipped factions.xmen.categoryId (wrong_type)',
    },
    {
      name: 'text match is case-insensitive',
      channels: [text('55', 'Boas-Vindas')],
      path: 'channels.welcome',
      expectId: '55',
      report: 'filled  channels.welcome ← #boas-vindas (55)',
    },
  ])('$name', ({ channels, path, expectId, report }) => {
    const r = fillChannelIds(channels);
    if (path.startsWith('channels.')) {
      expect(r.channels[path.slice('channels.'.length)]).toBe(expectId);
    } else if (path === 'factions.xmen.categoryId') {
      expect(r.factions.find((f) => f.key === 'xmen')?.categoryId).toBeUndefined();
    }
    expect(r.report).toContain(report);
  });

  it('keeps non-null existing values unless overwrite', () => {
    const existing = {
      channels: { welcome: 'keep-welcome', rules: null as string | null },
      herbieTipsChannelId: 'keep-tips',
      factions: [
        {
          key: 'xmen',
          roleKey: 'faction_xmen',
          categoryId: 'keep-cat',
          newsChannelId: 'keep-news',
          squadChannelId: 'keep-squad',
        },
      ],
    };
    const kept = fillChannelIds(TEMPLATE_CHANNELS, existing);
    expect(kept.channels.welcome).toBe('keep-welcome');
    expect(kept.channels.rules).toBe('1002');
    expect(kept.herbieTipsChannelId).toBe('keep-tips');
    expect(kept.factions.find((f) => f.key === 'xmen')).toMatchObject({
      categoryId: 'keep-cat',
      newsChannelId: 'keep-news',
      squadChannelId: 'keep-squad',
    });
    expect(kept.report).toContain('kept    channels.welcome (already set)');
    expect(kept.report).toContain('kept    herbie.tips.channelId (already set)');
    expect(kept.report).toContain('kept    factions.xmen.categoryId (already set)');

    const over = fillChannelIds(TEMPLATE_CHANNELS, existing, { overwrite: true });
    expect(over.channels.welcome).toBe('1001');
    expect(over.herbieTipsChannelId).toBe('1009');
    expect(over.factions.find((f) => f.key === 'xmen')).toMatchObject({
      categoryId: '2100',
      newsChannelId: '2101',
      squadChannelId: '2102',
    });
    expect(over.report.some((l) => l.startsWith('kept    '))).toBe(false);
  });

  it('keeps existing trivia when set and does not overwrite without flag', () => {
    const kept = fillChannelIds(TEMPLATE_CHANNELS, { channels: { trivia: 'old-trivia' } });
    expect(kept.channels.trivia).toBe('old-trivia');
    expect(kept.report).toContain('kept    channels.trivia (already set)');

    const over = fillChannelIds(
      TEMPLATE_CHANNELS,
      { channels: { trivia: 'old-trivia' } },
      { overwrite: true },
    );
    expect(over.channels.trivia).toBeNull();
  });

  it('matches category names exactly after trim (emoji kept)', () => {
    const r = fillChannelIds([category('9', '  🔵 X-Men  ')]);
    expect(r.factions.find((f) => f.key === 'xmen')?.categoryId).toBe('9');
  });
});
