import { type Archetype, isArchetype, type Locale, type OutgoingFile, playerStats } from '@legion/core';
import { type CardData, renderCard } from './card.js';
import type { MemberRow, MutantRow } from './db/repo.js';
import type { CerebroFlow } from './flow.js';

export const CARD_FILE = 'ficha.png';

/** Builds the sheet data (level, stats, powers) and the PNG card for a mutant. */
export class SheetCard {
  constructor(private readonly flow: CerebroFlow) {}

  private get ctx() {
    return this.flow.ctx;
  }
  private t(key: string, locale?: Locale) {
    return this.ctx.i18n.t(`cerebro.${key}`, {}, locale);
  }

  /** The faction role color from `roles` (`#RRGGBB`), or null. */
  factionColor(faction: string | null): string | null {
    const roleKey = this.flow.factionRoleKey(faction);
    const color = this.ctx.config.roles.find((r) => r.key === roleKey)?.color;
    return typeof color === 'string' ? color : null;
  }

  async data(member: MemberRow, mutant: MutantRow, locale?: Locale): Promise<CardData> {
    const progress = await this.ctx.read.progress.get(member.id).catch(() => null);
    const archetype: Archetype = isArchetype(mutant.archetype) ? mutant.archetype : 'Metamorfo';
    const powers = await this.flow.repo.powersOf(mutant.id);
    return {
      codename: mutant.codename,
      origin: this.flow.ui.originName(mutant.originType, locale),
      faction: this.flow.ui.factionLabel(member.faction, locale),
      factionColor: this.factionColor(member.faction),
      archetype: mutant.archetype,
      rank: this.t(`ranks.${progress?.rank ?? member.rank}`, locale),
      level: progress?.level ?? null,
      xp: progress?.xp ?? null,
      powers: {
        main: powers.main ? this.flow.powers.label(powers.main, locale) : null,
        secondary: powers.secondary.map((id) => this.flow.powers.label(id, locale)),
      },
      description: mutant.power,
      stats: playerStats(
        archetype,
        Math.max(1, progress?.level ?? 1),
        await this.ctx.read.gear.bonusOf(member.id).catch(() => undefined),
        this.ctx.read.gear.statCap(),
      ),
      labels: {
        title: this.t('card.title', locale),
        level: this.t('card.level', locale),
        powers: this.t('card.powers', locale),
        stats: {
          hp: this.t('card.hp', locale),
          atk: this.t('card.atk', locale),
          def: this.t('card.def', locale),
          spd: this.t('card.spd', locale),
          foc: this.t('card.foc', locale),
        },
      },
    };
  }

  /** The PNG card, or null when turned off or rendering failed (the embed still goes out). */
  async file(member: MemberRow, mutant: MutantRow, locale?: Locale): Promise<OutgoingFile | null> {
    if (!this.ctx.botConfig.profileCard) return null;
    try {
      return { name: CARD_FILE, content: await renderCard(await this.data(member, mutant, locale)) };
    } catch (err) {
      this.ctx.log.warn({ err, mutantId: mutant.id }, 'could not render the profile card');
      return null;
    }
  }
}
