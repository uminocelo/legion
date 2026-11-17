import type {
  BotContext,
  BotId,
  IncomingInteraction,
  LegionEvent,
  Locale,
  OutgoingMessage,
  Responder,
} from '@legion/core';
import { customId } from '@legion/core';
import type { HerbieConfig } from './config.js';
import { fold, type GlossaryEntry, glossarySchema, loadLocalized, type Tip, tipsSchema } from './content.js';
import type { HerbieRepo } from './db/repo.js';
import { nextTip, searchGlossary } from './domain/search.js';
import type { HerbieTutorial } from './tutorial.js';
import { tutorialIds, V } from './tutorial.js';

const LOCALES: Locale[] = ['pt-BR', 'en'];
const PAGE = 8;
export const helpIds = { glossary: (page: number) => customId('herbie', V, 'glossary', page) };

/** /ajuda, /regras, /idioma, tips and world-event explanations. */
export class HerbieHelp {
  private glossary = new Map<Locale, GlossaryEntry[]>();
  private tips = new Map<Locale, Tip[]>();

  constructor(
    private readonly ctx: BotContext<HerbieConfig>,
    private readonly repo: HerbieRepo,
    private readonly tutorial: HerbieTutorial,
  ) {}

  private t = (k: string, v: Record<string, string | number>, l: Locale) => this.ctx.i18n.t(k, v, l);
  private on = (bot?: BotId) => !bot || this.ctx.config.bots.includes(bot);

  /** Loads glossary and tips (in memory, for fast autocomplete). Invalid files keep what was loaded. */
  reload(serverDir?: string): string[] {
    const errors: string[] = [];
    for (const l of LOCALES) {
      const g = loadLocalized('glossary', l, glossarySchema, serverDir);
      const tp = loadLocalized('tips', l, tipsSchema, serverDir);
      const gv = g.value ?? this.glossary.get(l) ?? g.bundled;
      const tv = tp.value ?? this.tips.get(l) ?? tp.bundled;
      if (gv) this.glossary.set(l, gv);
      if (tv) this.tips.set(l, tv);
      errors.push(...g.errors, ...tp.errors);
    }
    if (errors.length) this.ctx.log.warn({ errors }, 'help content has errors; keeping the previous version');
    return errors;
  }

  /** Entries for enabled bots, in the member's language (falls back to the server language). */
  entries(l: Locale): GlossaryEntry[] {
    const list = this.glossary.get(l) ?? this.glossary.get(this.ctx.config.locale) ?? [];
    return list.filter((e) => this.on(e.bot));
  }

  private find(l: Locale, key: string): GlossaryEntry | null {
    const k = fold(key);
    return (
      this.entries(l).find(
        (e) => e.id === key || fold(e.term) === k || e.aliases.some((a) => fold(a) === k),
      ) ?? null
    );
  }

  private entryEmbed(e: GlossaryEntry, l: Locale): OutgoingMessage {
    const related = e.related.map((id) => this.entries(l).find((x) => x.id === id)?.term).filter(Boolean);
    return {
      persona: 'herbie',
      ephemeral: true,
      embeds: [
        {
          title: `📖 ${e.term}`,
          description: [
            `**${e.summary}**`,
            '',
            e.details,
            ...(related.length
              ? ['', this.t('herbie.glossary.related', { terms: related.join(', ') }, l)]
              : []),
          ].join('\n'),
        },
      ],
    };
  }

  // ---------- /regras ----------

  async regras(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const termo = typeof i.options?.termo === 'string' ? i.options.termo : '';
    if (termo) {
      const e = this.find(l, termo) ?? searchGlossary(this.entries(l), termo, 1)[0];
      if (e) return r.reply(this.entryEmbed(e, l));
      return r.reply({
        persona: 'herbie',
        ephemeral: true,
        content: this.t('herbie.glossary.not_found', { term: termo.slice(0, 60) }, l),
      });
    }
    const rules = this.ctx.config.channels.rules;
    return r.reply({
      persona: 'herbie',
      ephemeral: true,
      embeds: [
        {
          title: this.t('cerebro.rules.title', {}, l),
          description: [
            this.t('cerebro.rules.summary', {}, l),
            ...(rules ? ['', this.t('cerebro.rules.link', { channel: `<#${rules}>` }, l)] : []),
          ].join('\n'),
        },
      ],
      components: [
        [
          {
            type: 'button',
            customId: helpIds.glossary(0),
            label: this.t('herbie.help.glossary_button', {}, l),
            style: 'secondary',
            emoji: '📖',
          },
        ],
      ],
    });
  }

