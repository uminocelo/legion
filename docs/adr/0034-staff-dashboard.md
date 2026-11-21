# 0034. Staff dashboard

**Status:** Accepted (v1.0, US-20). Builds on [ADR 0033](0033-faction-war.md) (war data shown in a panel).

## Context

Staff follow the server through slash commands: one ephemeral answer at a time, no overview, nothing on a phone without Discord open. US-20 wants members, economy, events, war and threat on one page, and US-21 adds actions. The owner runs a single container and is not a web developer, so the dashboard cannot need a second service or a build step. The login must not invent a password and must follow Discord: someone who loses the staff role loses access.

## Decision

- **D21 — A core HTTP server in the runner process with server-rendered pages.** `DashboardServer` (`node:http`, `dashboard.port`, default 8081) starts with the bots when `dashboard.enabled` is true and `DASHBOARD_CLIENT_SECRET` is set. Pages are plain HTML built on the server, with a stylesheet at `/assets/dashboard.css` and no scripts. It is off by default and compose publishes it on `127.0.0.1` only.
- **D22 — Bots register panels through a core registry.** `ctx.dashboard.panel({ id, titleKey, render })` returns a `PanelView` (`stats` or `table`), and core renders and escapes it. The dashboard never reads a bot's tables itself. A disabled bot registers nothing, so its panels are gone. Actions (US-21) use the same registry.
- **D23 — Discord OAuth2 with a database session and a staff re-check on every request.** `/login` redirects to Discord with `scope=identify` and a `state` cookie (10 min). `/callback` checks the state, exchanges the one-use code, reads the user once and throws the access token away. Then it checks staff: owner, Administrator, or a staff role (the slash-command check). `core_dashboard_sessions` stores the SHA-256 of a random 32-byte cookie token, a CSRF token and the expiry (`sessionHours`). Every request checks staff again, cached for at most 60 s. A user who is no longer staff gets a 403 and their session is deleted. If Discord cannot answer, the request gets a 503 and the session is kept.

## Consequences

The bots and the dashboard share one process, database and Discord connection: restarting one restarts both. The OAuth2 secret is a new required value only when the dashboard is on, and `legion doctor` fails without it. A reverse proxy is needed for access from outside the machine, and doctor warns about plain http off localhost. Behind a proxy, the 10-per-minute callback limit counts the proxy's IP. CI tests the login against faked Discord endpoints in-process (D28).

## Alternatives considered

A separate container or a single-page app: more to deploy and build, for read-mostly pages. Reading bot tables from the dashboard: couples core to every bot's schema. A shared password or a pasted bot token: nothing ties access to Discord roles, and a leaked password stays valid after someone leaves the staff.
