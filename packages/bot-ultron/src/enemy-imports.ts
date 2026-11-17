import type { BotContext, IncomingInteraction, Locale, OutgoingMessage, Responder } from '@legion/core';
import { customId, readTextAttachment } from '@legion/core';
import { eq } from 'drizzle-orm';
import type { UltronConfig } from './config.js';
import { contentHash, type EnemyTemplate, parseEnemiesYaml } from './content.js';
import type { UltronRepo } from './db/repo.js';
import { V } from './world-events.js';

export const ENEMY_IMPORT_MAX_BYTES = 64 * 1024;
export const enemyImportIds = {
  decide: (stageId: string, action: 'publish' | 'cancel') =>
    customId('ultron', V, 'enemy-import', stageId, action),
};
const stageKey = (id: string) => `ultron.enemy-import.${id}`;
interface Staged {
  text: string;
  name: string;
  staffId: string;
}

/** Staff import enemies from a `.yaml` attachment (same list format as enemies.yaml): validate → preview → publish. */
export class EnemyImports {
  constructor(
    private readonly ctx: BotContext<UltronConfig>,
    private readonly repo: UltronRepo,
  ) {}

  private t = (key: string, vars: Record<string, string | number>, l: Locale) =>
    this.ctx.i18n.t(key, vars, l);
  private text = (content: string): OutgoingMessage => ({ persona: 'ultron', content, ephemeral: true });
  private get table() {
    return this.repo.t.ultronEnemyTemplates;
  }

  /** `/ultron inimigo importar arquivo` (staff checked by the command). */
  async import(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const att = i.attachments?.arquivo;
    const got = await readTextAttachment(this.ctx.gateway, att, {
      maxBytes: ENEMY_IMPORT_MAX_BYTES,
      extensions: ['.yaml', '.yml'],
    });
    if ('problem' in got)
      return r.reply(
        this.text(this.t(`ultron.imports.problem.${got.problem}`, { kb: ENEMY_IMPORT_MAX_BYTES / 1024 }, l)),
      );
    const name = att?.name ?? 'arquivo.yaml';
    const parsed = parseEnemiesYaml(got.text, name);
    if (parsed.errors.length || !parsed.enemies.length)
      return r.reply(
        this.text(this.errors(parsed.errors.length ? parsed.errors : [`${name}: nenhum inimigo`], l)),
      );
    const stageId = this.ctx.newId();
    await this.ctx.kv.set(stageKey(stageId), { text: got.text, name, staffId: i.userId } satisfies Staged);
    await r.reply({
      persona: 'ultron',
      ephemeral: true,
      embeds: [await this.preview(parsed.enemies, l)],
      components: [
        [
          {
            type: 'button',
            customId: enemyImportIds.decide(stageId, 'publish'),
            label: this.t('ultron.imports.publish', {}, l),
            style: 'success',
          },
          {
            type: 'button',
            customId: enemyImportIds.decide(stageId, 'cancel'),
            label: this.t('ultron.imports.cancel', {}, l),
            style: 'secondary',
          },
        ],
      ],
    });
  }

  private errors(errors: string[], l: Locale) {
    const shown = errors.slice(0, 15).map((e) => `• ${e}`);
    if (errors.length > 15) shown.push(`… +${errors.length - 15}`);
    return this.t('ultron.imports.invalid', { errors: shown.join('\n') }, l).slice(0, 1900);
  }

  private async preview(enemies: EnemyTemplate[], l: Locale) {
    const lines = [];
    for (const e of enemies) {
      const exists = await this.repo.template(e.id);
      lines.push(
        `${exists ? '♻️' : '🆕'} \`${e.id}\` · **${e.name}** · ${e.tier} · ${this.t('ultron.imports.level', { level: e.minLevel }, l)} · HP ${e.base.hp} ATK ${e.base.atk} DEF ${e.base.def} SPD ${e.base.spd} FOC ${e.base.foc}`,
      );
    }
    return {
      title: this.t('ultron.imports.preview', { count: enemies.length }, l),
      description: lines.join('\n').slice(0, 4000),
      color: 0xc0392b,
    };
  }

