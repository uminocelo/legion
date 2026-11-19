---
name: legion-setup
description: Help a server owner install and configure Legion, the self-hosted Discord RPG kit (Docker, the Discord app, legion.config.yaml, legion doctor, inviting the bot, role order), without ever reading or printing secrets. Use when the user asks to install, set up, configure, update or troubleshoot Legion, edit legion.config.yaml, or fix a ❌ from legion doctor.
---

# Legion setup

Legion runs in Docker on the owner's machine (Windows, macOS, Linux, Raspberry Pi). Secrets live in `.env`; everything else lives in `legion.config.yaml`. The full guide is `docs/SELF_HOSTING.md`; every config key is in `docs/CONFIG.md`.

## Secrets: hard rules

- **Never open, read, print, `cat`, `grep` or copy `.env`**, and never ask the user to paste a token into the chat. Tokens give full control of the bot.
- When a variable must be set, tell the user its **name** and where to get the value; they type it into `.env` themselves (or answer `legion init`'s hidden prompt).
- To check that variables are set, run `legion doctor`: it reports which ones are missing without showing values.
- Never put a token in `legion.config.yaml`, a command line, a commit or a log.
- If a token is exposed anyway, tell the user to press **Reset Token** in the Discord Developer Portal right away.

Variable names (values come from the Developer Portal and from Discord):
`CEREBRO_TOKEN`, `CEREBRO_CLIENT_ID`, `DISCORD_GUILD_ID` (required); `<BOT>_TOKEN` + `<BOT>_CLIENT_ID` for a bot with its own app (for example `JARVIS_TOKEN`); `DATABASE_URL` (default SQLite `file:./data/legion.db`, or `postgres://…`), `LOG_LEVEL`, `HEALTH_PORT`; `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` (optional ULTRON flavour text).

## Install, step by step

1. **Docker**: Docker Desktop (Windows, macOS) or Docker Engine (Linux, Raspberry Pi).
2. **Download**: `git clone https://github.com/uminocelo/legion && cd legion`.
3. **Discord app** (the user does this in the browser): Developer Portal → New Application "Cérebro" → copy the Application ID into `CEREBRO_CLIENT_ID` → Bot → Reset Token into `CEREBRO_TOKEN` → turn on **Server Members Intent**. In Discord, Developer Mode on, right-click the server → Copy ID into `DISCORD_GUILD_ID`.
4. **Config**, either way:
   - Questions in the terminal (the user runs it; tokens are typed into hidden prompts): `docker run --rm -it -v "$PWD:/out" ghcr.io/uminocelo/legion legion init --out /out` (PowerShell: `"${PWD}:/out"`).
   - By hand: the user copies `.env.example` to `.env` and fills it; you may create `legion.config.yaml` from `legion.config.example.yaml`.
5. **Invite**: `docker compose run --rm legion legion invite-url`, open the link, authorize.
6. **Role order**: in Server Settings → Roles, drag the bot's role (the app's name) **above** every role Legion manages (Sinal Detectado, Mutante Registrado, the nine teams, Recruta, Agente, Veterano, Aviso de Live, Vanguarda, Duelista, Estrategista). Discord only lets a bot give roles below its own.
7. **Check and start**: `docker compose run --rm legion legion doctor` until there is no ❌, then `docker compose up -d`.
8. **In Discord** (staff): `/cerebro setup` shows what it would change; `/cerebro setup aplicar:true` applies it.

## legion.config.yaml

You may read and edit this file (it holds no secrets). Common edits:

- `bots`: `[cerebro]` at minimum; `jarvis` (XP, trivia, missions), `herbie` (guide and tutorial), `sentinel` (fights), `ultron` (enemies and events, needs `sentinel`).
- `channels`: Discord channel ids **in quotes** (`welcome: "123..."`). `missions` and `combat` are needed for fights; `events` for ULTRON.
- `locale` (`pt-BR` or `en`) and `timezone` (for example `America/Sao_Paulo`).
- `jarvis.trivia.categories`: add new trivia categories here (keep the default ones: `quadrinhos`, `rivals`, `geral`, `vingadores`, `quarteto`, `cosmico`, `mistico`).
- `roles` and `factions`: writing them replaces the whole default list. Copy the complete list from `docs/CONFIG.md` before changing anything, or leave them out.

After an edit, restart (`docker compose up -d`) and run `legion doctor`. A config error names the line and the key.

## Content

Server content goes in `data/content/` (missions, campaigns, trivia, enemies, powers). Use the **legion-mission**, **legion-campaign**, **legion-trivia** and **legion-enemy** skills to write it, and check it with:

```bash
docker compose run --rm legion legion content validate data/content
```

## Troubleshooting with doctor

- Read each ❌ and its "Como corrigir" line; fix one at a time and run `legion doctor` again. `--json` gives a machine-readable report.
- Token refused, wrong client id, missing intent, bot not in the server, missing channel permissions, roles above the bot: the doctor names each one.
- Staff commands not showing: the staff role has no Administrator; see `docs/SELF_HOSTING.md` ("Comandos da staff não aparecem").
- Logs: `docker compose logs legion --since 30m`. Errors are `"level":50`. Show the user only the relevant lines, and stop if a line looks like a secret.

## Update, backup

- Update: `docker compose pull && docker compose up -d`; migrations run on their own. Pin a version with `LEGION_VERSION=0.9.1` in `.env` (the user edits it). Read `CHANGELOG.md` "Upgrade notes" first.
- Back up the `data/` folder before every update (it holds the SQLite database and server content). Never open `data/legion.db` from the host while the container runs; stop it first or copy the file.

## pt-BR style

The bots and docs speak Brazilian Portuguese. Explain steps to the user in the language they write in, but keep Discord labels exactly as they appear ("Configurações do servidor → Cargos", "Copiar ID").
