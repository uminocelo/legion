import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Rng } from '@legion/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson, logHash, newCombat, replayCombat, resolveRound } from './engine.js';
import type { Action, Fighter, LogEntry, RoundInput } from './types.js';

const O = { maxRounds: 20, abandonAfterIdleRounds: 3 };
const f = (id: string, side: Fighter['side'], o: Partial<Fighter> = {}): Fighter => ({
  id,
  side,
  kind: side === 'players' ? 'player' : 'enemy',
  name: id,
  maxHp: 100,
  hp: 100,
  atk: 10,
  def: 6,
  spd: 9,
  foc: 10,
  powerCooldownMax: 3,
  powerCooldown: 0,
  downedAtRound: null,
  ...o,
});
/** Scripted dice: each call returns the next value and records the die size. */
function dice(...values: number[]) {
  const sizes: number[] = [];
  const rng: Rng = {
    next: () => 0,
    d: (n) => {
      sizes.push(n);
      const v = values.shift();
      if (v === undefined) throw new Error(`no scripted roll left for d${n}`);
      return v;
    },
  };
  return { rng, sizes };
}
const acts = (log: LogEntry[]) =>
  log.filter((e): e is Extract<LogEntry, { type: 'action' }> => e.type === 'action');
const play = (a: Record<string, Action> = {}, idle = false): RoundInput => ({ actions: a, idle });
// Enemy with power on cooldown and full HP → no AI rolls.
const quietEnemy = (o: Partial<Fighter> = {}) => f('z1', 'enemies', { powerCooldown: 9, ...o });

describe('hit roll', () => {
  it('hits when r + floor(spd/3) >= 8 + floor(target.spd/4)', () => {
    // p1 spd 9 (+3) vs e1 spd 9 (+2): needs r >= 7. Turn order: p1 then e1 (same spd, id order).
    const s = newCombat([f('p1', 'players'), quietEnemy({ hp: 1000, maxHp: 1000 })], O);
    const miss = resolveRound(s, play(), dice(6, 1).rng); // p1 rolls 6: miss; e1 rolls 1: miss
    expect(acts(miss.log).map((a) => a.hit)).toEqual([false, false]);
    const hit = resolveRound(s, play(), dice(7, 3, 1).rng); // p1 rolls 7: hit, d6=3
    expect(acts(hit.log)[0]).toMatchObject({ hit: true, crit: false, damage: 10 + 3 - 3, roll: 7 });
  });
  it('natural 1 always misses, natural 20 always hits and doubles', () => {
    const s = newCombat([f('p1', 'players', { spd: 60 }), quietEnemy({ spd: 0, hp: 1000, maxHp: 1000 })], O);
    expect(acts(resolveRound(s, play(), dice(1, 1).rng).log)[0]).toMatchObject({ hit: false, damage: 0 });
    const weak = newCombat(
      [f('p1', 'players', { spd: 0 }), quietEnemy({ spd: 60, hp: 1000, maxHp: 1000 })],
      O,
    );
    // e1 is faster: e1 acts first (roll 1, miss), then p1 rolls 20.
    const r = acts(resolveRound(weak, play(), dice(1, 20, 4).rng).log);
    expect(r[1]).toMatchObject({ actorId: 'p1', hit: true, crit: true, damage: (10 + 4 - 3) * 2 });
  });
});

describe('damage', () => {
  it('attack and power formulas with minimum 1', () => {
    const s = newCombat([f('p1', 'players', { foc: 11 }), quietEnemy({ def: 9, hp: 1000, maxHp: 1000 })], O);
    const pow = acts(resolveRound(s, play({ p1: 'power' }), dice(10, 5, 1).rng).log)[0];
    expect(pow).toMatchObject({ action: 'power', damage: Math.floor(11 * 1.5) + 5 - 3 }); // 18
    const tough = newCombat([f('p1', 'players', { atk: 1 }), quietEnemy({ def: 40 })], O);
    expect(acts(resolveRound(tough, play(), dice(10, 1, 1).rng).log)[0]?.damage).toBe(1);
  });
  it('defend halves (min 1) and is in effect before the defender acts', () => {
    // e1 low HP: AI rolls d100 for defend (power on cooldown → no power roll).
    const s = newCombat([f('p1', 'players', { spd: 1 }), quietEnemy({ hp: 20, spd: 30 })], O);
    const { log } = resolveRound(s, play(), dice(10, /*p1 needs 15*/ 19, 6).rng);
    expect(acts(log)[0]).toMatchObject({ actorId: 'z1', action: 'defend' });
    expect(acts(log)[1]).toMatchObject({ actorId: 'p1', damage: Math.floor((10 + 6 - 3) / 2) });
    const s2 = newCombat(
      [f('p1', 'players', { atk: 1, spd: 1 }), quietEnemy({ hp: 20, spd: 30, def: 0 })],
      O,
    );
    expect(acts(resolveRound(s2, play(), dice(10, 19, 1).rng).log)[1]?.damage).toBe(1); // floor(2/2)=1
  });
});

