// `legion content validate`: checks content files with the same functions the bots and the site
// editors use. Read-only: no database, no Discord, no .env.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { powerSchema } from '@legion/bot-cerebro';
import {
  type Campaign,
  campaignDirs,
  campaignSchema,
  checkCampaignContent,
  checkTriviaItems,
  jarvisConfigSchema,
  type Mission,
  missionDirs,
  parseCampaignYaml,
  parseMissionYaml,
  readContent,
} from '@legion/bot-jarvis';
import { parseEnemiesYaml } from '@legion/bot-ultron';
import { contentIssue, type Locale } from '@legion/core';
import { parse as parseYaml, YAMLParseError } from 'yaml';

export const CONTENT_TYPES = ['trivia', 'mission', 'campaign', 'campaign-file', 'enemy', 'power'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export interface FileResult {
  path: string;
  /** null when the type could not be told from the file. */
  type: ContentType | null;
  errors: string[];
  warnings: string[];
}

export interface ValidateReport {
  ok: boolean;
  files: FileResult[];
  /** 0 valid, 1 errors, 2 nothing recognisable. */
  exitCode: 0 | 1 | 2;
}

export interface ValidateOptions {
  type?: ContentType;
  /** Trivia categories accepted; default: J.A.R.V.I.S.'s default `trivia.categories`. */
  categories?: string[];
}

/** The default trivia categories, read from J.A.R.V.I.S.'s config schema. */
export const defaultCategories = (): string[] => jarvisConfigSchema.parse({}).trivia.categories;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Tells the content type from the shape of a parsed YAML document. */
export function detectType(raw: unknown): ContentType | null {
  if (Array.isArray(raw)) {
    const first = raw.find(isObj);
    if (!first) return null;
    if ('question' in first || 'choices' in first) return 'trivia';
    if ('tier' in first || 'base' in first || 'tauntKeys' in first) return 'enemy';
    if ('type' in first && 'description' in first) return 'power';
    return null;
  }
  if (!isObj(raw)) return null;
  if ('campaign' in raw && 'missions' in raw) return 'campaign-file';
  if ('scenes' in raw || 'start' in raw) return 'mission';
  if ('kind' in raw && 'title' in raw) return 'campaign';
  return null;
}

/** Every *.yaml / *.yml under a path (the path itself when it is a file), sorted. */
export function contentFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  const out: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const p = join(path, entry.name);
    if (entry.isDirectory()) out.push(...contentFiles(p));
    else if (/\.ya?ml$/.test(entry.name)) out.push(p);
  }
  return out.sort();
}

function readDoc(path: string): { raw: unknown } | { error: string } {
  try {
    return { raw: parseYaml(readFileSync(path, 'utf8')) };
  } catch (err) {
    const pos = err instanceof YAMLParseError ? ` (linha ${err.linePos?.[0]?.line ?? 0})` : '';
    return { error: `YAML inválido${pos}: ${(err as Error).message.split('\n')[0]}` };
  }
}

/** Shipped missions and campaigns, so a server file may name them in `requires` or `campaign`. */
function shipped(): { missions: Mission[]; campaigns: Campaign[] } {
  const r = readContent(missionDirs('/nonexistent'), campaignDirs('/nonexistent'));
  return { missions: r.missions, campaigns: r.campaigns ?? [] };
}

/**
 * Validates files and folders. Each file is checked on its own with the bots' parsers; then the
 * missions and campaigns found are checked together (chapters, `requires`, cycles, `joinFaction`),
 * next to the shipped ones. In a folder, files of an unknown type are skipped with a note.
 */
