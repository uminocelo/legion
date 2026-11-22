import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Stats } from '@legion/core';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

/** Supporter cosmetics drawn on the card (US-24). Absent/null = bare card. */
export interface CardCosmetics {
  /** Frame border stroke (`#RRGGBB`). */
  frameStroke?: string | null;
  /** Frame corner accent (`#RRGGBB`). */
  frameAccent?: string | null;
  /** Localized title text under the sheet header. */
  titleLabel?: string | null;
  /** Title text fill (`#RRGGBB`). */
  titleFill?: string | null;
  /** Title underline accent (`#RRGGBB`). */
  titleAccent?: string | null;
}

/** Everything printed on the card, already localized. */
export interface CardData {
  codename: string;
  /** Origin name ("Tecnologia"); plain text, the card fonts have no emoji. */
  origin: string;
  faction: string;
  factionColor: string | null;
  archetype: string;
  rank: string;
  level: number | null;
  xp: number | null;
  powers: { main: string | null; secondary: string[] };
  description: string;
  stats: Stats;
  /** Equipped item names (v0.10); empty or missing = no gear line, as in v0.8.1. */
  gear?: string[];
  /** Supporter frame/title; missing keeps the bare card look. */
  cosmetics?: CardCosmetics | null;
  labels: {
    title: string;
    level: string;
    powers: string;
    gear?: string;
    stats: Record<keyof Stats, string>;
  };
}

export const CARD_WIDTH = 960;
export const CARD_HEIGHT = 540;
const FONT_DIR = fileURLToPath(new URL('../assets/fonts/', import.meta.url));
const FONTS = ['Oswald-SemiBold.ttf', 'NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'];