describe('cooldowns, order, targets, end', () => {
  it('power is ready again 3 rounds later; power on cooldown becomes attack', () => {
    let s = newCombat(
      [f('p1', 'players', { spd: 20 }), quietEnemy({ powerCooldown: 99, hp: 5000, maxHp: 5000, spd: 0 })],
      O,
    );
    const kinds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = resolveRound(s, play({ p1: 'power' }), dice(1, 1).rng); // natural 1s: no damage dice
      kinds.push(r.actions.p1 as string);
      s = r.state;
    }
    expect(kinds).toEqual(['power', 'attack', 'attack', 'power']);
  });
  it('turn order is spd desc then id; targets are lowest hp then lowest id', () => {
    const s = newCombat(
      [
        f('p2', 'players', { spd: 5 }),
        f('p1', 'players', { spd: 5 }),
        f('p3', 'players', { spd: 7 }),
        quietEnemy({ id: 'e2', spd: 5, hp: 500, maxHp: 500 }),
        quietEnemy({ id: 'e1', spd: 5, hp: 500, maxHp: 500 }),
      ],
      O,
    );
    const r = resolveRound(s, play(), dice(1, 1, 1, 1, 1).rng);
    expect(acts(r.log).map((a) => a.actorId)).toEqual(['p3', 'e1', 'e2', 'p1', 'p2']);
    expect(acts(r.log)[0]?.targetId).toBe('e1');
    const low = newCombat(
      [f('p1', 'players'), f('p2', 'players', { hp: 50 }), quietEnemy({ spd: 99, hp: 500, maxHp: 500 })],
      O,
    );
    expect(acts(resolveRound(low, play(), dice(1, 1, 1).rng).log)[0]?.targetId).toBe('p2');
  });
  it('a wipe ends the round at once and consumes no more dice; downed never act', () => {
    const s = newCombat(
      [f('p1', 'players', { spd: 20, atk: 50 }), f('p2', 'players'), quietEnemy({ hp: 5 })],
      O,
    );
    const { rng, sizes } = dice(50, 15, 1); // z1 is low: one d100 for defend (no)
    const r = resolveRound(s, play(), rng);
    expect(r.state).toMatchObject({ ended: true, winnerSide: 'players' });
    expect(sizes).toEqual([100, 20, 6]);
    expect(r.log.at(-1)).toMatchObject({ type: 'end', reason: 'wipe' });
  });
  it('max rounds: higher hp ratio wins, equal is a draw', () => {
    const s = newCombat([f('p1', 'players', { hp: 50 }), quietEnemy({ hp: 60 })], { ...O, maxRounds: 1 });
    expect(resolveRound(s, play(), dice(2, 2).rng).state).toMatchObject({
      ended: true,
      winnerSide: 'enemies',
    });
    const eq = newCombat([f('p1', 'players', { hp: 60 }), quietEnemy({ hp: 60 })], { ...O, maxRounds: 1 });
    expect(resolveRound(eq, play(), dice(2, 2).rng).state.winnerSide).toBeNull();
  });
  it('three idle rounds in a row abandon the combat for the enemies', () => {
    const r = replayCombat(
      1,
      [f('p1', 'players'), quietEnemy({ hp: 5000, maxHp: 5000 })],
      [play({}, true), play({}, true), play({}, true)],
      O,
    );
    expect(r.state).toMatchObject({ ended: true, winnerSide: 'enemies', round: 3 });
    expect(r.log.at(-1)).toEqual({ type: 'end', round: 3, winnerSide: 'enemies', reason: 'abandoned' });
  });
});

