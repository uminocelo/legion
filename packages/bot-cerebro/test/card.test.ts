import type { TestContext } from '@legion/core';
import { ARCHETYPES, computePlayerStats } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  type CardData,
  cardSvg,
  clean,
  fitHeading,
  renderCard,
} from '../src/card.js';
import { powerIds } from '../src/index.js';
import { FIELDS, join, setupCerebro, USER } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const labels: CardData['labels'] = {
  title: 'CÉREBRO · FICHA DE MUTANTE',
  level: 'Nível',
  powers: 'PODERES',
  stats: { hp: 'VIDA', atk: 'ATQ', def: 'DEF', spd: 'VEL', foc: 'FOCO' },
};
const card = (over: Partial<CardData> = {}): CardData => ({
  codename: 'Faísca Rubra',
  faction: '🛡️ X-Men',
  factionColor: '#3498DB',
  archetype: 'Telepata',
  rank: 'Agente',
  level: 7,
  xp: 1240,
  powers: { main: 'Telecinese', secondary: ['Pirocinese', 'Voo'] },
  description: 'Cria faíscas',
  stats: computePlayerStats('Telepata', 7),
  labels,
  ...over,
});
/** PNG signature, then IHDR width and height. */
const pngSize = (png: Uint8Array) => {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return {
    sig: [...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join(''),
    w: v.getUint32(16),
    h: v.getUint32(20),
  };
};

describe('profile card', () => {
  it('renders a PNG for every archetype quickly and under Discord limits', async () => {
    await renderCard(card()); // warm-up: loads WASM and fonts
    for (const a of ARCHETYPES) {
      const t0 = performance.now();
      const png = await renderCard(card({ archetype: a, stats: computePlayerStats(a, 30), level: 30 }));
      expect(performance.now() - t0).toBeLessThan(1000);
      expect(pngSize(png)).toEqual({ sig: 'PNG', w: CARD_WIDTH, h: CARD_HEIGHT });
      expect(png.byteLength).toBeLessThan(1024 * 1024);
    }
  });

  it('fits long names, escapes markup and drops glyphs the fonts lack', () => {
    const long = fitHeading('Um Nome Muito Comprido Mesmo Para Um Cartao', 600);
    expect(long.size).toBeLessThan(64);
    expect(long.size).toBeGreaterThanOrEqual(34);
    const svg = cardSvg(
      card({
        codename: '<Faísca & "Rubra">',
        powers: { main: 'x'.repeat(60), secondary: [] },
        faction: '🛡️ X-Men',
      }),
    );
    expect(svg).toContain('&lt;Faísca &amp; &quot;Rubra&quot;&gt;');
    expect(svg).toContain('…');
    expect(svg).not.toContain('🛡');
    expect(clean('⚡ Raio ✨')).toBe('Raio');
  });

  it('shows the description when the mutant has no catalog powers and no level when J.A.R.V.I.S. is off', () => {
    const svg = cardSvg(card({ powers: { main: null, secondary: [] }, level: null, xp: null }));
    expect(svg).toContain('Cria faíscas');
    expect(svg).not.toContain('Nível');
  });
});

describe('/perfil with the card', () => {
  async function registered(config: Record<string, unknown> = {}) {
    t = await setupCerebro(config);
    await join(t);
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:start' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:rules' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:faction', values: ['xmen'] });
    await t.interact({
      kind: 'component',
      userId: USER,
      customId: powerIds.main('r', 0),
      values: ['telecinese'],
    });
    await t.interact({ kind: 'modal', userId: USER, customId: 'cerebro:v1:mutant', fields: FIELDS });
    return t;
  }

  it('attaches ficha.png, shows it in the embed and colors it by faction', async () => {
    const tc = await registered();
    const id = await tc.interact({ kind: 'command', userId: USER, commandName: 'perfil' });
    const msg = tc.gateway.lastReply(id);
    expect(msg?.files?.[0]?.name).toBe('ficha.png');
    expect(pngSize(msg?.files?.[0]?.content as Uint8Array).sig).toBe('PNG');
    const embed = msg?.embeds?.[0];
    expect(embed?.image).toEqual({ url: 'attachment://ficha.png' });
    expect(embed?.color).toBe(0x3498db);
    expect({ title: embed?.title, fields: embed?.fields }).toMatchInlineSnapshot(`
      {
        "fields": [
          {
            "inline": true,
            "name": "Arquétipo",
            "value": "Telepata",
          },
          {
            "inline": true,
            "name": "Facção",
            "value": "🔵 X-Men",
          },
          {
            "inline": true,
            "name": "Rank",
            "value": "Recruta",
          },
          {
            "name": "Poderes",
            "value": "★ Telecinese",
          },
          {
            "name": "Descrição do poder",
            "value": "Cria faíscas que cegam",
          },
          {
            "name": "Origem",
            "value": "Acordou no meio de uma tempestade.",
          },
        ],
        "title": "🧬 Faísca Rubra",
      }
    `);
    const button = msg?.components?.[0]?.[0];
    expect(button && 'customId' in button ? button.customId : '').toMatch(/^cerebro:v1:share:/);
    const share = await tc.interact({
      kind: 'component',
      userId: USER,
      customId: button && 'customId' in button ? (button.customId ?? '') : '',
    });
    expect(tc.gateway.lastReply(share)?.content).toMatch(/compartilhada/);
    const posted = tc.gateway.messages.at(-1)?.msg;
    expect(posted?.files?.[0]?.name).toBe('ficha.png');
    expect(posted?.embeds?.[0]?.image).toEqual({ url: 'attachment://ficha.png' });
  });

  it('profileCard: false sends only the embed', async () => {
    const tc = await registered({ cerebro: { profileCard: false } });
    const id = await tc.interact({ kind: 'command', userId: USER, commandName: 'perfil' });
    expect(tc.gateway.lastReply(id)?.files).toBeUndefined();
    expect(tc.gateway.lastReply(id)?.embeds?.[0]?.image).toBeUndefined();
  });
});
