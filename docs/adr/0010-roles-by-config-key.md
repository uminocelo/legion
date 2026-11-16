# 0010. Roles referenced by config key, not display name

**Status:** Accepted

## Context
Owners rename roles; Discord role ids differ per server.

## Decision
Code refers to roles only by `key` (`registered`, `faction_xmen`, …). `RoleService` resolves key → name (from config) → Discord role id and caches it; role sync creates missing roles by name.

## Consequences
- Renaming a role is a config change.
- Two roles with the same name in a server are ambiguous; the first match wins and `/cerebro status` shows it.

## Alternatives considered
- Store role ids in config: harder for owners, breaks across servers.
