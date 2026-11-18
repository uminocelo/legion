import {
  type ActionRow,
  customId,
  type Embed,
  type I18n,
  type Locale,
  type Modal,
  mentionOnly,
  type OutgoingMessage,
} from '@legion/core';
import type { CerebroConfig } from './config.js';
import type { MemberRow, MutantRow } from './db/repo.js';

/** Custom-id actions (version 1). Bump the version when an action's args change. */
export const V = 1;
export const ids = {
  start: () => customId('cerebro', V, 'start'),
  rules: () => customId('cerebro', V, 'rules'),
  /** Before v0.9: old faction menus still answer with the member's current screen. */
  faction: () => customId('cerebro', V, 'faction'),
  origin: () => customId('cerebro', V, 'origin'),
  originBack: () => customId('cerebro', V, 'oback'),
  rechoose: () => customId('cerebro', V, 'rorigin'),
  rechooseCancel: () => customId('cerebro', V, 'rcancel'),
  archetype: () => customId('cerebro', V, 'archetype'),
  reopen: () => customId('cerebro', V, 'reopen'),
  mutant: () => customId('cerebro', V, 'mutant'),
  optin: (roleKey: string) => customId('cerebro', V, 'optin', roleKey),
  share: (memberId: string) => customId('cerebro', V, 'share', memberId),
};

export const channelMention = (id: string | null, fallback: string) => (id ? `<#${id}>` : fallback);

/** Builds Cérebro's messages; all text comes from the locale files. */
export class CerebroUi {
  constructor(
    private readonly i18n: I18n,
    private readonly cfg: CerebroConfig,
    private readonly shared: {
      channels: { welcome: string | null; rules: string | null };
      factions: { key: string; emoji: string }[];
    },
  ) {}

  private t = (key: string, vars: Record<string, string | number> = {}, locale?: Locale) =>
    this.i18n.t(`cerebro.${key}`, vars, locale);

  welcome(userId: string | null, locale?: Locale): OutgoingMessage {
    const ping = Boolean(userId && this.cfg.welcomePing);
    return {
      persona: 'cerebro',
      ...(ping && userId ? { content: `<@${userId}>`, allowedMentions: mentionOnly(userId) } : {}),
      embeds: [
        {
          title: this.t('welcome.title', {}, locale),
          description: userId
            ? this.t('welcome.body', { mention: `<@${userId}>` }, locale)
            : this.t('welcome.persistent_body', {}, locale),
        },
      ],
      components: [
        [
          {
            type: 'button',
            customId: ids.start(),
            label: this.t('welcome.start_button', {}, locale),
            style: 'primary',
            emoji: '🧬',
          },
        ],
      ],
    };
  }

  welcomeBack(codename: string): OutgoingMessage {
    return { persona: 'cerebro', content: this.t('welcome.back', { codename }) };
  }

  rules(locale: Locale, prefix?: string): OutgoingMessage {
    const link = this.t(
      'rules.link',
      { channel: channelMention(this.shared.channels.rules, '#regras') },
      locale,
    );
    return {
      persona: 'cerebro',
      ephemeral: true,
      ...(prefix ? { content: prefix } : {}),
      embeds: [
        {
          title: this.t('rules.title', {}, locale),
          description: `${this.t('rules.summary', {}, locale)}\n\n${link}`,
        },
      ],
      components: [
        [
          {
            type: 'button',
            customId: ids.rules(),
            label: this.t('rules.accept_button', {}, locale),
            style: 'success',
            emoji: '✅',
          },
        ],
      ],
    };
  }

  /** The origin menu (registration, or `/heroi origem` with a cancel button). */
  origin(
    locale: Locale,
    origins: { key: string; emoji: string }[],
    current: string | null,
    prefix?: string,
    rechoice = false,
  ): OutgoingMessage {
    const rows: ActionRow[] = [
      [
        {
          type: 'select',
          customId: rechoice ? ids.rechoose() : ids.origin(),
          placeholder: this.t('origin_step.placeholder', {}, locale),
          options: origins.map((o) => ({
            value: o.key,
            label: this.t(`origin.${o.key}.name`, {}, locale),
            description: this.t(`origin.${o.key}.description`, {}, locale).slice(0, 100),
            ...(o.emoji ? { emoji: o.emoji } : {}),
            default: o.key === current,
          })),
        },
      ],
    ];
    if (rechoice)
      rows.push([
        {
          type: 'button',
          customId: ids.rechooseCancel(),
          label: this.t('origin_change.cancel', {}, locale),
          style: 'secondary',
        },
      ]);
    const key = rechoice ? 'origin_change' : 'origin_step';
    return {
      persona: 'cerebro',
      ephemeral: true,
      ...(prefix ? { content: prefix } : {}),
      embeds: [{ title: this.t(`${key}.title`, {}, locale), description: this.t(`${key}.body`, {}, locale) }],
      components: rows,
    };
  }

  /** "🤖 Tecnologia" (with emoji) or "Tecnologia" (plain, for the card). */
  originName(key: string, locale?: Locale): string {
    return this.t(`origin.${key}.name`, {}, locale);
  }
  originLabel(key: string, locale?: Locale): string {
    const emoji = this.cfg.origins.find((o) => o.key === key)?.emoji;
    return `${emoji ? `${emoji} ` : ''}${this.originName(key, locale)}`;
  }

