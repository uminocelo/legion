// Generates website/data/commands.json from the bots' own command definitions, so the site never
// drifts from what the bots register on Discord.
//   node website/scripts/commands.mjs           writes the file (after `pnpm build`)
//   node website/scripts/commands.mjs --check   exits 1 when the committed file is stale
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BOT_ORDER = ['cerebro', 'jarvis', 'herbie', 'sentinel', 'ultron'];
export const COMMANDS_FILE = fileURLToPath(new URL('../data/commands.json', import.meta.url));

const SUB = 1;
const GROUP = 2;
const CHANNELS = {
  welcome: '300000000000000001',
  combat: '300000000000000010',
  events: '300000000000000012',
};

const text = (o) => ({ 'pt-BR': o.description ?? '', en: o.description_localizations?.['en-US'] ?? '' });
const options = (list = []) =>
  list
    .filter((o) => o.type > GROUP)
    .map((o) => ({
      name: o.name,
      nameEn: o.name_localizations?.['en-US'] ?? o.name,
      required: Boolean(o.required),
      description: text(o),
    }));

/**
 * Flattens every command into one entry per runnable path (`/jarvis trivia nova`), with options,
 * descriptions (pt-BR and en) and whether it is staff-only (Discord default permissions "0", or marked
 * admin-only in the `/ajuda` registry).
 */
export async function collectCommands({ createTestContext, bots }) {
  const t = await createTestContext({ bots, config: { channels: CHANNELS } });
  try {
    const router = t.runtime.router;
    const admin = t.runtime.help
      .list({ includeAdmin: true })
      .filter((e) => e.adminOnly)
      .map((e) => e.command);
    const isAdmin = (path) => admin.some((c) => path === c || path.startsWith(`${c} `));
    const out = Object.fromEntries(BOT_ORDER.filter((b) => bots.some((x) => x.id === b)).map((b) => [b, []]));
    for (const c of router.commandJson()) {
      const bot = router.ownerOf(c.name);
      const rootStaff = c.default_member_permissions === '0';
      const push = (path, node) =>
        out[bot].push({
          path,
          kind: c.type === 3 ? 'message' : c.type === 2 ? 'user' : 'slash',
          staff: rootStaff || isAdmin(path),
          description: text(node),
          options: options(node.options),
        });
      if (c.type === 2 || c.type === 3) {
        // Discord gives context menus no description: say where to find them.
        const where = c.type === 3 ? ['na mensagem', 'the message'] : ['no membro', 'the member'];
        const en = c.name_localizations?.['en-US'] ?? c.name;
        push(c.name, {
          description: `Clique direito ${where[0]} → Apps → ${c.name}`,
          description_localizations: { 'en-US': `Right-click ${where[1]} → Apps → ${en}` },
        });
        continue;
      }
      const subs = (c.options ?? []).filter((o) => o.type === SUB || o.type === GROUP);
      if (!subs.length) push(`/${c.name}`, c);
      for (const s of subs) {
        if (s.type === SUB) push(`/${c.name} ${s.name}`, s);
        else for (const g of s.options ?? []) push(`/${c.name} ${s.name} ${g.name}`, g);
      }
    }
    for (const list of Object.values(out)) list.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  } finally {
    await t.close();
  }
}

export const serialize = (data) => `${JSON.stringify(data, null, 2)}\n`;

async function main() {
  const pkg = (p) => new URL(`../../packages/${p}/dist/index.js`, import.meta.url).href;
  const { createTestContext } = await import(pkg('core'));
  const bots = await Promise.all(BOT_ORDER.map(async (b) => (await import(pkg(`bot-${b}`)))[b]));
  const next = serialize(await collectCommands({ createTestContext, bots }));
  if (process.argv.includes('--check')) {
    const current = (() => {
      try {
        return readFileSync(COMMANDS_FILE, 'utf8');
      } catch {
        return '';
      }
    })();
    if (current !== next) {
      console.error(
        'website/data/commands.json is stale: run `pnpm build && pnpm site:commands` and commit it.',
      );
      process.exit(1);
    }
    console.log('website/data/commands.json is up to date');
    return;
  }
  writeFileSync(COMMANDS_FILE, next);
  console.log(`wrote ${COMMANDS_FILE}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
