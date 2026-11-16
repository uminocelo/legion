import type { BotId, Locale } from '../config/schema.js';
import type { I18n } from '../i18n/i18n.js';
import type { AllowedMentions, OutgoingMessage } from './types.js';

export const PERSONA_COLORS: Record<BotId, number> = {
  cerebro: 0x8e44ad,
  jarvis: 0x00a8ff,
  herbie: 0xf39c12,
  sentinel: 0x95a5a6,
  ultron: 0xc0392b,
};

/** Safe default: nobody is pinged unless a caller lists them. */
export const NO_MENTIONS: AllowedMentions = { parse: [] };

/** Mentions only the addressed member. */
export const mentionOnly = (userId: string): AllowedMentions => ({ parse: [], users: [userId] });

/** Fills persona author/color/footer on every embed and enforces safe mentions. */
export function applyPersona(msg: OutgoingMessage, i18n: I18n, locale: Locale): OutgoingMessage {
  const embeds = msg.embeds?.map((e) => ({
    ...e,
    color: e.color ?? PERSONA_COLORS[msg.persona],
    author: e.author ?? { name: i18n.t(`core.personas.${msg.persona}`, {}, locale) },
    footer: e.footer ?? { text: i18n.t('core.personas.footer', {}, locale) },
  }));
  const allowed = msg.allowedMentions ?? NO_MENTIONS;
  // Never allow @everyone/@here, whatever the caller asked for.
  const parse = (allowed.parse ?? []).filter((p) => p !== 'everyone');
  return { ...msg, ...(embeds ? { embeds } : {}), allowedMentions: { ...allowed, parse } };
}
