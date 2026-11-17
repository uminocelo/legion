# 0014. Streaks and caps use the server's local day, computed lazily

**Status:** Accepted

## Context
"Daily" (streaks, trivia cap, weekly ranking) must match what members see on their clock, and must not depend on a nightly job that could be missed while the bot is down.

## Decision
Days are `localDay(now, config.timezone)` strings stored on ledger rows. The streak advances on the first active entry of a day (trivia, including capped answers, and grants; not bonuses or staff adjustments). A lapsed streak is shown as 0 when read (`displayedStreak`) instead of being reset by a job. Weeks start on Monday.

## Consequences
- No scheduler work; correct after downtime. 23:59 and 00:00 local are different days.
- Changing the timezone later shifts day boundaries for future entries only.

## Alternatives considered
- UTC days: wrong for Brazilian evenings. Nightly reset job: fragile with downtime.
