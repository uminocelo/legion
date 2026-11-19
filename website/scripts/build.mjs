// Builds the static site into website/dist: pages from website/src with the shared layout, command
// tables from data/commands.json, config blocks from legion.config.example.yaml and example content
// files copied from the bots. No dependencies beyond Node.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const SITE = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(SITE, '..');
export const DIST = join(SITE, 'dist');
const REPO = 'https://github.com/uminocelo/legion/blob/main/';

/** Pages: output file, source fragment, title, description, nav key, accent color, bot id. */
export const PAGES = [
  {
    out: 'index.html',
    src: 'index.html',
    title: 'Legion · RPG mutante para Discord',
    description:
      'Legion é um kit gratuito e auto-hospedável de bots de RPG para Discord: crie seu mutante, ganhe XP com trivia e missões, lute e enfrente eventos com o servidor inteiro.',
    nav: 'home',
  },
  {
    out: 'cerebro.html',
    src: 'bots/cerebro.html',
    title: 'Cérebro · Legion',
    description: 'Recepção, cadastro do mutante com poderes, ficha com cartão, facções e cargos.',
    nav: 'bots',
    bot: 'cerebro',
    color: '#5DADE2',
  },
  {
    out: 'jarvis.html',
    src: 'bots/jarvis.html',
    title: 'J.A.R.V.I.S. · Legion',
    description: 'XP, níveis, ranks, trivia, sequências e missões com escolhas.',
    nav: 'bots',
    bot: 'jarvis',
    color: '#F1C40F',
  },
  {
    out: 'herbie.html',
    src: 'bots/herbie.html',
    title: 'H.E.R.B.I.E. · Legion',
    description: 'Tutorial, ajuda, glossário, idioma, dicas e o guia "como jogar".',
    nav: 'bots',
    bot: 'herbie',
    color: '#2ECC71',
  },
  {
    out: 'sentinel.html',
    src: 'bots/sentinel.html',
    title: 'Sentinel · Legion',
    description: 'Combate por turnos com dados conferíveis, limites contra abuso e denúncias.',
    nav: 'bots',
    bot: 'sentinel',
    color: '#95A5A6',
  },
  {
    out: 'ultron.html',
    src: 'bots/ultron.html',
    title: 'ULTRON · Legion',
    description: 'Inimigos, invasões semanais e raids com chefe.',
    nav: 'bots',
    bot: 'ultron',
    color: '#E74C3C',
  },
  {
    out: 'editor-trivia.html',
    src: 'editor-trivia.html',
    title: 'Editor de trivia · Legion',
    description: 'Escreva perguntas de trivia e importe no seu servidor com /jarvis trivia importar.',
    nav: 'custom',
    color: '#F1C40F',
    script: 'trivia',
  },
  {
    out: 'editor-inimigos.html',
    src: 'editor-inimigos.html',
    title: 'Editor de inimigos · Legion',
    description: 'Crie inimigos do ULTRON e importe no seu servidor com /ultron inimigo importar.',
    nav: 'custom',
    color: '#E74C3C',
    script: 'enemy',
  },
  {
    out: 'editor-missoes.html',
    src: 'editor-missoes.html',
    title: 'Editor de missões · Legion',
    description: 'Monte uma missão com cenas, escolhas e combates e importe com /jarvis missao importar.',
    nav: 'custom',
    color: '#00B0F4',
    script: 'mission',
  },
  {
    out: 'skills.html',
    src: 'skills.html',
    title: 'Skills para IA · Legion',
    description:
      'Skills que ensinam um agente de IA a escrever missões, campanhas, trivia e inimigos do Legion, conferidos com legion content validate.',
    nav: 'custom',
    color: '#9B59B6',
  },
  {
    out: 'personalizar.html',
    src: 'personalizar.html',
    title: 'Personalizar · Legion',
    description: 'Missões, perguntas de trivia, inimigos, poderes e textos do seu servidor.',
    nav: 'custom',
  },
];

export const BOT_LINKS = [
  ['cerebro', 'Cérebro'],
  ['jarvis', 'J.A.R.V.I.S.'],
  ['herbie', 'H.E.R.B.I.E.'],
  ['sentinel', 'Sentinel'],
  ['ultron', 'ULTRON'],
];

