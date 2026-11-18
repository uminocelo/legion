import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cerebro } from '@legion/bot-cerebro';
import { herbie } from '@legion/bot-herbie';
import { jarvis } from '@legion/bot-jarvis';
import { sentinel } from '@legion/bot-sentinel';
import { ultron } from '@legion/bot-ultron';
import { createTestContext } from '@legion/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { BOT_LINKS, build, configBlock, PAGES } from '../scripts/build.mjs';
// @ts-expect-error plain ESM script without types
import { COMMANDS_FILE, collectCommands, serialize } from '../scripts/commands.mjs';

interface Cmd {
  path: string;
  kind: string;
  staff: boolean;
  description: Record<string, string>;
}
type Reference = Record<string, Cmd[]>;

const ROOT = join(import.meta.dirname, '..', '..');
const committed = (): Reference => JSON.parse(readFileSync(COMMANDS_FILE, 'utf8'));

describe('command reference', () => {
  it('matches what the bots register (run `pnpm build && pnpm site:commands` when this fails)', async () => {
    const fresh = await collectCommands({
      createTestContext,
      bots: [cerebro, jarvis, herbie, sentinel, ultron],
    });
    expect(readFileSync(COMMANDS_FILE, 'utf8')).toBe(serialize(fresh));
  });

  it('lists every bot with player and staff commands, in pt-BR and en', () => {
    const ref = committed();
    expect(Object.keys(ref)).toEqual(['cerebro', 'jarvis', 'herbie', 'sentinel', 'ultron']);
    const all = Object.values(ref).flat();
    const find = (p: string) => all.find((c) => c.path === p);
    expect(find('/perfil')).toMatchObject({ staff: false, kind: 'slash' });
    expect(find('/jarvis trivia nova')).toMatchObject({ staff: true });
    // Restricted in code (not by Discord): taken from the /ajuda registry.
    expect(find('/cerebro setup')?.staff).toBe(true);
    expect(find('/cerebro preferencias')?.staff).toBe(false);
    expect(find('Denunciar mensagem')).toMatchObject({ kind: 'message', staff: false });
    for (const c of all) {
      expect(c.description['pt-BR'], c.path).not.toBe('');
      expect(c.description.en, c.path).not.toBe('');
    }
  });
});

describe('site build', () => {
  let out = '';
  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'legion-site-'));
    build(out);
  });
  afterAll(() => rmSync(out, { recursive: true, force: true }));
  const page = (f: string) => readFileSync(join(out, f), 'utf8');

  it('writes every page with no placeholder left and no external scripts, styles or images', () => {
    for (const p of PAGES as { out: string }[]) {
      const html = page(p.out);
      expect(html, p.out).not.toMatch(/\{\{/);
      expect(html, p.out).not.toMatch(/<(script|img)[^>]+src="https?:/);
      expect(html, p.out).not.toMatch(/<link[^>]+href="https?:/);
    }
  });

  it('shows every command of a bot on its page, split into player and staff', () => {
    const ref = committed();
    for (const [bot] of BOT_LINKS as [string, string][]) {
      const html = page(`${bot}.html`);
      const [player, staff] = html.split('Para a staff');
      for (const c of ref[bot] ?? [])
        expect(c.staff ? staff : player, `${bot}: ${c.path}`).toContain(`<code>${c.path}</code>`);
    }
  });

  it('shows the bot block of the example config', () => {
    const yaml = readFileSync(join(ROOT, 'legion.config.example.yaml'), 'utf8');
    const block = configBlock(yaml, 'jarvis');
    expect(block.startsWith('jarvis:')).toBe(true);
    expect(block).toContain('missions:');
    expect(block).not.toMatch(/^herbie:/m);
    expect(page('jarvis.html')).toContain('dailyXpCap');
  });

  it('has working local links, downloads and docs links', () => {
    const files = new Set<string>();
    const walk = (d: string, base = '') => {
      for (const e of readdirSync(d, { withFileTypes: true }))
        e.isDirectory() ? walk(join(d, e.name), `${base}${e.name}/`) : files.add(`${base}${e.name}`);
    };
    walk(out);
    for (const p of PAGES as { out: string }[]) {
      for (const [, href] of page(p.out).matchAll(/href="([^"]+)"/g)) {
        const h = href as string;
        if (h.startsWith('https://github.com/uminocelo/legion/blob/main/')) {
          const path = decodeURIComponent(
            h.slice('https://github.com/uminocelo/legion/blob/main/'.length).split('#')[0] ?? '',
          );
          expect(existsSync(join(ROOT, path)), `${p.out} → ${h}`).toBe(true);
        } else if (!/^(https?:|#)/.test(h)) {
          expect(files.has(h.split('#')[0] ?? ''), `${p.out} → ${h}`).toBe(true);
        }
      }
    }
  });
});
