import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defaultJarvisConfig } from '../config.js';
import { missionDirs, readMissions } from '../mission-content.js';
import { at, graphErrors, type Mission, missionXp, resolveVote, step } from './mission.js';

const shipped = readMissions(missionDirs('/nonexistent')).missions;

describe('run engine', () => {
  const m = shipped.find((x) => x.id === 'patrulha-noturna') as Mission;

  it('same mission + same choices → same path', () => {
    const walk = (choices: number[]) => {
      let cur = at(m, m.start);
      const path = [cur.scene];
      for (const c of choices) {
        if (cur.type !== 'choice') break;
        const nx = step(m, cur.scene, { choice: c });
        if (!nx) break;
        cur = nx;
        path.push(cur.scene);
      }
      return path;
    };
    expect(walk([1, 0])).toEqual(walk([1, 0]));
    expect(walk([1, 0])).toEqual(['porto', 'armazem', 'aliada']);
    expect(at(m, 'aliada')).toEqual({ type: 'end', scene: 'aliada', outcome: 'success' });
  });

  it('rejects unknown choices and inputs that do not fit the scene', () => {
    expect(step(m, 'porto', { choice: 9 })).toBeNull();
    expect(step(m, 'porto', { combat: 'win' })).toBeNull();
    expect(step(m, 'nope', { choice: 0 })).toBeNull();
    const c = shipped.find((x) => x.id === 'primeiro-contato-3') as Mission;
    expect(step(c, 'confronto', { combat: 'lose' })).toEqual({
      type: 'end',
      scene: 'derrota',
      outcome: 'failure',
    });
    expect(at(c, 'confronto').type).toBe('combat');
  });

  it('every random walk through every shipped mission ends within the scene count', () => {
    for (const mission of shipped) {
      const n = Object.keys(mission.scenes).length;
      fc.assert(
        fc.property(
          fc.array(fc.nat(3), { minLength: n, maxLength: n }),
          fc.array(fc.boolean(), { minLength: n, maxLength: n }),
          (picks, wins) => {
            let cur = at(mission, mission.start);
            for (let k = 0; k < n; k++) {
              if (cur.type === 'end') return true;
              const scene = mission.scenes[cur.scene];
              const input =
                cur.type === 'combat'
                  ? { combat: wins[k] ? ('win' as const) : ('lose' as const) }
                  : { choice: (picks[k] ?? 0) % (scene?.choices?.length ?? 1) };
              const nx = step(mission, cur.scene, input);
              if (!nx) return false;
              cur = nx;
            }
            return cur.type === 'end';
          },
        ),
      );
    }
  });
});

describe('votes', () => {
  const v = (...pairs: [string, number][]) => new Map(pairs);
  it('majority wins', () => expect(resolveVote(v(['a', 1], ['b', 1], ['c', 0]), 'c')).toBe(1));
  it('a tie goes to the leader', () => expect(resolveVote(v(['a', 1], ['b', 0]), 'b')).toBe(0));
  it('a tie without the leader goes to the lowest tied choice', () =>
    expect(resolveVote(v(['a', 2], ['b', 1]), 'z')).toBe(1));
  it('no votes → null', () => expect(resolveVote(new Map(), 'a')).toBeNull());
});

describe('mission XP', () => {
  const cfg = defaultJarvisConfig().missions;
  it('uses the config default for the kind', () => {
    expect(missionXp({ kind: 'daily' }, 'success', cfg)).toBe(40);
    expect(missionXp({ kind: 'weekly' }, 'failure', cfg)).toBe(30);
    expect(missionXp({ kind: 'story' }, 'success', cfg)).toBe(80);
  });
  it('the mission file overrides it, and abandoned pays nothing', () => {
    expect(missionXp({ kind: 'daily', xp: { success: 7, failure: 2 } }, 'success', cfg)).toBe(7);
    expect(missionXp({ kind: 'daily', xp: { success: 7, failure: 2 } }, 'abandoned', cfg)).toBe(0);
  });
});

describe('graph checks', () => {
  const end = { text: 'x', end: 'success' as const };
  it('finds broken links, cycles and unreachable scenes', () => {
    expect(
      graphErrors({
        start: 'a',
        scenes: {
          a: {
            text: 'x',
            choices: [
              { label: 'l', next: 'b' },
              { label: 'm', next: 'z' },
            ],
          },
          b: end,
        },
      }).map((e) => e.message),
    ).toEqual(['leva a "z", que não existe']);
    const cyc = graphErrors({
      start: 'a',
      scenes: {
        a: {
          text: 'x',
          choices: [
            { label: 'l', next: 'b' },
            { label: 'm', next: 'c' },
          ],
        },
        b: {
          text: 'x',
          choices: [
            { label: 'l', next: 'a' },
            { label: 'm', next: 'c' },
          ],
        },
        c: end,
      },
    });
    expect(cyc[0]?.message).toMatch(/ciclo: a → b → a/);
    const lone = graphErrors({ start: 'a', scenes: { a: end, b: end } });
    expect(lone.map((e) => e.path.join('.'))).toEqual(['scenes.b']);
    expect(graphErrors({ start: 'q', scenes: { a: end } })[0]?.message).toBe('cena "q" não existe');
  });
});