  async regrasAutocomplete(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const hits = searchGlossary(this.entries(l), i.focused?.value ?? '', 25);
    await r.autocomplete(hits.map((e) => ({ name: e.term.slice(0, 100), value: e.id })));
  }

  /** Paginated glossary (button). */
  async glossaryPage(i: IncomingInteraction, r: Responder, page: number): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const all = this.entries(l);
    const pages = Math.max(1, Math.ceil(all.length / PAGE));
    const p = Math.min(Math.max(0, Number.isFinite(page) ? page : 0), pages - 1);
    const lines = all.slice(p * PAGE, (p + 1) * PAGE).map((e) => `**${e.term}** — ${e.summary}`);
    const nav = [
      {
        type: 'button' as const,
        customId: helpIds.glossary(p - 1),
        label: '◀',
        style: 'secondary' as const,
        disabled: p === 0,
      },
      {
        type: 'button' as const,
        customId: helpIds.glossary(p + 1),
        label: '▶',
        style: 'secondary' as const,
        disabled: p >= pages - 1,
      },
    ];
    const msg: OutgoingMessage = {
      persona: 'herbie',
      ephemeral: true,
      embeds: [
        {
          title: this.t('herbie.glossary.title', { page: p + 1, pages }, l),
          description: lines.join('\n\n'),
          footer: { text: this.t('herbie.glossary.footer', {}, l) },
        },
      ],
      components: [nav],
    };
    // Always opened from a button (/ajuda, /regras or the glossary itself): update that message in place.
    return r.update(msg);
  }

  // ---------- /ajuda ----------

  async ajuda(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const topico = typeof i.options?.topico === 'string' ? i.options.topico : '';
    if (topico) {
      const e = this.find(l, topico);
      if (e) return r.reply(this.entryEmbed(e, l));
      const cmd = this.ctx.help
        .list({ bots: this.ctx.config.bots })
        .find((h) => fold(h.command.replace('/', '')) === fold(topico.replace('/', '')));
      if (cmd)
        return r.reply({
          persona: 'herbie',
          ephemeral: true,
          embeds: [{ title: cmd.command, description: this.t(cmd.descriptionKey, {}, l) }],
        });
      return r.reply({
        persona: 'herbie',
        ephemeral: true,
        content: this.t('herbie.glossary.not_found', { term: topico.slice(0, 60) }, l),
      });
    }
    const staff = await this.ctx.isStaff(i);
    const now = await this.nowSection(i.userId, l);
    const groups = new Map<BotId, string[]>();
    for (const h of this.ctx.help.list({ includeAdmin: staff, bots: this.ctx.config.bots })) {
      const list = groups.get(h.bot) ?? [];
      list.push(`\`${h.command}\` — ${this.t(h.descriptionKey, {}, l)}`);
      groups.set(h.bot, list);
    }
    const fields = [...groups.entries()].map(([bot, lines]) => ({
      name: this.t(`core.personas.${bot}`, {}, l),
      value: lines.join('\n').slice(0, 1024),
    }));
    return r.reply({
      persona: 'herbie',
      ephemeral: true,
      embeds: [{ title: this.t('herbie.help.title', {}, l), description: now, fields }],
      components: [
        [
          {
            type: 'button',
            customId: tutorialIds.show(),
            label: this.t('herbie.help.tutorial_button', {}, l),
            style: 'primary',
            emoji: '📋',
          },
          {
            type: 'button',
            customId: helpIds.glossary(0),
            label: this.t('herbie.help.glossary_button', {}, l),
            style: 'secondary',
            emoji: '📖',
          },
        ],
      ],
    });
  }

  /** "What to do now": not registered → how to register; tutorial in progress → current step; else suggestions. */
  private async nowSection(discordUserId: string, l: Locale): Promise<string> {
    const m = await this.ctx.read.members.getByDiscordId(discordUserId);
    if (m?.onboardingStep !== 'registered' || m.leftAt) {
      const welcome = this.ctx.config.channels.welcome;
      return this.t(
        'herbie.help.now_unregistered',
        { welcome: welcome ? `<#${welcome}>` : '#boas-vindas' },
        l,
      );
    }
    const step = await this.tutorial.currentFor(m.id);
    if (step)
      return this.t(
        'herbie.help.now_tutorial',
        { step: this.t(step.titleKey, {}, l), body: this.t(step.bodyKey, {}, l) },
        l,
      );
    const tips: string[] = [];
    if (this.ctx.config.bots.includes('jarvis')) {
      tips.push(this.t('herbie.help.suggest_trivia', {}, l));
      const p = await this.ctx.read.progress.get(m.id);
      if (p && p.currentStreak > 0)
        tips.push(this.t('herbie.help.suggest_streak', { days: p.currentStreak }, l));
    }
    tips.push(this.t('herbie.help.suggest_regras', {}, l));
    return [this.t('herbie.help.now_free', {}, l), ...tips.map((x) => `• ${x}`)].join('\n');
  }

  async ajudaAutocomplete(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const q = i.focused?.value ?? '';
    const terms = searchGlossary(this.entries(l), q, 25).map((e) => ({ name: e.term, value: e.id }));
    const cmds = this.ctx.help
      .list({ bots: this.ctx.config.bots })
      .filter((h) => fold(h.command).includes(fold(q)))
      .map((h) => ({ name: h.command, value: h.command }));
    await r.autocomplete([...cmds, ...terms].slice(0, 25));
  }

  // ---------- /idioma ----------

  async idioma(i: IncomingInteraction, r: Responder): Promise<void> {
    const chosen = i.options?.idioma === 'en' ? 'en' : 'pt-BR';
    const m = await this.ctx.read.members.getByDiscordId(i.userId);
    if (!m) {
      const l = await this.ctx.i18n.localeFor(i.userId);
      return r.reply({
        persona: 'herbie',
        ephemeral: true,
        content: this.t('herbie.language.unknown_member', {}, l),
      });
    }
    await this.repo.setLocale(m.id, chosen);
    await r.reply({
      persona: 'herbie',
      ephemeral: true,
      content: this.t('herbie.language.saved', {}, chosen),
    });
  }

  /** Core i18n asks this for every ephemeral reply; public messages keep config.locale. */
  localeResolver = async (discordUserId: string): Promise<Locale | null> => {
    const m = await this.ctx.read.members.getByDiscordId(discordUserId);
    const v = m ? await this.repo.locale(m.id) : null;
    return v === 'en' || v === 'pt-BR' ? v : null;
  };

  // ---------- world events ----------

  async onWorldEvent(e: LegionEvent<'world.event'>): Promise<void> {
    const p = e.payload;
    const channel = this.ctx.config.channels.events;
    if (!this.ctx.botConfig.explainWorldEvents || p.phase !== 'announced' || !channel) return;
    if (!(await this.repo.claimWorldEvent(p.worldEventId))) return;
    const l = this.ctx.config.locale;
    const sent = await this.ctx.gateway.sendMessage(channel, {
      persona: 'herbie',
      embeds: [
        {
          title: this.t(`herbie.world.${p.kind}.title`, { title: p.title }, l),
          description: this.t(`herbie.world.${p.kind}.body`, {}, l),
        },
      ],
    });
    await this.repo.setWorldEventMessage(p.worldEventId, sent.messageId);
  }

  // ---------- tips ----------

  tipsFor(l: Locale): Tip[] {
    return (this.tips.get(l) ?? []).filter((t) => this.on(t.bot));
  }

  /** Posts the next tip in rotation; returns its id, or null when there is nothing to post. */
  async postTip(): Promise<string | null> {
    const channel = this.ctx.botConfig.tips.channelId;
    if (!channel) {
      this.ctx.log.warn('herbie.tips.channelId is not set; no tip posted');
      return null;
    }
    const l = this.ctx.config.locale;
    const next = nextTip(this.tipsFor(l), await this.repo.tipLog());
    if (!next) return null;
    await this.ctx.gateway.sendMessage(channel, {
      persona: 'herbie',
      embeds: [{ title: this.t('herbie.tips.title', {}, l), description: next.tip.text }],
    });
    await this.repo.logTip(next.tip.id, next.cycle);
    return next.tip.id;
  }
}
