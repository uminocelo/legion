import type { BotContext, IncomingInteraction, Locale, OutgoingMessage, Responder } from '@legion/core';
import { customId, readTextAttachment } from '@legion/core';
import type { JarvisConfig } from './config.js';
import {
  type Campaign,
  type CampaignFile,
  chaptersOf,
  parseCampaignYaml,
  type Unmet,
} from './domain/campaign.js';
import { loc, type Mission } from './domain/mission.js';
import { campaignColumns, missionColumns, parseCampaign } from './mission-content.js';
import { IMPORT_MAX_BYTES } from './mission-imports.js';
import type { JarvisServices } from './services.js';
import { squadContentVisible } from './squad-visibility.js';
import { V } from './ui.js';

export const campaignImportIds = {
  decide: (stageId: string, action: 'publish' | 'cancel') =>
    customId('jarvis', V, 'campaign-import', stageId, action),
};
const stageKey = (id: string) => `jarvis.campaign-import.${id}`;
interface Staged {
  text: string;
  staffId: string;
}
const COLOR = 0x00b0f4;

/** A chapter for one member: done, open, or locked by `requires` (`unmet`) or by `minLevel`. */
interface ChapterState {
  mission: Mission;
  state: 'done' | 'open' | 'locked';
  unmet?: Unmet[];
}

/** `/campanha` (players) and `/jarvis campanha importar` (staff). Progress = runs ended in `success` (D13). */
export class JarvisCampaigns {
  constructor(
    private readonly ctx: BotContext<JarvisConfig>,
    private readonly s: JarvisServices,
  ) {}

  private t = (key: string, vars: Record<string, string | number>, l: Locale) =>
    this.ctx.i18n.t(key, vars, l);
  private text = (content: string): OutgoingMessage => ({ persona: 'jarvis', content, ephemeral: true });

  /** Campaigns this member can see (recruitment arcs for their own team are hidden), with chapters. */
  private async visible(memberId: string) {
    const rows = (await this.s.repo.allCampaigns()).filter((r) => r.active === 1);
    const campaigns = await this.s.missions.campaigns();
    const missions = await this.s.missions.missions();
    const out: { campaign: Campaign; chapters: ChapterState[] }[] = [];
    for (const row of rows) {
      if (!(await squadContentVisible(this.ctx, row.squadId, memberId))) continue;
      const c = parseCampaign(row);
      const list = chaptersOf(c.id, missions);
      if (!list.length) continue;
      const first = list[0] as Mission;
      if ((await this.s.missions.requirements(memberId, first, campaigns))?.key === 'hidden') continue;
      out.push({ campaign: c, chapters: await this.states(memberId, list, campaigns) });
    }
    return out;
  }

  private async states(memberId: string, list: Mission[], campaigns: Map<string, Campaign>) {
    const facts = await this.s.missions.facts(memberId);
    const out: ChapterState[] = [];
    for (const m of list) {
      if (facts.done.has(m.id)) {
        out.push({ mission: m, state: 'done' });
        continue;
      }
      const b = await this.s.missions.requirements(memberId, m, campaigns);
      if (b?.key === 'requires') out.push({ mission: m, state: 'locked', unmet: b.unmet });
      else if (facts.level < m.minLevel)
        out.push({ mission: m, state: 'locked', unmet: [{ key: 'level', level: m.minLevel }] });
      else out.push({ mission: m, state: 'open' });
    }
    return out;
  }

  private why(c: ChapterState, l: Locale): Promise<string> {
    return this.s.missions.unmetText(c.unmet ?? [], l);
  }

