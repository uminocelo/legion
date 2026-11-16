# 0003. One process and one bot account, with personas

**Status:** Accepted

## Context
Five bots as five Discord applications means five tokens, five invites and five processes for each owner.

## Decision
One Docker container runs every enabled bot in one Node process with one Discord account. Each bot posts with its own persona (embed author, color, footer). `bots:` in the config chooses which modules load; intents and invite permissions are the union of the enabled bots.

## Consequences
- One token, one invite, one health check.
- Messages all come from the same account; personas carry identity.
- `EventBus` and `DiscordGateway` stay interfaces so an opt-in multi-token mode (one account per bot, bus over Redis) can be added later without touching bot logic.

## Alternatives considered
- One app per bot: closer to the fiction, much harder to host.
- Webhook personas: deferred (needs Manage Webhooks and can't answer interactions).