  archetype(locale: Locale, current: string | null, prefix?: string): OutgoingMessage {
    const rows: ActionRow[] = [
      [
        {
          type: 'select',
          customId: ids.archetype(),
          placeholder: this.t('archetype.placeholder', {}, locale),
          options: this.cfg.archetypes.map((a) => ({
            value: a,
            label: a,
            description: this.t(`archetype.${a}`, {}, locale),
            default: a === current,
          })),
        },
      ],
    ];
    if (current)
      rows.push([
        {
          type: 'button',
          customId: ids.reopen(),
          label: this.t('archetype.reopen_button', {}, locale),
          style: 'primary',
          emoji: '📝',
        },
      ]);
    return {
      persona: 'cerebro',
      ephemeral: true,
      ...(prefix ? { content: prefix } : {}),
      embeds: [
        { title: this.t('archetype.title', {}, locale), description: this.t('archetype.body', {}, locale) },
      ],
      components: rows,
    };
  }

  mutantModal(locale: Locale): Modal {
    return {
      customId: ids.mutant(),
      title: this.t('modal.title', {}, locale),
      inputs: [
        {
          customId: 'codinome',
          label: this.t('modal.codename', {}, locale),
          style: 'short',
          minLength: this.cfg.codename.min,
          maxLength: this.cfg.codename.max,
          placeholder: this.t('modal.codename_placeholder', {}, locale),
        },
        {
          customId: 'poder',
          label: this.t('modal.power', {}, locale),
          style: 'short',
          maxLength: 100,
          placeholder: this.t('modal.power_placeholder', {}, locale),
        },
        {
          customId: 'origem',
          label: this.t('modal.origin', {}, locale),
          style: 'paragraph',
          maxLength: 300,
          placeholder: this.t('modal.origin_placeholder', {}, locale),
        },
      ],
    };
  }

  /** Ephemeral error with a button that reopens the modal. */
  modalError(locale: Locale, message: string): OutgoingMessage {
    return {
      persona: 'cerebro',
      ephemeral: true,
      content: message,
      components: [
        [
          {
            type: 'button',
            customId: ids.reopen(),
            label: this.t('archetype.reopen_button', {}, locale),
            style: 'primary',
            emoji: '📝',
          },
        ],
      ],
    };
  }

  text(content: string): OutgoingMessage {
    return { persona: 'cerebro', ephemeral: true, content };
  }

  optIns(locale: Locale, current: readonly string[], header?: Embed): OutgoingMessage {
    const buttons = this.cfg.optInRoles.map((key) => ({
      type: 'button' as const,
      customId: ids.optin(key),
      label: `${current.includes(key) ? '✅' : '⬜'} ${this.t(`optins.${key}`, {}, locale)}`,
      style: current.includes(key) ? ('success' as const) : ('secondary' as const),
    }));
    const rows: ActionRow[] = [];
    for (let i = 0; i < buttons.length; i += 5) rows.push(buttons.slice(i, i + 5));
    return {
      persona: 'cerebro',
      ephemeral: true,
      embeds: [
        ...(header ? [header] : []),
        { title: this.t('optins.title', {}, locale), description: this.t('optins.body', {}, locale) },
      ],
      components: rows,
    };
  }

  registeredEmbed(locale: Locale, codename: string): Embed {
    return {
      title: this.t('registered.title', {}, locale),
      description: this.t('registered.body', { codename }, locale),
    };
  }

  factionLabel(key: string | null, locale?: Locale): string {
    if (!key) return '—';
    const f = this.shared.factions.find((x) => x.key === key);
    return `${f?.emoji ? `${f.emoji} ` : ''}${this.t(`faction.${key}.name`, {}, locale)}`;
  }

  publicRegistryCard(member: MemberRow, mutant: MutantRow): OutgoingMessage {
    return {
      persona: 'cerebro',
      embeds: [
        {
          title: this.t('registered.public_title'),
          description: this.t('registered.public_body', { codename: mutant.codename }),
          fields: [
            { name: this.t('profile.origin_type'), value: this.originLabel(mutant.originType), inline: true },
            { name: this.t('profile.archetype'), value: mutant.archetype, inline: true },
            { name: this.t('profile.faction'), value: this.factionLabel(member.faction), inline: true },
          ],
        },
      ],
    };
  }

  profileEmbed(
    member: MemberRow,
    mutant: MutantRow,
    locale: Locale | undefined,
    extra: Embed['fields'] = [],
    powers: string | null = null,
  ): Embed {
    return {
      title: this.t(
        'profile.title',
        {
          codename: mutant.codename,
          emoji: this.cfg.origins.find((x) => x.key === mutant.originType)?.emoji ?? '🦸',
        },
        locale,
      ),
      description: `<@${member.discordUserId}>`,
      fields: [
        {
          name: this.t('profile.origin_type', {}, locale),
          value: this.originLabel(mutant.originType, locale),
          inline: true,
        },
        { name: this.t('profile.archetype', {}, locale), value: mutant.archetype, inline: true },
        {
          name: this.t('profile.faction', {}, locale),
          value: this.factionLabel(member.faction, locale),
          inline: true,
        },
        {
          name: this.t('profile.rank', {}, locale),
          value: this.t(`ranks.${member.rank}`, {}, locale),
          inline: true,
        },
        ...(powers ? [{ name: this.t('profile.powers', {}, locale), value: powers }] : []),
        {
          name: this.t(powers ? 'profile.power_description' : 'profile.power', {}, locale),
          value: mutant.power,
        },
        { name: this.t('profile.story', {}, locale), value: mutant.origin },
        ...(extra ?? []),
      ],
    };
  }

  profile(
    member: MemberRow,
    mutant: MutantRow,
    locale: Locale,
    extra: Embed['fields'] = [],
    powers: string | null = null,
  ): OutgoingMessage {
    return {
      persona: 'cerebro',
      ephemeral: true,
      embeds: [this.profileEmbed(member, mutant, locale, extra, powers)],
      components: [
        [
          {
            type: 'button',
            customId: ids.share(member.id),
            label: this.t('profile.share_button', {}, locale),
            style: 'secondary',
            emoji: '📣',
          },
        ],
      ],
    };
  }
}