  /** `/campanha [campanha]`. */
  async command(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const member = await this.s.trivia.registered(i, r, l);
    if (!member) return;
    if (!this.ctx.botConfig.missions.enabled)
      return r.reply(this.text(this.t('jarvis.missions.disabled', {}, l)));
    const all = await this.visible(member.id);
    const id = typeof i.options?.campanha === 'string' ? i.options.campanha : '';
    if (id) {
      const one = all.find((x) => x.campaign.id === id);
      if (!one) return r.reply(this.text(this.t('jarvis.campaigns.unknown', {}, l)));
      return r.reply(await this.detail(one.campaign, one.chapters, l));
    }
    if (!all.length) return r.reply(this.text(this.t('jarvis.campaigns.none', {}, l)));
    const fields = [];
    for (const { campaign, chapters } of all.slice(0, 25)) {
      const done = chapters.filter((c) => c.state === 'done').length;
      const next = chapters.find((c) => c.state !== 'done');
      const nextLine = !next
        ? this.t('jarvis.campaigns.complete', {}, l)
        : next.state === 'open'
          ? this.t(
              'jarvis.campaigns.next_open',
              { title: loc(next.mission.title, l), id: next.mission.id },
              l,
            )
          : this.t(
              'jarvis.campaigns.next_locked',
              { title: loc(next.mission.title, l), why: await this.why(next, l) },
              l,
            );
      fields.push({
        name: `${loc(campaign.title, l)} · ${this.t(`jarvis.campaigns.kind.${campaign.kind}`, {}, l)}`.slice(
          0,
          256,
        ),
        value: [
          loc(campaign.summary, l),
          this.t('jarvis.campaigns.progress', { done, total: chapters.length }, l),
          nextLine,
        ]
          .join('\n')
          .slice(0, 1024),
      });
    }
    await r.reply({
      persona: 'jarvis',
      ephemeral: true,
      embeds: [{ title: this.t('jarvis.campaigns.title', {}, l), color: COLOR, fields }],
    });
  }

  private async detail(c: Campaign, chapters: ChapterState[], l: Locale): Promise<OutgoingMessage> {
    const lines = [loc(c.summary, l), ''];
    for (const ch of chapters) {
      const n = ch.mission.campaign?.chapter ?? 0;
      const title = loc(ch.mission.title, l);
      if (ch.state === 'done') lines.push(this.t('jarvis.campaigns.chapter_done', { n, title }, l));
      else if (ch.state === 'open')
        lines.push(this.t('jarvis.campaigns.chapter_open', { n, title, id: ch.mission.id }, l));
      else lines.push(this.t('jarvis.campaigns.chapter_locked', { n, title, why: await this.why(ch, l) }, l));
    }
    const done = chapters.filter((x) => x.state === 'done').length;
    return {
      persona: 'jarvis',
      ephemeral: true,
      embeds: [
        {
          title:
            `${loc(c.title, l)} · ${this.t('jarvis.campaigns.progress', { done, total: chapters.length }, l)}`.slice(
              0,
              256,
            ),
          description: lines.join('\n').slice(0, 4000),
          color: COLOR,
        },
      ],
    };
  }

  async autocomplete(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const q = (i.focused?.value ?? '').toLowerCase();
    const member = await this.ctx.read.members.getByDiscordId(i.userId);
    if (!member) return r.autocomplete([]);
    const out = (await this.visible(member.id))
      .map(({ campaign }) => ({ name: loc(campaign.title, l).slice(0, 100), value: campaign.id }))
      .filter((x) => !q || x.name.toLowerCase().includes(q) || x.value.includes(q));
    await r.autocomplete(out.slice(0, 25));
  }

  // ---------- staff import ----------

  /** Ids shipped with Legion (files, not staff imports) cannot be replaced by an import. */
  private async shippedIds() {
    const missions = (await this.s.repo.allMissions()).filter((m) => m.origin === 'file').map((m) => m.id);
    const campaigns = (await this.s.repo.allCampaigns()).filter((c) => c.origin === 'file').map((c) => c.id);
    return { missions: new Set(missions), campaigns: new Set(campaigns) };
  }

  /** Parses and checks a staged file against the database; returns the file or the errors. */
  private async check(text: string): Promise<{ file: CampaignFile } | { errors: string[] }> {
    const rows = await this.s.repo.allMissions();
    const parsed = parseCampaignYaml(text, {
      factions: this.ctx.config.factions.map((f) => f.key),
      knownMissionIds: new Set(rows.filter((m) => m.active === 1).map((m) => m.id)),
    });
    if ('errors' in parsed) return parsed;
    const shipped = await this.shippedIds();
    const errors: string[] = [];
    if (shipped.campaigns.has(parsed.file.campaign.id))
      errors.push(
        `campaign.id: "${parsed.file.campaign.id}" é uma campanha que vem com o Legion; use outro id`,
      );
    parsed.file.missions.forEach((m, i) => {
      if (shipped.missions.has(m.id))
        errors.push(`missions.${i}.id: "${m.id}" é uma missão que vem com o Legion; use outro id`);
    });
    return errors.length ? { errors } : { file: parsed.file };
  }

