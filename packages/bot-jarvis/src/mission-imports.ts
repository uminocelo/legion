import type { BotContext, IncomingInteraction, Locale, OutgoingMessage, Responder } from '@legion/core';
import { customId, readTextAttachment } from '@legion/core';
import { eq } from 'drizzle-orm';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import type { JarvisConfig } from './config.js';
import { hasCombat, loc, type Mission, missionSchema } from './domain/mission.js';
import { missionHash } from './mission-content.js';
import type { JarvisServices } from './services.js';
import { V } from './ui.js';

export const IMPORT_MAX_BYTES = 64 * 1024;
export const missionImportIds = {
  decide: (stageId: string, action: 'publish' | 'cancel') =>
    customId('jarvis', V, 'mission-import', stageId, action),
};
const stageKey = (id: string) => `jarvis.mission-import.${id}`;
interface Staged {
  text: string;
  staffId: string;
}

/** Parses one mission YAML; errors carry the YAML line or the field path. */
export function parseMissionYaml(text: string): { mission: Mission } | { errors: string[] } {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    const line = err instanceof YAMLParseError ? ` (linha ${err.linePos?.[0]?.line ?? 0})` : '';
    return { errors: [`YAML inválido${line}: ${(err as Error).message.split('\n')[0]}`] };
  }
  const res = missionSchema.safeParse(raw);
  if (!res.success)
    return { errors: res.error.issues.map((x) => `${x.path.join('.') || 'missão'}: ${x.message}`) };
  return { mission: res.data };
}