/** Example files offered for download: [source in the repo, published path]. */
export const EXAMPLES = [
  ...readdirSync(join(ROOT, 'packages/bot-jarvis/content/missions'))
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => [`packages/bot-jarvis/content/missions/${f}`, `exemplos/missoes/${f}`]),
  ['packages/bot-jarvis/content/campaigns/primeiro-contato.yaml', 'exemplos/campanhas/primeiro-contato.yaml'],
  ['packages/bot-jarvis/content/trivia/pt-BR.yaml', 'exemplos/trivia/pt-BR.yaml'],
  ['packages/bot-ultron/content/enemies.yaml', 'exemplos/enemies.yaml'],
  ['packages/bot-cerebro/content/powers.yaml', 'exemplos/powers.yaml'],
  ['packages/bot-herbie/content/guide.pt-BR.yaml', 'exemplos/guide.pt-BR.yaml'],
  ['packages/bot-herbie/content/glossary.pt-BR.yaml', 'exemplos/glossary.pt-BR.yaml'],
  ['packages/bot-herbie/content/tips.pt-BR.yaml', 'exemplos/tips.pt-BR.yaml'],
  ['packages/bot-herbie/content/tutorial.yaml', 'exemplos/tutorial.yaml'],
];

/** The AI skills kit: every file under skills/, zipped as legion-skills.zip. */
export const SKILLS_DIR = join(ROOT, 'skills');
export const SKILLS_ZIP = 'legion-skills.zip';

export function skillFiles(dir = SKILLS_DIR) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...skillFiles(p));
    else out.push(p);
  }
  return out.sort();
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/**
 * A zip archive (deflate) of `[name, Buffer]` entries. Dates are fixed, so the same files always give
 * the same bytes.
 */
export function zip(entries) {
  const DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, nameBuf, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuf, end]);
}

/** legion-skills.zip: the skill folders at the root, ready to drop into ~/.claude/skills/. */
export const skillsZip = () =>
  zip(skillFiles().map((p) => [relative(SKILLS_DIR, p).split('\\').join('/'), readFileSync(p)]));

export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** The `<bot>:` block of the example config, comments included. */
export function configBlock(yaml, bot) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`${bot}:`));
  if (start < 0) return '';
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^[\s#]/.test(lines[end]))) end++;
  // Trailing comment lines belong to the next block.
  while (end > start + 1 && (lines[end - 1] === '' || lines[end - 1].startsWith('#'))) end--;
  return lines.slice(start, end).join('\n');
}

const optionList = (c) =>
  c.options.length
    ? `<div class="opts">${c.options
        .map(
          (o) =>
            `<span class="opt${o.required ? ' req' : ''}" title="${esc(o.description['pt-BR'])}">${esc(o.name)}${o.required ? '' : '?'}</span>`,
        )
        .join(' ')}</div>`
    : '';

export function commandTable(commands, staff) {
  const rows = commands.filter((c) => c.staff === staff);
  if (!rows.length) return '<p class="muted">Nenhum comando.</p>';
  return `<div class="cmds">${rows
    .map(
      (c) =>
        `<div class="cmd"><code>${esc(c.path)}</code>${optionList(c)}<p>${esc(c.description['pt-BR'])}</p></div>`,
    )
    .join('\n')}</div>`;
}

function layout(page, body) {
  const nav = (key, href, label) =>
    `<a href="${href}"${page.nav === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const bots = BOT_LINKS.map(
    ([id, label]) => `<a href="${id}.html"${page.bot === id ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description)}">
  <meta property="og:title" content="${esc(page.title)}">
  <meta property="og:description" content="${esc(page.description)}">
  <meta property="og:image" content="assets/ficha-exemplo.png">
  <meta name="color-scheme" content="dark">
  <link rel="icon" href="assets/icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="style.css">${page.script ? `\n  <script type="module" src="assets/js/${page.script}.js"></script>` : ''}
