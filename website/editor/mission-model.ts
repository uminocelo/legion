// Mission drafts ↔ YAML, validated by the bot's own parser (`/jarvis missao importar`).
import { parse, stringify } from 'yaml';
import { DIFFICULTIES, MISSION_KINDS } from '../../packages/bot-jarvis/src/config.js';
import {
  graphErrors,
  type LocalText,
  parseMissionYaml,
} from '../../packages/bot-jarvis/src/domain/mission.js';

export { DIFFICULTIES, MISSION_KINDS };

/** pt-BR is required; en is optional (empty = not written). */
export interface Text2 {
  pt: string;
  en: string;
}
export type SceneType = 'choice' | 'combat' | 'end';
export interface ChoiceDraft {
  label: Text2;
  next: string;
}
export interface SceneDraft {
  id: string;
  type: SceneType;
  text: Text2;
  choices: ChoiceDraft[];
  win: string;
  lose: string;
  end: 'success' | 'failure';
}
export interface MissionDraft {
  id: string;
  kind: string;
  title: Text2;
  summary: Text2;
  minLevel: number;
  party: number;
  difficulty: string;
  /** Off = the server's default XP for the kind (jarvis.missions.rewards). */
  customXp: boolean;
  xp: { success: number; failure: number };
  start: string;
  scenes: SceneDraft[];
}

const t2 = (pt = '', en = ''): Text2 => ({ pt, en });

export const emptyScene = (id: string, type: SceneType = 'choice'): SceneDraft => ({
  id,
  type,
  text: t2(),
  choices: [
    { label: t2(), next: '' },
    { label: t2(), next: '' },
  ],
  win: '',
  lose: '',
  end: 'success',
});

/** A small valid skeleton: one choice leading to a success and a failure ending. */
export const emptyMission = (): MissionDraft => ({
  id: 'minha-missao',
  kind: 'daily',
  title: t2(),
  summary: t2(),
  minLevel: 1,
  party: 1,
  difficulty: 'normal',
  customXp: false,
  xp: { success: 50, failure: 10 },
  start: 'inicio',
  scenes: [
    {
      ...emptyScene('inicio'),
      choices: [
        { label: t2(), next: 'sucesso' },
        { label: t2(), next: 'falha' },
      ],
    },
    emptyScene('sucesso', 'end'),
    { ...emptyScene('falha', 'end'), end: 'failure' },
  ],
});

/** Next free scene id like `cena-4`. */
export function nextSceneId(m: MissionDraft): string {
  const used = new Set(m.scenes.map((s) => s.id));
  for (let n = m.scenes.length + 1; ; n++) if (!used.has(`cena-${n}`)) return `cena-${n}`;
}

/** Renames a scene and every link to it (start, choices, combat). */
export function renameScene(m: MissionDraft, from: string, to: string) {
  if (m.start === from) m.start = to;
  for (const s of m.scenes) {
    if (s.id === from) s.id = to;
    for (const c of s.choices) if (c.next === from) c.next = to;
    if (s.win === from) s.win = to;
    if (s.lose === from) s.lose = to;
  }
}

/** Removes a scene; links to it become empty so the editor shows them as errors. */
export function removeScene(m: MissionDraft, id: string) {
  m.scenes = m.scenes.filter((s) => s.id !== id);
  renameScene(m, id, '');
}

/** Scene ids that link to `id`. */
export const linksTo = (m: MissionDraft, id: string): string[] =>
  m.scenes.filter((s) => targets(s).includes(id)).map((s) => s.id);

export const targets = (s: SceneDraft): string[] =>
  s.type === 'choice' ? s.choices.map((c) => c.next) : s.type === 'combat' ? [s.win, s.lose] : [];

const out = (x: Text2): LocalText => {
  const pt = x.pt.trim();
  const en = x.en.trim();
  return en ? { 'pt-BR': pt, en } : pt;
};

