export type Side = 'players' | 'enemies';
export type Action = 'attack' | 'power' | 'defend';
export const ACTIONS: readonly Action[] = ['attack', 'power', 'defend'];

/** A combatant inside the engine. `hp` is current HP; 0 means downed. */
export interface Fighter {
  id: string;
  side: Side;
  kind: 'player' | 'enemy' | 'dummy';
  name: string;
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  foc: number;
  powerCooldownMax: number;
  powerCooldown: number;
  downedAtRound: number | null;
}

export type LogEntry =
  | { type: 'round'; round: number }
  | {
      type: 'action';
      round: number;
      actorId: string;
      action: Action;
      targetId: string | null;
      roll: number | null;
      hit: boolean;
      crit: boolean;
      damage: number;
      targetHpAfter: number | null;
    }
  | { type: 'end'; round: number; winnerSide: Side | null; reason: 'wipe' | 'max_rounds' | 'abandoned' };

/** What the players chose in one round (missing players default to attack). */
export interface RoundInput {
  actions: Record<string, Action>;
  /** No player chose anything this round (counts toward abandonment). */
  idle: boolean;
}

export interface CombatState {
  /** Rounds resolved so far. */
  round: number;
  maxRounds: number;
  abandonAfterIdleRounds: number;
  idleStreak: number;
  fighters: Fighter[];
  ended: boolean;
  winnerSide: Side | null;
}
