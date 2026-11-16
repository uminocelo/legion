# 0006. Idempotent role sync and the TikTok role guard

**Status:** Accepted

## Context
Bots manage many roles on a live server where admins also edit roles, and a third-party TikTok integration owns the `Assinante TikTok` role.

## Decision
Only core's `RoleService` touches roles. Role sync is a pure plan (create missing, recolor only roles we manage) applied idempotently: running it twice changes nothing. Bots never delete roles or rename roles they don't manage. Any operation on the TikTok role — matched by key, by name, or by Discord's managed/integration flag — is refused (throws in tests, logs and skips in production).

## Consequences
- Restarts and repeated `/cerebro setup` are safe.
- Owners can rename roles in config; code uses keys.

## Alternatives considered
- Sync by name only: breaks on rename and risks touching the TikTok role.
