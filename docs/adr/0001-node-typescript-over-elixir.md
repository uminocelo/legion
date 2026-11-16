# 0001. Node.js and TypeScript instead of Elixir

**Status:** Accepted

## Context
Legion is a Discord bot kit meant to be self-hosted and extended by a fan community. Elixir/OTP would give supervision trees for free, but the Discord library ecosystem, hosting know-how and contributor pool are far larger for JavaScript.

## Decision
Use Node.js 22 LTS and TypeScript (strict, ESM), discord.js 14, Drizzle, zod and Vitest in a pnpm monorepo.

## Consequences
- No OTP supervision. We compensate with: an error boundary around every interaction, event handler and job; Docker `restart: unless-stopped`; and flows whose state lives in the DB and are idempotent, so a crash or restart resumes instead of corrupting state.
- One language across bots, CLI and tests; easy onboarding for contributors.

## Alternatives considered
- Elixir + Nostrum: better fault tolerance, much smaller ecosystem and contributor pool.
- Python + discord.py: similar ecosystem, weaker typing for a shared event contract.