  /** Publicar / Cancelar on the preview. */
  async decide(i: IncomingInteraction, r: Responder, [stageId, action]: string[]) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    if (!(await this.ctx.isStaff(i))) return r.reply(this.text(this.t('ultron.errors.not_staff', {}, l)));
    const key = stageKey(stageId ?? '');
    const staged = await this.ctx.kv.get<Staged | null>(key);
    const done = (content: string) => r.update({ ...this.text(content), embeds: [], components: [] });
    if (!staged) return done(this.t('ultron.imports.expired', {}, l));
    await this.ctx.kv.set(key, null);
    if (action !== 'publish') return done(this.t('ultron.imports.cancelled', {}, l));
    const parsed = parseEnemiesYaml(staged.text, staged.name);
    if (parsed.errors.length) return done(this.errors(parsed.errors, l));
    const now = this.ctx.clock.now().toISOString();
    await this.ctx.db.transaction(async (tx) => {
      for (const e of parsed.enemies) {
        const row = {
          name: e.name,
          tier: e.tier,
          minLevel: e.minLevel,
          base: JSON.stringify(e.base),
          powerCooldownMax: e.powerCooldownMax,
          tauntKeys: JSON.stringify(e.tauntKeys),
          contentHash: contentHash(e),
          active: 1,
          updatedAt: now,
          origin: 'staff',
          importedBy: i.userId,
          disabledBy: null,
        };
        await tx
          .insert(this.table)
          .values({ id: e.id, ...row })
          .onConflictDoUpdate({ target: this.table.id, set: row });
      }
    });
    this.ctx.log.info({ staff: i.userId, enemies: parsed.enemies.map((e) => e.id) }, 'enemies imported');
    await r.update({
      ...this.text(this.t('ultron.imports.published', { count: parsed.enemies.length }, l)),
      embeds: [await this.preview(parsed.enemies, l)],
      components: [],
    });
  }

  /** `/ultron inimigo lista`. */
  async list(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const rows = await this.ctx.db.orm
      .select()
      .from(this.table)
      .orderBy(this.table.tier, this.table.minLevel, this.table.id);
    const from = (o: string, by: string | null) =>
      o === 'staff' && by ? `<@${by}>` : this.t('ultron.imports.from_file', {}, l);
    const lines = rows.map(
      (e) =>
        `${e.active ? '✅' : '⛔'} \`${e.id}\` · ${e.name} · ${e.tier} · ${this.t('ultron.imports.level', { level: e.minLevel }, l)} · ${from(e.origin, e.importedBy)}`,
    );
    await r.reply({
      persona: 'ultron',
      ephemeral: true,
      allowedMentions: { users: [] },
      embeds: [
        {
          title: this.t('ultron.imports.list', { total: rows.length }, l),
          description: lines.join('\n').slice(0, 4000) || '—',
        },
      ],
    });
  }

  /** `/ultron inimigo desativar | ativar`: new encounters see it at once; at least one level-1 minion must stay. */
  async setActive(i: IncomingInteraction, r: Responder, active: boolean) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const id = String(i.options?.inimigo ?? '');
    const row = await this.repo.template(id);
    if (!row) return r.reply(this.text(this.t('ultron.imports.unknown', {}, l)));
    if (!active) {
      const left = (await this.repo.templates()).filter(
        (e) => e.id !== id && e.tier === 'minion' && e.minLevel === 1,
      );
      if (!left.length) return r.reply(this.text(this.t('ultron.imports.last_minion', {}, l)));
    }
    await this.ctx.db.orm
      .update(this.table)
      .set({
        active: active ? 1 : 0,
        disabledBy: active ? null : i.userId,
        updatedAt: this.ctx.clock.now().toISOString(),
      })
      .where(eq(this.table.id, id));
    await r.reply(
      this.text(this.t(active ? 'ultron.imports.enabled' : 'ultron.imports.disabled', { id }, l)),
    );
  }

  async autocomplete(i: IncomingInteraction, r: Responder) {
    const term = (i.focused?.value ?? '').toLowerCase();
    const rows = await this.ctx.db.orm.select().from(this.table).orderBy(this.table.id);
    await r.autocomplete(
      rows
        .filter((e) => !term || e.id.includes(term) || e.name.toLowerCase().includes(term))
        .slice(0, 25)
        .map((e) => ({ name: `${e.active ? '✅' : '⛔'} ${e.name} (${e.id})`.slice(0, 100), value: e.id })),
    );
  }
}
