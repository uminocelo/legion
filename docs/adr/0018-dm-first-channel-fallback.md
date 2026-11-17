# 0018. DM first, channel fallback for tutorial delivery

**Status:** Accepted

## Context
Tutorial messages are personal, so a DM is the least noisy place. Many members have DMs from server members turned off (Discord error 50007).

## Decision
With `herbie.delivery: dm` (default) H.E.R.B.I.E. tries a DM; on any failure it posts in `channels.tutorial` (or the welcome channel) mentioning only that member. On 50007 it sets `deliveryFallback = 1` for the member so later messages go straight to the channel. `delivery: channel` always uses the channel. Members who left get nothing. Buttons on DM messages are accepted by the gateway as a member with no roles (no staff actions from DMs).

## Consequences
- No lost intros for members with closed DMs, and no repeated failing DM attempts.
- Channel posts are public; they only contain tutorial text.

## Alternatives considered
- Channel only: noisy for big servers. DM only: silently fails for many members.
