import {
  type BotContext,
  type Combatant,
  type IncomingInteraction,
  isArchetype,
  type LegionEvent,
  playerStats,
  type Responder,
} from '@legion/core';
import type { Difficulty, UltronConfig } from './config.js';
import { enemyFiles, readEnemies } from './content.js';
import type { UltronRepo } from './db/repo.js';
import { adaptiveMultiplier, buildEnemies } from './domain/scaling.js';
import type { FlavorText } from './flavor.js';

export const playerCombatantId = (memberId: string) => `player:${memberId}`;

/** Turns combat missions (and /ultron spawn) into scaled fights that Sentinel resolves. */
export class EncounterService {
  constructor(
    private readonly ctx: BotContext<UltronConfig>,
    private readonly repo: UltronRepo,
    private readonly flavor: FlavorText,
  ) {}

  private get cfg() {
    return this.ctx.botConfig;
  }

  /** Loads enemy files into the DB. Errors keep the previous content. */
  async loadContent(files = enemyFiles()): Promise<{ errors: string[]; total: number }> {
    const { enemies, errors } = readEnemies(files);
    if (errors.length) {
      this.ctx.log.warn({ errors }, 'enemy content has errors; keeping the previous enemies');
      return { errors, total: (await this.repo.templates()).length };
    }
    const r = await this.repo.syncTemplates(enemies);
    if (r.added || r.updated || r.deactivated) this.ctx.log.info(r, 'enemy templates synced');
    return { errors, total: enemies.length };
  }

  async currentAdaptive(): Promise<{ multiplier: number; sample: number }> {
    const a = this.cfg.adaptive;
    if (!a.enabled) return { multiplier: 1, sample: 0 };
    const outcomes = await this.repo.recentPartyOutcomes(a.windowCombats);
    return { multiplier: adaptiveMultiplier(outcomes, a), sample: outcomes.length };
  }

  /** Player combatants from members' mutants and levels. Unknown members are skipped. */
  async playerCombatants(memberIds: string[]): Promise<Combatant[]> {
    const out: Combatant[] = [];
    for (const memberId of [...new Set(memberIds)]) {
      const member = await this.ctx.read.members.getById(memberId);
      if (!member) continue;
      const mutant = await this.ctx.read.mutants.getByMemberId(memberId);
      const level = (await this.ctx.read.progress.get(memberId))?.level ?? 1;
      const archetype = mutant && isArchetype(mutant.archetype) ? mutant.archetype : 'Elemental';
      out.push({
        id: playerCombatantId(memberId),
        side: 'players',
        kind: 'player',
        refId: memberId,
        name: mutant?.codename ?? 'Mutante',
        archetype,
        level,
        stats: playerStats(
          archetype,
          level,
          await this.ctx.read.gear.bonusOf(memberId),
          this.ctx.read.gear.statCap(),
        ),
        powerCooldown: 0,
      });
    }
    return out;
  }

  /**
   * Creates the encounter and emits `combat.requested` in one transaction. Returns null when the mission
   * already had one (duplicate delivery).
   */
  async spawn(o: {
    missionId: string | null;
    memberIds: string[];
    partyLevel?: number;
    difficulty: Difficulty;
    channelId: string;
    requestedByUserId?: string | null;
  }): Promise<{ encounterId: string; combatId: string; enemies: Combatant[]; seed: number } | null> {
    if (o.missionId && (await this.repo.encounterByMission(o.missionId))) return null;
    const players = await this.playerCombatants(o.memberIds.slice(0, 4));
    if (players.length === 0) throw new Error('no known members for the encounter');
    const partyLevel =
      o.partyLevel ?? Math.max(1, Math.round(players.reduce((a, p) => a + p.level, 0) / players.length));
    const templates = await this.repo.templates();
    const { multiplier } = await this.currentAdaptive();
    const encounterId = this.ctx.newId();
    const combatId = this.ctx.newId();
    const seed = this.ctx.random.seed();
    const enemies = buildEnemies(
      {
        encounterId,
        partyLevel,
        partySize: players.length,
        difficulty: o.difficulty,
        templates,
        seed,
        adaptiveMultiplier: multiplier,
      },
      this.cfg.scaling,
    );
    const created = await this.ctx.bus.transaction(async (tx) => {
      const ok = await this.repo.insertEncounter(
        {
          id: encounterId,
          missionId: o.missionId,
          combatId,
          seed,
          partyLevel,
          partySize: players.length,
          difficulty: o.difficulty,
          adaptiveMultiplier: multiplier,
          enemies: JSON.stringify(enemies),
          requestedByUserId: o.requestedByUserId ?? null,
        },
        tx,
      );
      if (!ok) return false;
      await this.ctx.bus.emit(tx, 'combat.requested', {
        combatId,
        requestedBy: 'ultron',
        mode: players.length === 1 ? 'duel' : 'party',
        missionId: o.missionId,
        raidId: null,
        channelId: o.channelId,
        participants: [...players, ...enemies],
        maxRounds: this.cfg.combat.maxRounds,
      });
      return true;
    });
    if (!created) return null;
    await this.taunt(o.channelId, enemies, seed);
    return { encounterId, combatId, enemies, seed };
  }

