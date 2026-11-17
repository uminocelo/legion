# 0021. mulberry32 PRNG and a fixed dice-consumption order

**Status:** Accepted

## Context
Replays must give the same dice on every platform and Node version.

## Decision
Dice come from `mulberry32(seed)` (`core/game/random.ts`), with a uint32 seed from `ctx.random.seed()`. Within a round the order is: enemy decisions in id order (a d100 only when the previous condition allows), then for each acting combatant in turn order a d20 to hit and, on a hit, a d6 (attack) or d8 (power). A wipe stops the round and consumes no more dice.

## Consequences
Tiny, fast and identical everywhere (32-bit integer math). Not cryptographic, which is fine for a game. Any change to the order is a rules change (see ADR 0020).

## Alternatives considered
`Math.random`: not seedable. A cryptographic PRNG: slower and not needed.
