# 0028. Credits: a ledger plus a cached balance in J.A.R.V.I.S.

**Status:** Accepted (v0.10, US-14)

## Context
J.A.R.V.I.S. v2 adds credits that players earn from missions, trivia and world events and later spend in a shop. Payouts come from consumers, timers and button clicks, which can repeat: an event delivered twice, a replayed mission ending, a restart in the middle of a payout. Purchases on Postgres can run at the same time. Staff need to fix mistakes, and the playtest needs a way to prove nothing was paid twice.

## Decision
- **Ledger plus cache, like XP (D1).** `jarvis_wallet_ledger` is append-only: one row per movement, positive or negative, with `reason` (`mission`, `trivia`, `world_event`, `purchase`, `staff`) and a **unique `source_key`**. `jarvis_wallets.balance` is a cache of the ledger sum, created on the first movement.
- **One transaction per movement.** `WalletService.credit`/`debit` insert the ledger row (a repeated `source_key` is a no-op that returns `duplicate: true`), then change the balance with one atomic `UPDATE`. A debit only applies `WHERE balance >= amount`; otherwise it throws `InsufficientCredits` and the transaction writes nothing. Postgres also has `CHECK (balance >= 0)`.
- **Payouts sit next to the XP they go with.** Missions pay in the transaction that ends the run, with the same `mission:<runId>:<memberId>` key; trivia pays with the correct answer (`trivia:<attemptId>`), not limited by the daily XP cap.
- **World events need no new event (D4).** The consumer `jarvis.world-credits` reads ULTRON's `world.event` with `phase: ended`: victory or participation per participant (`world:<eventId>:<memberId>`); `outcome: null` (cancelled) pays nothing.
- **Staff fix mistakes through the ledger (D7).** `/jarvis creditos dar` accepts −10000..10000, records `created_by` and the reason, and never takes a balance below 0.
- **Checked by the report.** `legion playtest-report` compares every wallet with its ledger sum and flags negative balances.

## Consequences
Every payout is idempotent and auditable, and the balance can be rebuilt from the ledger. A future purchase is a debit and a grant in one transaction (US-16). Economy off (`jarvis.economy.enabled: false`) stops payouts without touching balances. There is no real money anywhere.

## Alternatives considered
A separate economy bot: another owner of member data and another set of events for little gain. A balance column without a ledger: no audit trail and no idempotency. A new event for world-event payouts: `world.event` already carries the outcome and the participants.
