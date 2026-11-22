// Staff pack tools (US-23): `/jarvis pack importar|lista|remover`.
import {
  type BotContext,
  customId,
  type IncomingInteraction,
  type Locale,
  type OutgoingMessage,
  type Responder,
  readTextAttachment,
} from '@legion/core';
import type { JarvisConfig } from './config.js';
import { IMPORT_MAX_BYTES } from './mission-imports.js';
import type { PackPreviewOk } from './packs.js';
import type { JarvisServices } from './services.js';
import { V } from './ui.js';

export const packImportIds = {
  decide: (stageId: string, action: 'publish' | 'cancel') =>
    customId('jarvis', V, 'pack-import', stageId, action),
};

const stageKey = (id: string) => `jarvis.pack-import.${id}`;
interface Staged {
  text: string;
  name: string;
  staffId: string;
}

/**
 * Staff packs: a single pack.yaml → one preview (metadata + per-type counts) → Publicar.
 * Install/upgrade/remove go through PackInstaller on services (same instance as folder load).
 */
export class PackImports {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    private readonly s: JarvisServices,
  ) {}

  private t = (key: string, vars: Record<string, string | number>, l: Locale) =>
    this.ctx.i18n.t(key, vars, l);
  private text = (content: string): OutgoingMessage => ({
    persona: 'jarvis',
    content,
    ephemeral: true,
    allowedMentions: { parse: [] },
  });

  private packName(nameJson: string | { 'pt-BR': string; en?: string }, l: Locale): string {
    const name =
      typeof nameJson === 'string' ? (JSON.parse(nameJson) as { 'pt-BR': string; en?: string }) : nameJson;
    return (l === 'en' ? name.en : undefined) ?? name['pt-BR'];
  }

  private errors(errors: string[], l: Locale) {
    const shown = errors.slice(0, 15).map((e) => `• ${e}`);
    if (errors.length > 15) shown.push(`… +${errors.length - 15}`);
    return this.t('jarvis.imports.invalid', { errors: shown.join('\n') }, l).slice(0, 1900);
  }

  private typeLine(
    key: 'trivia' | 'missions' | 'enemies' | 'items',
    c: { new: number; changed: number; same: number },
    l: Locale,
  ) {
    return this.t(`jarvis.pack_imports.type_${key}`, { added: c.new, changed: c.changed, same: c.same }, l);
  }

  private previewBody(p: PackPreviewOk, fileName: string, l: Locale): string {
    const { pack, byType, deactivate, existingVersion } = p;
    const lines = [
      this.t(
        'jarvis.pack_imports.meta',
        {
          id: pack.id,
          name: this.packName(pack.name, l),
          version: pack.version,
          author: pack.author,
        },
        l,
      ),
    ];
    if (existingVersion)
      lines.push(this.t('jarvis.pack_imports.upgrade_from', { version: existingVersion }, l));
    lines.push(
      '',
      this.typeLine('trivia', byType.trivia, l),
      this.typeLine('missions', byType.missions, l),
      this.typeLine('enemies', byType.enemies, l),
      this.typeLine('items', byType.items, l),
    );
    const deact = deactivate.trivia + deactivate.missions + deactivate.enemies + deactivate.items;
    if (deact)
      lines.push(
        '',
        this.t(
          'jarvis.pack_imports.deactivate',
          {
            trivia: deactivate.trivia,
            missions: deactivate.missions,
            enemies: deactivate.enemies,
            items: deactivate.items,
          },
          l,
        ),
      );
    void fileName;
    return lines.join('\n').slice(0, 4000);
  }

  /** `/jarvis pack importar arquivo`. */
  async import(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const file = i.attachments?.arquivo;
    const got = await readTextAttachment(this.ctx.gateway, file, {
      maxBytes: IMPORT_MAX_BYTES,
      extensions: ['.yaml', '.yml'],
    });
    if ('problem' in got)
      return r.reply(
        this.text(this.t(`jarvis.imports.problem.${got.problem}`, { kb: IMPORT_MAX_BYTES / 1024 }, l)),
      );
    const name = file?.name ?? 'pack.yaml';
    const preview = await this.s.packs.previewYaml(got.text, name);
    if (!preview.ok) return r.reply(this.text(this.errors(preview.errors, l)));

    const stageId = this.ctx.newId();
    await this.ctx.kv.set(stageKey(stageId), { text: got.text, name, staffId: i.userId } satisfies Staged);
    await r.reply({
      persona: 'jarvis',
      ephemeral: true,
      allowedMentions: { parse: [] },
      embeds: [
        {
          title: `${this.t('jarvis.imports.preview', {}, l)}: ${name}`,
          description: this.previewBody(preview, name, l),
          color: 0x00b0f4,
        },
      ],
      components: [
        [
          {
            type: 'button',
            customId: packImportIds.decide(stageId, 'publish'),
            label: this.t('jarvis.imports.publish', {}, l),
            style: 'success',
          },
          {
            type: 'button',
            customId: packImportIds.decide(stageId, 'cancel'),
            label: this.t('jarvis.imports.cancel', {}, l),
            style: 'secondary',
          },
        ],
      ],
    });
  }

  /** Publicar / Cancelar on the preview. */
  async decide(i: IncomingInteraction, r: Responder, [stageId, action]: string[]) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    if (!(await this.ctx.isStaff(i))) return r.reply(this.text(this.t('jarvis.errors.not_staff', {}, l)));
    const key = stageKey(stageId ?? '');
    const staged = await this.ctx.kv.get<Staged | null>(key);
    const done = (content: string) => r.update({ ...this.text(content), embeds: [], components: [] });
    if (!staged) return done(this.t('jarvis.imports.expired', {}, l));
    await this.ctx.kv.set(key, null);
    if (action !== 'publish') return done(this.t('jarvis.imports.cancelled', {}, l));

    const preview = await this.s.packs.previewYaml(staged.text, staged.name);
    if (!preview.ok) return done(this.errors(preview.errors, l));
    const res = await this.s.packs.applyValidated(preview.pack, {
      source: 'bot',
      importedBy: i.userId,
    });
    if (!res.ok) return done(this.errors(res.errors, l));
    this.ctx.log.info(
      {
        staff: i.userId,
        packId: res.packId,
        version: res.version,
        action: res.action,
        added: res.added,
        changed: res.changed,
        same: res.same,
        deactivated: res.deactivated,
        unequipped: res.unequipped,
      },
      'pack imported',
    );
    return done(
      this.t(
        'jarvis.pack_imports.published',
        {
          id: res.packId,
          version: res.version,
          action: this.t(
            res.action === 'upgrade'
              ? 'jarvis.pack_imports.action_upgrade'
              : 'jarvis.pack_imports.action_install',
            {},
            l,
          ),
          added: res.added,
          changed: res.changed,
          same: res.same,
          deactivated: res.deactivated,
          unequipped: res.unequipped,
        },
        l,
      ),
    );
  }

  /** `/jarvis pack lista`. */
  async list(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const packs = await this.s.packs.list();
    if (!packs.length) return r.reply(this.text(this.t('jarvis.pack_imports.list_empty', {}, l)));
    const lines = packs.map((p) =>
      this.t(
        'jarvis.pack_imports.list_line',
        {
          id: p.id,
          name: this.packName(p.name, l),
          version: p.version,
          author: p.author,
        },
        l,
      ),
    );
    return r.reply(
      this.text(
        [this.t('jarvis.pack_imports.list_title', { total: packs.length }, l), ...lines]
          .join('\n')
          .slice(0, 1900),
      ),
    );
  }

  /** `/jarvis pack remover id`. */
  async remove(i: IncomingInteraction, r: Responder) {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const id = String(i.options?.id ?? '').trim();
    if (!id) return r.reply(this.text(this.t('jarvis.pack_imports.need_id', {}, l)));
    const res = await this.s.packs.remove(id);
    if (!res.ok) return r.reply(this.text(this.errors(res.errors, l)));
    this.ctx.log.info({ staff: i.userId, packId: id }, 'pack removed');
    return r.reply(this.text(this.t('jarvis.pack_imports.removed', { id }, l)));
  }
}
