import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { cerebro } from '@legion/bot-cerebro';
import { herbie } from '@legion/bot-herbie';
import { jarvis } from '@legion/bot-jarvis';
import { sentinel } from '@legion/bot-sentinel';
import { ultron } from '@legion/bot-ultron';
import { createTestContext } from '@legion/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import {
  BOT_LINKS,
  build,
  CHAPTERS,
  configBlock,
  PAGES,
  SKILLS_DIR,
  skillFiles,
  skillsZip,
} from '../scripts/build.mjs';
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

  it('reads as a playbook: chapters in order in the menu, the home page and step 1 pointing to the template', () => {
    const chapters = CHAPTERS as [string, string][];
    for (const p of PAGES as { out: string }[]) {
      const html = page(p.out);
      const at = chapters.map(([id]) => html.indexOf(`href="playbook-${id}.html"`));
      expect(
        at.every((i) => i > 0),
        p.out,
      ).toBe(true);
      expect(
        [...at].sort((a, b) => a - b),
        p.out,
      ).toEqual(at);
      for (const [id] of BOT_LINKS as [string, string][]) expect(html, p.out).toContain(`href="${id}.html"`);
    }
    expect(page('index.html')).toContain('href="playbook-montar.html">Começar pelo playbook');
    const montar = page('playbook-montar.html');
    expect(montar).toContain('docs/TEMPLATE.md');
    expect(montar).toContain('<a href="playbook-montar.html" aria-current="page">');
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

/** Reads a zip's entries through its central directory. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    const data = buf.subarray(
      offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28),
      offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28) + size,
    );
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 46 + nameLen + extra;
  }
  return out;
}

describe('skills kit download', () => {
  it('legion-skills.zip has every file of every skill, unchanged, with SKILL.md at <skill>/SKILL.md', async () => {
    const out = mkdtempSync(join(tmpdir(), 'legion-skills-'));
    try {
      await build(out);
      const entries = unzip(readFileSync(join(out, 'legion-skills.zip')));
      const files = (skillFiles() as string[]).map((p) => relative(SKILLS_DIR, p).split('\\').join('/'));
      expect([...entries.keys()].sort()).toEqual(files);
      for (const f of files) expect(entries.get(f)?.equals(readFileSync(join(SKILLS_DIR, f))), f).toBe(true);
      for (const s of ['legion-campaign', 'legion-mission', 'legion-trivia', 'legion-enemy', 'legion-setup'])
        expect(entries.has(`${s}/SKILL.md`), s).toBe(true);
      // Same files, same bytes: the published zip only changes when a skill does.
      expect((skillsZip() as Buffer).equals(readFileSync(join(out, 'legion-skills.zip')))).toBe(true);
      const html = readFileSync(join(out, 'skills.html'), 'utf8');
      expect(html).toContain('href="legion-skills.zip"');
      expect(html).toContain('~/.claude/skills/');
      expect(html).toMatch(/Outros agentes/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
