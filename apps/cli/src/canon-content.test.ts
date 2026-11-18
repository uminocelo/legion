// The larger canon list (ADR 0030) must not refuse anything Legion ships: power and enemy names are
// identities, and content ids should stay clear of canon names too.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCanonName } from '@legion/core';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const yamlAt = (p: string) => parse(readFileSync(join(ROOT, p), 'utf8'));
type Named = { id: string; name?: string | Record<string, string> };
const names = (n: Named) => (typeof n.name === 'string' ? [n.name] : Object.values(n.name ?? {}));

describe('shipped content and the canon list', () => {
  it('no shipped power or enemy name is refused', () => {
    const items: Named[] = [
      ...yamlAt('packages/bot-cerebro/content/powers.yaml'),
      ...yamlAt('packages/bot-ultron/content/enemies.yaml'),
    ];
    expect(items.length).toBeGreaterThan(30);
    expect(items.flatMap(names).filter(isCanonName)).toEqual([]);
  });

  it('no shipped power, enemy, mission or trivia id is refused', () => {
    const dir = 'packages/bot-jarvis/content/missions';
    const ids = [
      ...yamlAt('packages/bot-cerebro/content/powers.yaml').map((p: Named) => p.id),
      ...yamlAt('packages/bot-ultron/content/enemies.yaml').map((e: Named) => e.id),
      ...readdirSync(join(ROOT, dir)).map((f) => yamlAt(`${dir}/${f}`).id as string),
      ...yamlAt('packages/bot-jarvis/content/trivia/pt-BR.yaml').map((q: Named) => q.id),
    ];
    expect(ids.length).toBeGreaterThan(50);
    expect(ids.filter(isCanonName)).toEqual([]);
  });
});