</head>
<body${page.color ? ` style="--accent:${page.color}"` : ''}>
  <header class="top">
    <a class="brand" href="index.html">LEGION</a>
    <nav>
      <details class="menu"><summary${page.nav === 'bots' ? ' aria-current="page"' : ''}>Bots</summary><div>${bots}</div></details>
      ${nav('custom', 'personalizar.html', 'Personalizar')}
      <a class="hide-sm" href="https://github.com/uminocelo/legion/blob/main/TUTORIAL.md">Hospedar</a>
      <a class="gh" href="https://github.com/uminocelo/legion">GitHub</a>
    </nav>
  </header>

  <main>
${body.trim()}
  </main>

  <footer>
    <p><strong>Legion</strong> é um projeto de fã gratuito e sem fins lucrativos, sem afiliação com a Marvel ou a Disney. Cérebro, J.A.R.V.I.S., H.E.R.B.I.E., ULTRON, Sentinel, X-Men e os demais nomes pertencem à Marvel/Disney.</p>
    <p><a href="https://github.com/uminocelo/legion">GitHub</a> · <a href="https://github.com/uminocelo/legion/blob/main/TUTORIAL.md">Tutorial</a> · <a href="personalizar.html">Personalizar</a> · <a href="https://github.com/uminocelo/legion/blob/main/CHANGELOG.md">Novidades</a></p>
  </footer>
</body>
</html>
`;
}

/** Fills `{{player}}`, `{{staff}}`, `{{config}}`, `{{doc:path}}` and `{{example:path}}` in a fragment. */
export function render(page, fragment, data) {
  const commands = page.bot ? (data.commands[page.bot] ?? []) : [];
  const body = fragment
    .replaceAll('{{player}}', commandTable(commands, false))
    .replaceAll('{{staff}}', commandTable(commands, true))
    .replaceAll(
      '{{config}}',
      page.bot ? `<pre class="cfg"><code>${esc(configBlock(data.configYaml, page.bot))}</code></pre>` : '',
    )
    .replace(/\{\{doc:([^}]+)\}\}/g, (_, p) => `${REPO}${p}`)
    .replace(/\{\{example:([^}]+)\}\}/g, (_, p) => p);
  return layout(page, body);
}

export function readData() {
  return {
    commands: JSON.parse(readFileSync(join(SITE, 'data/commands.json'), 'utf8')),
    configYaml: readFileSync(join(ROOT, 'legion.config.example.yaml'), 'utf8'),
  };
}

/**
 * Editor bundles: `@legion/core` is swapped for the browser stand-in and the canon list is inlined.
 * The validation code (zod, yaml, schemas) goes into one shared chunk the browser caches across editors.
 */
export const EDITORS = ['trivia', 'enemy', 'mission'];

export async function bundleEditors(out) {
  const { build: esbuild } = await import('esbuild');
  const res = await esbuild({
    entryPoints: Object.fromEntries(EDITORS.map((e) => [e, join(SITE, 'editor', `${e}.ts`)])),
    outdir: join(out, 'assets/js'),
    bundle: true,
    splitting: true,
    chunkNames: 'shared-[hash]',
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    alias: { '@legion/core': join(SITE, 'editor/core-shim.ts') },
    loader: { '.txt': 'text', '.yaml': 'text' },
    metafile: true,
    logLevel: 'silent',
  });
  return res.metafile;
}

/** Writes every page, the stylesheet, assets, editor bundles and example files into `out`. */
export async function build(out = DIST) {
  const data = readData();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const written = [];
  const write = (rel, content) => {
    const p = join(out, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    written.push(rel);
  };
  for (const page of PAGES)
    write(page.out, render(page, readFileSync(join(SITE, 'src', page.src), 'utf8'), data));
  cpSync(join(SITE, 'style.css'), join(out, 'style.css'));
  cpSync(join(SITE, 'assets'), join(out, 'assets'), { recursive: true });
  for (const [from, to] of EXAMPLES) {
    if (!existsSync(join(ROOT, from))) throw new Error(`example missing: ${from}`);
    write(to, readFileSync(join(ROOT, from)));
  }
  write(SKILLS_ZIP, skillsZip());
  const meta = await bundleEditors(out);
  written.push(...Object.keys(meta.outputs).map((p) => p.slice(p.indexOf('assets/js/'))));
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = await build();
  console.log(`built ${files.length} files into ${DIST}`);
}