/** Staff import missions from a `.yaml` attachment: validate → preview → publish (live, no restart). */
export class MissionImports {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    private readonly s: JarvisServices,
  ) {}

  private t = (key: string, vars: Record<string, string | number>, l: Locale) =>
    this.ctx.i18n.t(key, vars, l);
  private text = (content: string): OutgoingMessage => ({ persona: 'jarvis', content, ephemeral: true });
  private get table() {
    return this.s.repo.t.jarvisMissions;
  }

  /** `/jarvis missao importar arquivo` (staff checked by the command). */
  async import(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const got = await readTextAttachment(this.ctx.gateway, i.attachments?.arquivo, {
      maxBytes: IMPORT_MAX_BYTES,
      extensions: ['.yaml', '.yml'],
    });
    if ('problem' in got)
      return r.reply(
        this.text(this.t(`jarvis.imports.problem.${got.problem}`, { kb: IMPORT_MAX_BYTES / 1024 }, l)),
      );
    const parsed = parseMissionYaml(got.text);
    if ('errors' in parsed) return r.reply(this.text(this.errors(parsed.errors, l)));
    const stageId = this.ctx.newId();
    await this.ctx.kv.set(stageKey(stageId), { text: got.text, staffId: i.userId } satisfies Staged);
    const m = parsed.mission;
    const prev = await this.s.repo.mission(m.id);
    await r.reply({
      persona: 'jarvis',
      ephemeral: true,
      embeds: [this.preview(m, l, prev ? this.t('jarvis.imports.replaces', { id: m.id }, l) : undefined)],
      components: [
        [
          {
            type: 'button',
            customId: missionImportIds.decide(stageId, 'publish'),
            label: this.t('jarvis.imports.publish', {}, l),
            style: 'success',
          },
          {
            type: 'button',
            customId: missionImportIds.decide(stageId, 'cancel'),
            label: this.t('jarvis.imports.cancel', {}, l),
            style: 'secondary',
          },
        ],
      ],
    });
  }

  private errors(errors: string[], l: Locale) {
    const shown = errors.slice(0, 15).map((e) => `• ${e}`);
    if (errors.length > 15) shown.push(`… +${errors.length - 15}`);
    return this.t('jarvis.imports.invalid', { errors: shown.join('\n') }, l).slice(0, 1900);
  }

  private preview(m: Mission, l: Locale, note?: string) {
    const fights = Object.values(m.scenes).filter((x) => x.combat).length;
    const lines = [
      loc(m.summary, l),
      '',
      this.t(
        'jarvis.imports.mission_meta',
        {
          id: m.id,
          kind: this.t(`jarvis.missions.kind.${m.kind}`, {}, l),
          level: m.minLevel,
          party: m.party,
          scenes: Object.keys(m.scenes).length,
          fights,
        },
        l,
      ),
    ];
    if (fights && !this.s.missions.combatReady()) lines.push(this.t('jarvis.imports.fights_hidden', {}, l));
    if (note) lines.push(note);
    return {
      title: `${this.t('jarvis.imports.preview', {}, l)}: ${loc(m.title, l)}`,
      description: lines.join('\n'),
      color: 0x00b0f4,
    };
  }

  /** Publicar / Cancelar on the preview. */
  async decide(i: IncomingInteraction, r: Responder, [stageId, action]: string[]) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    if (!(await this.ctx.isStaff(i))) return r.reply(this.text(this.t('jarvis.errors.not_staff', {}, l)));
    const key = stageKey(stageId ?? '');
    const staged = await this.ctx.kv.get<Staged | null>(key);
    if (!staged)
      return r.update({ ...this.text(this.t('jarvis.imports.expired', {}, l)), embeds: [], components: [] });
    await this.ctx.kv.set(key, null);
    if (action !== 'publish')
      return r.update({
        ...this.text(this.t('jarvis.imports.cancelled', {}, l)),
        embeds: [],
        components: [],
      });
    const parsed = parseMissionYaml(staged.text);
    if ('errors' in parsed)
      return r.update({ ...this.text(this.errors(parsed.errors, l)), embeds: [], components: [] });
    const m = parsed.mission;
    const now = this.ctx.clock.now().toISOString();
    const row = {
      kind: m.kind,
      minLevel: m.minLevel,
      party: m.party,
      difficulty: m.difficulty,
      hasCombat: hasCombat(m) ? 1 : 0,
      definition: JSON.stringify(m),
      contentHash: missionHash(m),
      active: 1,
      updatedAt: now,
      origin: 'staff',
      importedBy: i.userId,
      disabledBy: null,
    };
    await this.ctx.db.orm
      .insert(this.table)
      .values({ id: m.id, ...row })
      .onConflictDoUpdate({ target: this.table.id, set: row });
    this.ctx.log.info({ staff: i.userId, missionId: m.id }, 'mission imported');
    await r.update({
      ...this.text(this.t('jarvis.imports.published', { id: m.id }, l)),
      embeds: [this.preview(m, l)],
      components: [],
    });
  }

  /** `/jarvis missao lista`. */
  async list(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const rows = await this.s.repo.allMissions();
    const lines = rows.map((row) => {
      const m = JSON.parse(row.definition) as Mission;
      const state = row.active ? '✅' : '⛔';
      const from =
        row.origin === 'staff' && row.importedBy
          ? `<@${row.importedBy}>`
          : this.t('jarvis.staff_trivia.from_file', {}, l);
      return `${state} \`${row.id}\` · ${loc(m.title, l)} · ${this.t(`jarvis.missions.kind.${m.kind}`, {}, l)} · ${from}`;
    });
    await r.reply({
      persona: 'jarvis',
      ephemeral: true,
      allowedMentions: { users: [] },
      embeds: [
        {
          title: this.t('jarvis.imports.mission_list', { total: rows.length }, l),
          description: lines.join('\n').slice(0, 4000) || '—',
        },
      ],
    });
  }

  /** `/jarvis missao desativar | ativar`. Open runs finish normally; new runs see the change at once. */
  async setActive(i: IncomingInteraction, r: Responder, active: boolean) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const id = String(i.options?.missao ?? '');
    if (!(await this.s.repo.mission(id))) return r.reply(this.text(this.t('jarvis.missions.unknown', {}, l)));
    await this.ctx.db.orm
      .update(this.table)
      .set({
        active: active ? 1 : 0,
        disabledBy: active ? null : i.userId,
        updatedAt: this.ctx.clock.now().toISOString(),
      })
      .where(eq(this.table.id, id));
    await r.reply(
      this.text(this.t(active ? 'jarvis.imports.enabled' : 'jarvis.imports.disabled', { id }, l)),
    );
  }

  async autocomplete(i: IncomingInteraction, r: Responder) {
    const term = (i.focused?.value ?? '').toLowerCase();
    const l = await this.ctx.i18n.localeFor(i.userId);
    const out = (await this.s.repo.allMissions())
      .map((row) => ({
        id: row.id,
        title: loc((JSON.parse(row.definition) as Mission).title, l),
        active: row.active,
      }))
      .filter((m) => !term || m.id.includes(term) || m.title.toLowerCase().includes(term))
      .slice(0, 25)
      .map((m) => ({ name: `${m.active ? '✅' : '⛔'} ${m.title} (${m.id})`.slice(0, 100), value: m.id }));
    await r.autocomplete(out);
  }
}