export function validateContent(paths: string[], o: ValidateOptions = {}): ValidateReport {
  const categories = o.categories ?? defaultCategories();
  const files: FileResult[] = [];
  const missions = new Map<string, { m: Mission; r: FileResult }>();
  const campaigns = new Map<string, { c: Campaign; r: FileResult }>();
  const triviaSeen = new Map<string, string>();
  const single = paths.length === 1 && existsSync(paths[0] ?? '') && !statSync(paths[0] ?? '').isDirectory();

  for (const root of paths) {
    if (!existsSync(root)) {
      files.push({ path: root, type: null, errors: ['arquivo ou pasta não encontrado'], warnings: [] });
      continue;
    }
    const isDir = statSync(root).isDirectory();
    for (const path of contentFiles(root)) {
      const shown = isDir ? join(basename(root), relative(root, path)) : path;
      const r: FileResult = { path: shown, type: null, errors: [], warnings: [] };
      files.push(r);
      const doc = readDoc(path);
      if ('error' in doc) {
        r.type = o.type ?? null;
        r.errors.push(doc.error);
        continue;
      }
      r.type = o.type ?? detectType(doc.raw);
      const name = basename(path);
      switch (r.type) {
        case 'trivia': {
          if (!Array.isArray(doc.raw)) {
            r.errors.push('o arquivo deve ser uma lista de perguntas');
            break;
          }
          const stem = name.replace(/\.ya?ml$/, '');
          const locale: Locale = stem === 'en' ? 'en' : 'pt-BR';
          r.errors.push(...checkTriviaItems(doc.raw, name, { categories, locale, seen: triviaSeen }).errors);
          break;
        }
        case 'mission': {
          const res = parseMissionYaml(readFileSync(path, 'utf8'));
          if ('errors' in res) r.errors.push(...res.errors);
          else if (missions.has(res.mission.id))
            r.errors.push(
              `id: "${res.mission.id}" repetido (já existe em ${missions.get(res.mission.id)?.r.path})`,
            );
          else missions.set(res.mission.id, { m: res.mission, r });
          break;
        }
        case 'campaign': {
          const res = campaignSchema.safeParse(doc.raw);
          if (!res.success)
            for (const iss of res.error.issues)
              r.errors.push(`${iss.path.join('.') || 'campanha'}: ${contentIssue(iss)}`);
          else if (campaigns.has(res.data.id))
            r.errors.push(
              `id: "${res.data.id}" repetido (já existe em ${campaigns.get(res.data.id)?.r.path})`,
            );
          else campaigns.set(res.data.id, { c: res.data, r });
          break;
        }
        case 'campaign-file': {
          const base = shipped();
          const res = parseCampaignYaml(readFileSync(path, 'utf8'), {
            knownMissionIds: new Set(base.missions.map((m) => m.id)),
          });
          if ('errors' in res) r.errors.push(...res.errors);
          break;
        }
        case 'enemy':
          r.errors.push(...parseEnemiesYaml(readFileSync(path, 'utf8'), name).errors);
          break;
        case 'power': {
          if (!Array.isArray(doc.raw)) {
            r.errors.push('o arquivo deve ser uma lista de poderes');
            break;
          }
          const seen = new Set<string>();
          doc.raw.forEach((item, idx) => {
            const id = (item as { id?: unknown })?.id;
            const where = `item ${idx + 1}${typeof id === 'string' ? ` (${id})` : ''}`;
            const res = powerSchema.safeParse(item);
            if (!res.success) {
              for (const iss of res.error.issues)
                r.errors.push(`${where} → ${iss.path.join('.') || '?'}: ${iss.message}`);
              return;
            }
            if (seen.has(res.data.id)) r.errors.push(`${where}: id repetido no mesmo arquivo`);
            seen.add(res.data.id);
          });
          break;
        }
        default:
          if (single || !isDir) r.errors.push(`tipo desconhecido; use --type (${CONTENT_TYPES.join(', ')})`);
          else r.warnings.push('ignorado: não parece trivia, missão, campanha, inimigo nem poder');
      }
    }
  }

  // Missions and campaigns together, next to the shipped ones (a server file may build on them).
  if (missions.size || campaigns.size) {
    const base = shipped();
    const ownMissions = [...missions.values()].map((x) => x.m);
    const ownCampaigns = [...campaigns.values()].map((x) => x.c);
    const knownCampaigns = new Map(base.campaigns.filter((c) => !campaigns.has(c.id)).map((c) => [c.id, c]));
    const knownMissions = base.missions.filter((m) => !missions.has(m.id));
    // Shipped chapters stay in the check so a repeated chapter number is caught.
    const problems = checkCampaignContent(ownCampaigns, [...ownMissions, ...knownMissions], {
      knownCampaigns,
      unknownRequires: 'warn',
    });
    for (const p of problems) {
      const r = missions.get(p.missionId)?.r;
      if (!r) continue; // a problem inside shipped content is not this run's to report
      (p.level === 'error' ? r.errors : r.warnings).push(`${p.path}: ${p.message}`);
    }
  }

  const recognised = files.filter((f) => f.type !== null);
  const hasErrors = files.some((f) => f.errors.length);
  const unknownSingle =
    single && files[0]?.type === null && !files[0]?.errors.some((e) => e.startsWith('YAML'));
  const exitCode: 0 | 1 | 2 = unknownSingle || (!recognised.length && !hasErrors) ? 2 : hasErrors ? 1 : 0;
  return { ok: exitCode === 0, files, exitCode };
}

export function formatValidate(r: ValidateReport): string {
  const lines: string[] = [];
  for (const f of r.files) {
    const icon = f.errors.length ? '❌' : f.type === null ? 'ℹ️ ' : f.warnings.length ? '⚠️ ' : '✅';
    lines.push(`${icon} ${f.path}${f.type ? ` (${f.type})` : ''}`);
    for (const e of f.errors) lines.push(`   ❌ ${e}`);
    for (const w of f.warnings) lines.push(`   ⚠️  ${w}`);
  }
  const bad = r.files.filter((f) => f.errors.length).length;
  const checked = r.files.filter((f) => f.type !== null).length;
  lines.push('');
  if (r.exitCode === 2) lines.push('Nenhum arquivo de conteúdo reconhecido. Use --type para dizer o tipo.');
  else if (bad) lines.push(`${bad} arquivo(s) com erro de ${r.files.length}. Corrija os ❌ e rode de novo.`);
  else lines.push(`Tudo certo: ${checked} arquivo(s) de conteúdo válidos.`);
  return lines.join('\n');
}