  private async taunt(channelId: string, enemies: Combatant[], seed: number) {
    try {
      const names = [...new Set(enemies.map((e) => e.name))];
      const keys = (await Promise.all(enemies.map((e) => this.repo.template(e.refId)))).flatMap(
        (t) => t?.tauntKeys ?? [],
      );
      const text = await this.flavor.text('enemy_taunt', { enemies: names.join(', ') }, seed, keys);
      await this.ctx.gateway.sendMessage(channelId, {
        persona: 'ultron',
        content: text,
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      this.ctx.log.warn({ err }, 'could not post the taunt');
    }
  }

  /** Consumer `ultron.spawner`. */
  async onMissionStarted(e: LegionEvent<'mission.started'>): Promise<void> {
    const p = e.payload;
    if (p.missionType !== 'combat') return;
    await this.spawn({
      missionId: p.missionId,
      memberIds: p.memberIds,
      partyLevel: p.partyLevel,
      difficulty: p.difficulty,
      channelId: p.channelId,
    });
  }

  /** Consumer `ultron.encounter-result`: stores the outcome on the encounter (idempotent). */
  async onCombatResolved(e: LegionEvent<'combat.resolved'>): Promise<void> {
    const p = e.payload;
    if (p.requestedBy !== 'ultron' || p.mode === 'raid_strike') return;
    await this.ctx.db.transaction(async (tx) => {
      if (!(await this.repo.encounterByCombat(p.combatId, tx))) return;
      await this.repo.resolveEncounter(p.combatId, p.winnerSide ?? 'draw', tx);
    });
  }

  /** /ultron spawn <dificuldade> [membro1..4] */
  async spawnCommand(i: IncomingInteraction, r: Responder): Promise<void> {
    const l = await this.ctx.i18n.localeFor(i.userId);
    const say = (key: string, vars: Record<string, string | number> = {}) =>
      r.reply({ persona: 'ultron', ephemeral: true, content: this.ctx.i18n.t(key, vars, l) });
    const discordIds = ['membro1', 'membro2', 'membro3', 'membro4']
      .map((k) => i.options?.[k])
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (discordIds.length === 0) discordIds.push(i.userId);
    const memberIds: string[] = [];
    for (const d of [...new Set(discordIds)]) {
      const m = await this.ctx.read.members.getByDiscordId(d);
      if (m?.onboardingStep !== 'registered' || m.leftAt)
        return say('ultron.errors.not_registered', { user: `<@${d}>` });
      memberIds.push(m.id);
    }
    const difficulty = (String(i.options?.dificuldade ?? 'normal') as Difficulty) ?? 'normal';
    const channelId = this.ctx.config.channels.combat ?? i.channelId;
    const res = await this.spawn({
      missionId: null,
      memberIds,
      difficulty,
      channelId,
      requestedByUserId: i.userId,
    });
    if (!res) return say('ultron.errors.generic');
    return say('ultron.spawn.sent', {
      count: res.enemies.length,
      enemies: res.enemies.map((e) => `${e.name} (HP ${e.stats.hp})`).join(', '),
      channel: `<#${channelId}>`,
    });
  }
}
