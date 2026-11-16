import type { BotId, Locale } from '../config/schema.js';
import type { EmbedField } from '../discord/types.js';

export interface HelpEntry {
  bot: BotId;
  command: string;
  descriptionKey: string;
  adminOnly: boolean;
}

/** Bots register their commands here; H.E.R.B.I.E. renders `/ajuda` from it. */
export class HelpRegistry {
  private readonly entries: HelpEntry[] = [];

  add(entry: Omit<HelpEntry, 'adminOnly'> & { adminOnly?: boolean }): void {
    if (this.entries.some((e) => e.command === entry.command)) return;
    this.entries.push({ adminOnly: false, ...entry });
  }

  list(opts: { includeAdmin?: boolean; bots?: readonly BotId[] } = {}): HelpEntry[] {
    return this.entries.filter(
      (e) => (opts.includeAdmin || !e.adminOnly) && (!opts.bots || opts.bots.includes(e.bot)),
    );
  }
}

export interface ProfileSubject {
  memberId: string;
  discordUserId: string;
}
export type ProfileSection = (subject: ProfileSubject, locale: Locale) => Promise<EmbedField[]>;

/** Bots add embed fields to `/perfil` (rendered by Cérebro). */
export class ProfileRegistry {
  private readonly sections: { bot: BotId; section: ProfileSection }[] = [];

  add(bot: BotId, section: ProfileSection): void {
    this.sections.push({ bot, section });
  }

  /** Fields from every section; a failing section is skipped so the profile still renders. */
  async render(subject: ProfileSubject, locale: Locale, onError?: (bot: BotId, err: unknown) => void) {
    const fields: EmbedField[] = [];
    for (const { bot, section } of this.sections) {
      try {
        fields.push(...(await section(subject, locale)));
      } catch (err) {
        onError?.(bot, err);
      }
    }
    return fields;
  }
}
