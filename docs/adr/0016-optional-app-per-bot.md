# 0016. Optional Discord app per bot, one process

**Status:** Accepted

## Context
With one Discord app, every Legion bot shows up as the same member ("Legion"); personas only change embeds. Owners want Cérebro, J.A.R.V.I.S. and the others to look like separate bots (name, avatar, status, own command list). Separate apps also scope intents and permissions per bot.

## Decision
A bot may have its own app through `<BOT>_TOKEN` and `<BOT>_CLIENT_ID`; bots without one share `DISCORD_TOKEN` when it is set next to `CEREBRO_TOKEN`, otherwise Cérebro's app. (`CEREBRO_TOKEN`/`CEREBRO_CLIENT_ID` name the main app; on their own, the original `DISCORD_*` names still mean the main app. See the CHANGELOG.) `planApps` groups bots by token. The runner opens one discord.js client per app inside the same process and database. The app hosting Cérebro is `main`: it manages roles and is the only one forwarding member join/leave. Each bot's context sends through its app's gateway; the router answers through the app that received the interaction and treats a command or button of a bot living on another app as expired. Commands are synced per app (hash per app), so moving a bot removes its commands from the shared app.

## Consequences
- Single-token setups behave exactly as before.
- More setup per split bot (app, token, invite); `init`, `doctor`, `invite-url` and `register-commands` guide it.
- Events between bots stay in-process; no new infrastructure.
- Old messages keep their buttons on the app that sent them; after moving a bot, those buttons answer as expired.

## Alternatives considered
- One process per bot: needs a cross-process event bus and shared DB coordination; much more to run.
- Webhooks per persona: different name/avatar on messages, but interactions, commands and presence stay on one app.