/** The mission object exactly as the YAML file holds it. */
export function toObject(m: MissionDraft) {
  const scenes: Record<string, unknown> = {};
  for (const s of m.scenes) {
    const text = out(s.text);
    scenes[s.id.trim()] =
      s.type === 'choice'
        ? { text, choices: s.choices.map((c) => ({ label: out(c.label), next: c.next })) }
        : s.type === 'combat'
          ? { text, combat: { win: s.win, lose: s.lose } }
          : { text, end: s.end };
  }
  return {
    id: m.id.trim(),
    kind: m.kind,
    title: out(m.title),
    summary: out(m.summary),
    minLevel: m.minLevel,
    party: m.party,
    difficulty: m.difficulty,
    ...(m.customXp ? { xp: { ...m.xp } } : {}),
    start: m.start,
    scenes,
  };
}

export const fileName = (m: MissionDraft) => `${m.id.trim() || 'missao'}.yaml`;

export function toYaml(m: MissionDraft): string {
  return (
    '# Missão do J.A.R.V.I.S. Importe com /jarvis missao importar (anexe este arquivo). Formato: docs/MISSIONS.md\n' +
    stringify(toObject(m))
  );
}

/** The bot's errors, plus editor-only ones the parser cannot see (a scene id written twice). */
export function validate(m: MissionDraft): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const s of m.scenes) {
    if (seen.has(s.id))
      errors.push(`scenes: a cena "${s.id}" aparece duas vezes; os ids precisam ser únicos`);
    seen.add(s.id);
  }
  const res = parseMissionYaml(toYaml(m));
  if ('errors' in res) errors.push(...res.errors);
  return errors;
}

/** Graph problems only (dangling links, unreachable scenes, cycles), for the scene map. */
export function mapProblems(m: MissionDraft): Map<string, string[]> {
  const scenes = toObject(m).scenes as Parameters<typeof graphErrors>[0]['scenes'];
  const byScene = new Map<string, string[]>();
  for (const e of graphErrors({ start: m.start, scenes })) {
    const key = e.path[1] ?? e.path[0] ?? '';
    byScene.set(key, [...(byScene.get(key) ?? []), e.message]);
  }
  return byScene;
}

const inText = (v: unknown): Text2 => {
  if (typeof v === 'string') return t2(v);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return t2(typeof o['pt-BR'] === 'string' ? o['pt-BR'] : '', typeof o.en === 'string' ? o.en : '');
  }
  return t2();
};
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

/** Opens a mission file (shipped or the server's own) as a draft; lenient on purpose. */
export function fromYaml(text: string): MissionDraft {
  const raw = parse(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('o arquivo deve ser uma missão (id, kind, title, scenes...)');
  const r = raw as Record<string, unknown>;
  const xp = r.xp as { success?: unknown; failure?: unknown } | undefined;
  const scenes = Object.entries((r.scenes ?? {}) as Record<string, Record<string, unknown>>).map(
    ([id, s]): SceneDraft => {
      const base = emptyScene(id);
      const combat = s.combat as { win?: unknown; lose?: unknown } | undefined;
      if (Array.isArray(s.choices))
        return {
          ...base,
          text: inText(s.text),
          choices: s.choices.map((c: Record<string, unknown>) => ({
            label: inText(c.label),
            next: str(c.next),
          })),
        };
      if (combat)
        return {
          ...base,
          type: 'combat',
          text: inText(s.text),
          win: str(combat.win),
          lose: str(combat.lose),
        };
      return { ...base, type: 'end', text: inText(s.text), end: s.end === 'failure' ? 'failure' : 'success' };
    },
  );
  return {
    id: str(r.id),
    kind: str(r.kind, 'daily'),
    title: inText(r.title),
    summary: inText(r.summary),
    minLevel: num(r.minLevel, 1),
    party: num(r.party, 1),
    difficulty: str(r.difficulty, 'normal'),
    customXp: !!xp,
    xp: { success: num(xp?.success, 50), failure: num(xp?.failure, 10) },
    start: str(r.start),
    scenes,
  };
}