describe('determinism (property)', () => {
  const fighter = (side: Fighter['side'], n: number) =>
    fc
      .record({
        hp: fc.integer({ min: 1, max: 300 }),
        atk: fc.integer({ min: 1, max: 40 }),
        def: fc.integer({ min: 1, max: 40 }),
        spd: fc.integer({ min: 1, max: 30 }),
        foc: fc.integer({ min: 1, max: 40 }),
        powerCooldown: fc.integer({ min: 0, max: 3 }),
      })
      .map((st) => f(`${side[0]}${n}`, side, { ...st, maxHp: st.hp }));
  const lineup = fc.tuple(
    fc
      .integer({ min: 1, max: 3 })
      .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => fighter('players', i)))),
    fc
      .integer({ min: 1, max: 3 })
      .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => fighter('enemies', i)))),
  );
  const inputs = fc.array(
    fc.record({
      actions: fc.dictionary(
        fc.constantFrom('p0', 'p1', 'p2'),
        fc.constantFrom<Action>('attack', 'power', 'defend'),
      ),
      idle: fc.boolean(),
    }),
    { maxLength: 25 },
  );
  it('replay reproduces the log and hash; HP never negative; downed never act; ends within maxRounds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        lineup,
        inputs,
        fc.integer({ min: 1, max: 20 }),
        (seed, [ps, es], ins, maxRounds) => {
          const o = { maxRounds, abandonAfterIdleRounds: 3 };
          const a = replayCombat(seed, [...ps, ...es], ins, o);
          const b = replayCombat(seed, [...ps, ...es], ins, o);
          expect(b.log).toEqual(a.log);
          expect(b.logHash).toBe(a.logHash);
          expect(a.state.round).toBeLessThanOrEqual(maxRounds);
          expect(a.state.fighters.every((x) => x.hp >= 0)).toBe(true);
          const downedAt = new Map<string, number>();
          for (const e of a.log) {
            if (e.type !== 'action') continue;
            const d = downedAt.get(e.actorId);
            expect(d === undefined || e.round <= d).toBe(true);
            if (d !== undefined && e.round === d)
              throw new Error('acted after being downed in the same round');
            if (e.targetId && e.targetHpAfter === 0 && !downedAt.has(e.targetId))
              downedAt.set(e.targetId, e.round);
          }
          // Enough rounds always end the fight.
          const long = replayCombat(
            seed,
            [...ps, ...es],
            Array.from({ length: maxRounds }, () => play()),
            o,
          );
          expect(long.state.ended).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('golden log', () => {
  it('a fixed seed and lineup produce the committed log (change only with an ADR)', () => {
    const lineup = [
      f('a-player', 'players', { name: 'Faísca', maxHp: 95, hp: 95, atk: 12, def: 6, spd: 9, foc: 10 }),
      f('b-player', 'players', { name: 'Muralha', maxHp: 130, hp: 130, atk: 8, def: 13, spd: 6, foc: 6 }),
      f('z-drone', 'enemies', {
        kind: 'dummy',
        name: 'Drone de Treino',
        maxHp: 180,
        hp: 180,
        atk: 10,
        def: 10,
        spd: 8,
        foc: 9,
      }),
    ];
    const ins: RoundInput[] = Array.from({ length: 20 }, (_, i) =>
      play(i % 3 === 0 ? { 'a-player': 'power', 'b-player': 'defend' } : {}),
    );
    const r = replayCombat(123456789, lineup, ins, O);
    const file = fileURLToPath(new URL('../../../test/golden/combat-123456789.json', import.meta.url));
    const out = { logHash: r.logHash, winnerSide: r.state.winnerSide, rounds: r.state.round, log: r.log };
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) {
      if (process.env.CI) throw new Error(`golden file missing: ${file}`);
      writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
    }
    expect(out).toEqual(JSON.parse(readFileSync(file, 'utf8')));
    expect(logHash(r.log)).toBe(r.logHash);
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });
});
