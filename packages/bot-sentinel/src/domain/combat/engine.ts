import { createHash } from 'node:crypto';
import { mulberry32, type Rng } from '@legion/core';
import type { Action, CombatState, Fighter, LogEntry, RoundInput, Side } from './types.js';

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const alive = (f: Fighter) => f.hp > 0;
const other = (s: Side): Side => (s === 'players' ? 'enemies' : 'players');

export interface NewCombatOptions {
  maxRounds: number;
  abandonAfterIdleRounds: number;
}

export function newCombat(fighters: Fighter[], o: NewCombatOptions): CombatState {
  return {
    round: 0,
    maxRounds: o.maxRounds,
    abandonAfterIdleRounds: o.abandonAfterIdleRounds,
    idleStreak: 0,
    fighters: fighters.map((f) => ({ ...f })).sort(byId),
    ended: false,
    winnerSide: null,
  };
}

/** The winner when one side has no living combatants, else undefined. */
function wipeWinner(fs: Fighter[]): Side | undefined {
  const p = fs.some((f) => f.side === 'players' && alive(f));
  const e = fs.some((f) => f.side === 'enemies' && alive(f));
  if (!p && !e) return undefined; // cannot happen: the last hit always leaves the attacker standing
  if (!p) return 'enemies';
  if (!e) return 'players';
  return undefined;
}

/** Enemy AI: power when ready (40%), defend when low (30%), else attack. Rolls only when needed. */
function enemyAction(f: Fighter, rng: Rng): Action {
  if (f.powerCooldown === 0 && rng.d(100) <= 40) return 'power';
  if (f.hp < 0.3 * f.maxHp && rng.d(100) <= 30) return 'defend';
  return 'attack';
}

export interface RoundResult {
  state: CombatState;
  log: LogEntry[];
  /** Effective action of every living combatant (players after defaults, enemies as decided). */
  actions: Record<string, Action>;
}

/** Resolves one round. Pure: same state, input and rng position → same result. */
export function resolveRound(prev: CombatState, input: RoundInput, rng: Rng): RoundResult {
  if (prev.ended) throw new Error('combat already ended');
  const s: CombatState = { ...prev, fighters: prev.fighters.map((f) => ({ ...f })) };
  const round = s.round + 1;
  s.round = round;
  const log: LogEntry[] = [{ type: 'round', round }];
  const actions: Record<string, Action> = {};

  s.idleStreak = input.idle ? s.idleStreak + 1 : 0;
  if (input.idle && s.idleStreak >= s.abandonAfterIdleRounds) {
    s.ended = true;
    s.winnerSide = 'enemies';
    log.push({ type: 'end', round, winnerSide: 'enemies', reason: 'abandoned' });
    return { state: s, log, actions };
  }

  // 1. Enemy decisions in id order; 2. player defaults.
  for (const f of s.fighters.filter(alive)) {
    if (f.side === 'enemies') actions[f.id] = enemyAction(f, rng);
    else {
      const chosen = input.actions[f.id] ?? 'attack';
      actions[f.id] = chosen === 'power' && f.powerCooldown > 0 ? 'attack' : chosen;
    }
  }
  // 3. Defends take effect at the start of the round.
  const defending = new Set(
    Object.entries(actions)
      .filter(([, a]) => a === 'defend')
      .map(([id]) => id),
  );

  // 4. Turn order: spd desc, id asc.
  const order = s.fighters.filter(alive).sort((a, b) => b.spd - a.spd || byId(a, b));
  for (const actor of order) {
    if (!alive(actor)) continue; // downed earlier this round
    const action = actions[actor.id] as Action;
    if (action === 'defend') {
      log.push({
        type: 'action',
        round,
        actorId: actor.id,
        action,
        targetId: null,
        roll: null,
        hit: false,
        crit: false,
        damage: 0,
        targetHpAfter: null,
      });
      continue;
    }
    const target = s.fighters
      .filter((f) => f.side === other(actor.side) && alive(f))
      .sort((a, b) => a.hp - b.hp || byId(a, b))[0];
    if (!target) break;
    const r = rng.d(20);
    const crit = r === 20;
    const hit = r !== 1 && (crit || r + Math.floor(actor.spd / 3) >= 8 + Math.floor(target.spd / 4));
    let damage = 0;
    if (hit) {
      damage =
        action === 'power'
          ? Math.max(1, Math.floor(actor.foc * 1.5) + rng.d(8) - Math.floor(target.def / 3))
          : Math.max(1, actor.atk + rng.d(6) - Math.floor(target.def / 2));
      if (crit) damage *= 2;
      if (defending.has(target.id)) damage = Math.max(1, Math.floor(damage / 2));
      target.hp = Math.max(0, target.hp - damage);
      if (target.hp === 0) target.downedAtRound = round;
    }
    if (action === 'power') actor.powerCooldown = actor.powerCooldownMax;
    log.push({
      type: 'action',
      round,
      actorId: actor.id,
      action,
      targetId: target.id,
      roll: r,
      hit,
      crit,
      damage,
      targetHpAfter: target.hp,
    });
    // 7. End check after every action.
    const w = wipeWinner(s.fighters);
    if (w) {
      s.ended = true;
      s.winnerSide = w;
      log.push({ type: 'end', round, winnerSide: w, reason: 'wipe' });
      break;
    }
  }
  // 6. Cooldowns tick down (also the one just set).
  for (const f of s.fighters) if (f.powerCooldown > 0) f.powerCooldown--;
  if (!s.ended && round >= s.maxRounds) {
    const ratio = (side: Side) =>
      s.fighters.filter((f) => f.side === side).reduce((sum, f) => sum + f.hp / f.maxHp, 0);
    const p = ratio('players');
    const e = ratio('enemies');
    s.ended = true;
    s.winnerSide = p > e ? 'players' : e > p ? 'enemies' : null;
    log.push({ type: 'end', round, winnerSide: s.winnerSide, reason: 'max_rounds' });
  }
  return { state: s, log, actions };
}

/** Canonical JSON: object keys sorted, no whitespace. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

export const logHash = (log: readonly LogEntry[]) =>
  createHash('sha256').update(canonicalJson(log)).digest('hex');

export interface ReplayResult {
  state: CombatState;
  log: LogEntry[];
  rounds: RoundResult[];
  logHash: string;
}

/** Replays a combat from its seed and the recorded inputs; the only way the engine is ever driven. */
export function replayCombat(
  seed: number,
  fighters: Fighter[],
  inputs: readonly RoundInput[],
  o: NewCombatOptions,
): ReplayResult {
  const rng = mulberry32(seed);
  let state = newCombat(fighters, o);
  const rounds: RoundResult[] = [];
  for (const input of inputs) {
    if (state.ended) break;
    const r = resolveRound(state, input, rng);
    rounds.push(r);
    state = r.state;
  }
  const log = rounds.flatMap((r) => r.log);
  return { state, log, rounds, logHash: logHash(log) };
}

/** Damage dealt by each side, per combatant, from a log. */
export function damageSummary(log: readonly LogEntry[], fighters: readonly Fighter[]) {
  const sideOf = new Map(fighters.map((f) => [f.id, f.side]));
  const bySide = { players: 0, enemies: 0 };
  const byFighter = new Map<string, number>();
  for (const e of log)
    if (e.type === 'action' && e.damage > 0) {
      const side = sideOf.get(e.actorId);
      if (side) bySide[side] += e.damage;
      byFighter.set(e.actorId, (byFighter.get(e.actorId) ?? 0) + e.damage);
    }
  const mvp = [...byFighter.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
  return { bySide, byFighter, mvp };
}
