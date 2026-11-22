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
import { CerebroFlow, cerebro, cosmeticsOf, powerIds } from '../src/index.js';
import { FIELDS, join, setupCerebro, USER } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const labels: CardData['labels'] = {
  title: 'CÉREBRO · FICHA DE HERÓI',
  level: 'Nível',
  powers: 'PODERES',
  stats: { hp: 'VIDA', atk: 'ATQ', def: 'DEF', spd: 'VEL', foc: 'FOCO' },
};
const card = (over: Partial<CardData> = {}): CardData => ({
  codename: 'Faísca Rubra',
  origin: 'Tecnologia',
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

  it('shows the origin before faction and archetype', () => {
    expect(cardSvg(card())).toContain('Tecnologia · X-Men · Telepata');
  });

  it('shows the description when the mutant has no catalog powers and no level when J.A.R.V.I.S. is off', () => {
    const svg = cardSvg(card({ powers: { main: null, secondary: [] }, level: null, xp: null }));
    expect(svg).toContain('Cria faíscas');
    expect(svg).not.toContain('Nível');
  });
});

describe('gear line on the card (v0.10)', () => {
  it('draws equipped items; without gear the SVG is the same as v0.8.1', () => {
    const plain = cardSvg(card());
    expect(cardSvg(card({ gear: [] }))).toBe(plain);
    expect(plain).not.toContain('EQUIPAMENTO');
    const geared = cardSvg(
      card({ gear: ['Traje tático', 'Visor de mira'], labels: { ...labels, gear: 'EQUIPAMENTO' } }),
    );
    expect(geared).toContain('>EQUIPAMENTO</text>');
    expect(geared).toContain('Traje tático · Visor de mira');
  });
});

describe('supporter cosmetics on the card (US-24)', () => {
  it('draws frame and title when set; missing pick keeps the bare card', () => {
    const bare = cardSvg(card());
    expect(bare).not.toContain('data-cosmetic="frame"');
    expect(bare).not.toContain('data-cosmetic="title"');
    expect(cardSvg(card({ cosmetics: null }))).toBe(bare);
    expect(cardSvg(card({ cosmetics: {} }))).toBe(bare);

    const framed = cardSvg(card({ cosmetics: { frameStroke: '#A78BFA', frameAccent: '#C4B5FD' } }));
    expect(framed).toContain('data-cosmetic="frame"');
    expect(framed).toContain('#A78BFA');
    expect(framed).not.toBe(bare);

    const titled = cardSvg(
      card({
        cosmetics: { titleLabel: 'Patrono', titleFill: '#FDE68A', titleAccent: '#FBBF24' },
      }),
    );
    expect(titled).toContain('data-cosmetic="title"');
    expect(titled).toContain('Patrono');
    expect(titled).not.toBe(bare);

    const both = cardSvg(
      card({
        cosmetics: {
          frameStroke: '#F97316',
          titleLabel: 'Sentinela',
          titleFill: '#E2E8F0',
        },
      }),
    );
    expect(both).toContain('data-cosmetic="frame"');
    expect(both).toContain('Sentinela');
  });

  it('renders a PNG with cosmetics under Discord limits', async () => {
    const png = await renderCard(
      card({
        cosmetics: {
          frameStroke: '#A78BFA',
          frameAccent: '#C4B5FD',
          titleLabel: 'Lenda Viva',
          titleFill: '#F9A8D4',
          titleAccent: '#EC4899',
        },
      }),
    );
    expect(pngSize(png)).toEqual({ sig: 'PNG', w: CARD_WIDTH, h: CARD_HEIGHT });
    expect(png.byteLength).toBeLessThan(1024 * 1024);
  });
});

describe('/perfil with the card', () => {
  async function registered(config: Record<string, unknown> = {}) {
    t = await setupCerebro(config);
    await join(t);
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:start' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:rules' });
    await t.interact({ kind: 'component', userId: USER, customId: 'cerebro:v1:origin', values: ['mutante'] });
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
    expect(embed?.color).toBe(0x2ecc71); // new heroes start Independente
    expect({ title: embed?.title, fields: embed?.fields }).toMatchInlineSnapshot(`
      {
        "fields": [
          {
            "inline": true,
            "name": "Origem",
            "value": "🧬 Mutante",
          },
          {
            "inline": true,
            "name": "Arquétipo",
            "value": "Telepata",
          },
          {
            "inline": true,
            "name": "Facção",
            "value": "🟢 Independente",
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
            "name": "História",
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

  it('draws cosmetics with the supporter role and clears them when the role is gone', async () => {
    const tc = await registered();
    const flow = new CerebroFlow(tc.ctxOf(cerebro));
    const member = await flow.repo.memberByDiscordId(USER);
    const mutant = member && (await flow.repo.mutantByMemberId(member.id));
    if (!member || !mutant) throw new Error('not registered');

    await flow.repo.setCosmetics(member.id, { frameId: 'frame-aurora', titleId: 'title-patron' });
    const supporter = tc.gateway.roleByName('Apoiador');
    if (!supporter) throw new Error('missing Apoiador role');
    await tc.gateway.addMemberRole(USER, supporter.id);

    const withRole = await flow.repo.memberById(member.id);
    if (!withRole) throw new Error('member missing after setCosmetics');
    const drawn = await flow.sheet.data(withRole, mutant);
    expect(drawn.cosmetics?.frameStroke).toBe('#A78BFA');
    expect(drawn.cosmetics?.titleLabel).toBe('Patrono');
    const svg = cardSvg(drawn);
    expect(svg).toContain('data-cosmetic="frame"');
    expect(svg).toContain('Patrono');

    await tc.gateway.removeMemberRole(USER, supporter.id);
    const afterStrip = await flow.sheet.data(withRole, mutant);
    expect(afterStrip.cosmetics).toBeNull();
    expect(cardSvg(afterStrip)).not.toContain('data-cosmetic="frame"');
    expect(cardSvg(afterStrip)).not.toContain('Patrono');

    const stored = await flow.repo.memberById(member.id);
    if (!stored) throw new Error('member missing after strip');
    expect(cosmeticsOf(stored)).toEqual({ frameId: null, titleId: null });

    // Next render stays clean even if we pass a stale row with old ids.
    const stale = { ...withRole, frameId: 'frame-aurora', titleId: 'title-patron' };
    const again = await flow.sheet.data(stale, mutant);
    expect(again.cosmetics).toBeNull();
  });
});
