# 0022. Sentinel flags, staff decide

**Status:** Accepted

## Context
Automatic punishments go wrong on false positives (shared IPs, bursts of legitimate activity, new but honest accounts).

## Decision
Sentinel never bans, kicks or times out on its own. Rate-limit abuse, XP anomalies and new accounts become `report.flagged` (at most once per member, reason and hour); member reports come from `/denunciar` and the "Denunciar mensagem" menu. Everything lands in `channels.modQueue`, grouped by subject and reason for an hour, with staff-only buttons (resolve, ignore, warn by DM, timeouts, history). Every action is logged in `sentinel_moderation_actions` and shown on the queue message.

## Consequences
Staff stay in control and accountable; the queue may need attention on busy servers.

## Alternatives considered
Automatic timeouts on thresholds: fast but punishes false positives.
