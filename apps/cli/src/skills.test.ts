// The AI skills kit (skills/): every skill is complete and every example passes the same validator
// the skills tell agents to run.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigAndBots } from '@legion/runner';
import { describe, expect, it } from 'vitest';
import { contentFiles, validateContent } from './content-validate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SKILLS = join(ROOT, 'skills');
export const SKILL_NAMES = [
  'legion-campaign',
  'legion-mission',
  'legion-trivia',
  'legion-enemy',
  'legion-setup',
];
const CONTENT_SKILLS = SKILL_NAMES.filter((s) => s !== 'legion-setup');
const skillMd = (s: string) => readFileSync(join(SKILLS, s, 'SKILL.md'), 'utf8');

describe('skills kit', () => {
  it('has exactly the five skills, each with a SKILL.md whose name matches its folder', () => {
    const dirs = readdirSync(SKILLS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual([...SKILL_NAMES].sort());
    for (const s of SKILL_NAMES) {
      const md = skillMd(s);
      const front = md.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
      expect(front, s).toMatch(new RegExp(`^name: ${s}$`, 'm'));
      expect(front, s).toMatch(/^description: .{40,1024}$/m);
    }
  });

  it.each(CONTENT_SKILLS)('%s covers the schema, canon policy, balance, pt-BR style and validation', (s) => {
    const md = skillMd(s);
    for (const section of ['## Format', '## Canon policy', '## Balance', '## pt-BR style', '## Validate'])
      expect(md, `${s}: ${section}`).toContain(section);
    expect(md).toContain('legion content validate');
    expect(md).toMatch(/Never hand over|hand over only/i);
  });

  it('legion-setup never reads .env and points to doctor and the validator', () => {
    const md = skillMd('legion-setup');
    expect(md).toMatch(/Never open, read, print, `cat`, `grep` or copy `.env`/);
    expect(md).toContain('legion doctor');
    expect(md).toContain('legion content validate');
  });

  it.each(CONTENT_SKILLS)('every example of %s passes legion content validate', (s) => {
    const dir = join(SKILLS, s, 'examples');
    expect(existsSync(dir), s).toBe(true);
    expect(contentFiles(dir).length, s).toBeGreaterThan(0);
    const r = validateContent([dir]);
    expect(
      r.files.filter((f) => f.errors.length || f.warnings.length || f.type === null),
      s,
    ).toEqual([]);
    expect(r.exitCode).toBe(0);
  });

  it('the examples named in each SKILL.md exist', () => {
    for (const s of SKILL_NAMES)
      for (const [, path] of skillMd(s).matchAll(/`(examples\/[^`]+)`/g))
        expect(existsSync(join(SKILLS, s, path ?? '')), `${s}: ${path}`).toBe(true);
  });

  it('the legion-setup example config loads like the bot loads it', async () => {
    const { config, bots } = await loadConfigAndBots(
      join(SKILLS, 'legion-setup/examples/legion.config.yaml'),
    );
    expect(bots.map((b) => b.id).sort()).toEqual(['cerebro', 'herbie', 'jarvis', 'sentinel', 'ultron']);
    expect(config.locale).toBe('pt-BR');
  });

  it('fails when an example has a validation error', () => {
    // The check above relies on validateContent catching problems in examples; prove it does.
    const r = validateContent([join(SKILLS, 'legion-trivia/examples')], { categories: ['geral'] });
    expect(r.exitCode).toBe(1);
  });
});