let ready: Promise<Uint8Array[]> | undefined;
/** Loads the WASM renderer and the bundled fonts once per process. */
function setup(): Promise<Uint8Array[]> {
  ready ??= (async () => {
    const wasm = readFileSync(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm'));
    await initWasm(wasm);
    return FONTS.map((f) => new Uint8Array(readFileSync(`${FONT_DIR}${f}`)));
  })();
  return ready;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c,
  );
/** Rough text width for these fonts: average glyph ≈ 0.56 em (0.5 for the condensed Oswald). */
const fits = (text: string, size: number, max: number, em = 0.56) => [...text].length * size * em <= max;
export function clipText(text: string, size: number, max: number, em = 0.56): string {
  const chars = [...text];
  if (fits(text, size, max, em)) return text;
  const keep = Math.max(1, Math.floor(max / (size * em)) - 1);
  return `${chars.slice(0, keep).join('').trimEnd()}…`;
}
/** Shrinks a heading until it fits, down to `min`, then clips it. */
export function fitHeading(text: string, max: number, start = 64, min = 34): { text: string; size: number } {
  let size = start;
  while (size > min && !fits(text, size, max, 0.5)) size -= 2;
  return { text: clipText(text, size, max, 0.5), size };
}
/** The bundled fonts have no emoji or symbol glyphs: drop them instead of printing empty boxes. */
export const clean = (s: string) =>
  s
    .replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|\u{20E3}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
const isHex = (c: string | null | undefined): c is string => Boolean(c && /^#[0-9a-f]{6}$/i.test(c));
const validColor = (c: string | null) => (isHex(c) ? c : '#5DADE2');

/** Builds the card SVG (exported for tests). */
export function cardSvg(d: CardData): string {
  const accent = validColor(d.factionColor);
  const head = fitHeading(clean(d.codename) || '?', 600);
  const cos = d.cosmetics;
  const frameStroke = isHex(cos?.frameStroke) ? cos.frameStroke : null;
  const frameAccent = isHex(cos?.frameAccent) ? cos.frameAccent : frameStroke;
  const titleLabel = cos?.titleLabel ? clean(cos.titleLabel) : '';
  const titleFill = isHex(cos?.titleFill) ? cos.titleFill : '#e5e7eb';
  const titleAccent = isHex(cos?.titleAccent) ? cos.titleAccent : accent;
  const frameLayer = frameStroke
    ? `
  <rect x="8" y="8" width="${CARD_WIDTH - 16}" height="${CARD_HEIGHT - 16}" rx="18" fill="none" stroke="${frameStroke}" stroke-width="4" data-cosmetic="frame"/>
  <rect x="8" y="8" width="28" height="6" rx="2" fill="${frameAccent}"/>
  <rect x="${CARD_WIDTH - 36}" y="8" width="28" height="6" rx="2" fill="${frameAccent}"/>
  <rect x="8" y="${CARD_HEIGHT - 14}" width="28" height="6" rx="2" fill="${frameAccent}"/>
  <rect x="${CARD_WIDTH - 36}" y="${CARD_HEIGHT - 14}" width="28" height="6" rx="2" fill="${frameAccent}"/>`
    : '';
  const titleLayer = titleLabel
    ? `
  <text x="932" y="62" class="cosmetic-title" text-anchor="end" fill="${titleFill}" data-cosmetic="title">${esc(clipText(titleLabel, 18, 280, 0.5))}</text>
  <rect x="652" y="72" width="280" height="3" rx="1.5" fill="${titleAccent}" data-cosmetic="title-accent"/>`
    : '';
  const statKeys: (keyof Stats)[] = ['hp', 'atk', 'def', 'spd', 'foc'];
  const statMax: Record<keyof Stats, number> = { hp: 400, atk: 60, def: 60, spd: 60, foc: 60 };
  const stats = statKeys
    .map((k, i) => {
      const y = 300 + i * 42;
      const w = Math.round(Math.min(1, d.stats[k] / statMax[k]) * 220);
      return `<text x="660" y="${y + 15}" class="label">${esc(d.labels.stats[k])}</text>
  <rect x="712" y="${y}" width="220" height="18" rx="9" fill="#1f2937"/>
  <rect x="712" y="${y}" width="${Math.max(w, 6)}" height="18" rx="9" fill="${accent}"/>
  <text x="932" y="${y - 6}" class="value" text-anchor="end">${d.stats[k]}</text>`;
    })
    .join('\n  ');
  const powerLines = d.powers.main ? [d.powers.main, ...d.powers.secondary] : [d.description];
  const powers = powerLines
    .map((p, i) => {
      const y = 334 + i * 42;
      const main = i === 0 && Boolean(d.powers.main);
      const mark = main
        ? `<rect x="48" y="${y - 20}" width="6" height="24" rx="3" fill="${accent}"/>`
        : `<rect x="50" y="${y - 12}" width="4" height="8" rx="2" fill="#4b5563"/>`;
      return `${mark}<text x="66" y="${y}" class="${main ? 'main' : 'power'}">${esc(clipText(clean(p), main ? 26 : 22, 540))}</text>`;
    })
    .join('\n  ');
  const level = d.level === null ? '' : `${d.labels.level} ${d.level}${d.xp === null ? '' : ` · ${d.xp} XP`}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <style>
    .title { font-family: Oswald; font-weight: 600; font-size: 20px; letter-spacing: 4px; fill: #9ca3af }
    .cosmetic-title { font-family: Oswald; font-weight: 600; font-size: 18px; letter-spacing: 3px }
    .name { font-family: Oswald; font-weight: 600; fill: #f9fafb }
    .meta { font-family: 'Noto Sans'; font-weight: 700; font-size: 26px; fill: #e5e7eb }
    .sub { font-family: 'Noto Sans'; font-weight: 400; font-size: 20px; fill: #9ca3af }
    .section { font-family: Oswald; font-weight: 600; font-size: 18px; letter-spacing: 3px; fill: ${accent} }
    .main { font-family: 'Noto Sans'; font-weight: 700; font-size: 26px; fill: #f9fafb }
    .power { font-family: 'Noto Sans'; font-weight: 400; font-size: 22px; fill: #d1d5db }
    .label { font-family: Oswald; font-weight: 600; font-size: 18px; fill: #9ca3af }
    .value { font-family: 'Noto Sans'; font-weight: 700; font-size: 16px; fill: #f9fafb }
    .brand { font-family: Oswald; font-weight: 600; font-size: 16px; letter-spacing: 3px; fill: #4b5563 }
  </style>
  <rect width="100%" height="100%" fill="#0b0f19"/>
  <rect width="100%" height="10" fill="${accent}"/>
  <circle cx="860" cy="120" r="150" fill="${accent}" opacity="0.08"/>${frameLayer}
  <text x="48" y="62" class="title">${esc(d.labels.title)}</text>${titleLayer}
  <text x="48" y="${120 + Math.round(head.size * 0.3)}" class="name" font-size="${head.size}">${esc(head.text)}</text>
  <text x="48" y="200" class="meta">${esc(clipText(clean(`${d.origin} · ${d.faction} · ${d.archetype}`), 26, 600))}</text>
  <text x="48" y="236" class="sub">${esc(clipText(clean([d.rank, level].filter(Boolean).join(' · ')), 20, 600))}</text>
  <text x="48" y="290" class="section">${esc(d.labels.powers)}</text>
  ${powers}
  <line x1="630" y1="270" x2="630" y2="500" stroke="#1f2937" stroke-width="2"/>
  ${stats}${
    d.gear?.length
      ? `
  <text x="48" y="472" class="section">${esc(d.labels.gear ?? '')}</text>
  <text x="48" y="504" class="power">${esc(clipText(clean(d.gear.join(' · ')), 22, 560))}</text>`
      : ''
  }
  <text x="932" y="524" class="brand" text-anchor="end">LEGION</text>
</svg>`;
}

/** Renders the card to PNG (pure JS + WASM, bundled fonts, no system fonts). */
export async function renderCard(d: CardData): Promise<Uint8Array> {
  const fontBuffers = await setup();
  const svg = new Resvg(cardSvg(d), {
    font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Noto Sans' },
    fitTo: { mode: 'original' },
  });
  const img = svg.render();
  const png = img.asPng();
  img.free();
  svg.free();
  return png;
}