  private errors(errors: string[], l: Locale) {
    const shown = errors.slice(0, 15).map((e) => `• ${e}`);
    if (errors.length > 15) shown.push(`… +${errors.length - 15}`);
    return this.t('jarvis.imports.invalid', { errors: shown.join('\n') }, l).slice(0, 1900);
  }

  private preview(f: CampaignFile, l: Locale, note?: string) {
    const chapters = chaptersOf(f.campaign.id, f.missions)
      .map((m) => `${m.campaign?.chapter}. ${loc(m.title, l)} (\`${m.id}\`)`)
      .join('\n');
    const lines = [
      loc(f.campaign.summary, l),
      '',
      this.t(
        'jarvis.campaigns.import_meta',
        {
          id: f.campaign.id,
          kind: this.t(`jarvis.campaigns.kind.${f.campaign.kind}`, {}, l),
          chapters: f.missions.length,
        },
        l,
      ),
      chapters,
    ];
    if (note) lines.push('', note);
    return {
      title: `${this.t('jarvis.imports.preview', {}, l)}: ${loc(f.campaign.title, l)}`.slice(0, 256),
      description: lines.join('\n').slice(0, 4000),
      color: COLOR,
    };
  }

  /** `/jarvis campanha importar arquivo` (staff checked by the command). */
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
    const checked = await this.check(got.text);
    if ('errors' in checked) return r.reply(this.text(this.errors(checked.errors, l)));
    const stageId = this.ctx.newId();
    await this.ctx.kv.set(stageKey(stageId), { text: got.text, staffId: i.userId } satisfies Staged);
    const prev = await this.s.repo.campaign(checked.file.campaign.id);
    await r.reply({
      persona: 'jarvis',
      ephemeral: true,
      embeds: [
        this.preview(
          checked.file,
          l,
          prev ? this.t('jarvis.imports.replaces', { id: checked.file.campaign.id }, l) : undefined,
        ),
      ],
      components: [
        [
          {
            type: 'button',
            customId: campaignImportIds.decide(stageId, 'publish'),
            label: this.t('jarvis.imports.publish', {}, l),
            style: 'success',
          },
          {
            type: 'button',
            customId: campaignImportIds.decide(stageId, 'cancel'),
            label: this.t('jarvis.imports.cancel', {}, l),
            style: 'secondary',
          },
        ],
      ],
    });
  }

  /** Publicar / Cancelar. Everything is written in one transaction (all or nothing). */
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
    // Re-check: the database may have changed since the preview.
    const checked = await this.check(staged.text);
    if ('errors' in checked)
      return r.update({ ...this.text(this.errors(checked.errors, l)), embeds: [], components: [] });
    const f = checked.file;
    const now = this.ctx.clock.now().toISOString();
    const staff = { active: 1, updatedAt: now, origin: 'staff', importedBy: i.userId, disabledBy: null };
    const ct = this.s.repo.t.jarvisCampaigns;
    const mt = this.s.repo.t.jarvisMissions;
    await this.ctx.db.transaction(async (tx) => {
      const c = { ...campaignColumns(f.campaign), ...staff };
      await tx
        .insert(ct)
        .values({ id: f.campaign.id, ...c })
        .onConflictDoUpdate({ target: ct.id, set: c });
      for (const m of f.missions) {
        const row = { ...missionColumns(m), ...staff };
        await tx
          .insert(mt)
          .values({ id: m.id, ...row })
          .onConflictDoUpdate({ target: mt.id, set: row });
      }
    });
    this.ctx.log.info(
      { staff: i.userId, campaignId: f.campaign.id, missions: f.missions.map((m) => m.id) },
      'campaign imported',
    );
    await r.update({
      ...this.text(this.t('jarvis.campaigns.published', { id: f.campaign.id, n: f.missions.length }, l)),
      embeds: [this.preview(f, l)],
      components: [],
    });
  }
}
