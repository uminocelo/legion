# 0007. No automatic channel permission changes

**Status:** Accepted

## Context
Hiding the server from unregistered members needs channel permission overwrites. Changing them silently on boot could lock staff out or break an existing setup.

## Decision
The bot never changes channel permissions on its own. `/cerebro setup` is a dry run by default; `aplicar:true` applies roles, and only `canais:true` also changes channels. The plan skips the welcome and rules channels, staff channels (already hidden from @everyone and not opened to Registered), and `cerebro.setup.excludeChannelIds`; it only adds/edits the @everyone and Registered overwrites and keeps everything else.

## Consequences
- Owners see exactly what will change before it happens.
- A half-configured channel can look like a staff channel and be skipped; the exclude list and the dry run make this visible.

## Alternatives considered
- Apply on every boot: dangerous on existing servers.
