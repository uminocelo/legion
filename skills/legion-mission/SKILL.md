---
name: legion-mission
description: Write a mission for a Legion Discord RPG server (J.A.R.V.I.S. missions) as a valid YAML file, with scenes, choices, fights and endings in pt-BR and en, following Legion's canon policy and balance. Use when the user asks for a Legion mission, a daily/weekly/story mission, a "missão", or to fix a mission file. Always validate with `legion content validate` before handing the file over.
---

# Legion mission

A mission is a short branching story. Players run `/missao iniciar`, each scene shows buttons, and the story ends in success or failure. A scene can start a fight (ULTRON builds the enemies, Sentinel runs the fight).

Output: **one file per mission**, `data/content/missions/<id>.yaml` on the server, or a file the staff imports with `/jarvis missao importar` (up to 64 KB).

## Workflow

1. Ask (or infer) the kind (`daily`, `weekly`, `story`), the party size, whether there is a fight, and the theme.
2. Write the file following the format below. Write pt-BR first, then en.
3. Run the validator (see **Validate**). Fix every ❌ and run it again.
4. Hand over the file only when the validator says it is valid. Tell the user how to load it (restart, or `/jarvis missao importar`).

## Format

```yaml
id: resgate-no-metro            # unique; lowercase letters, digits, "-" (no Marvel names in ids)
kind: daily                     # daily | weekly | story
title: { pt-BR: "Resgate no metrô", en: "Subway rescue" }
summary: { pt-BR: "Um trem parou entre duas estações.", en: "A train stopped between two stations." }
minLevel: 1                     # default 1
party: 2                        # 1 to 4 players; default 1
difficulty: normal              # facil | normal | dificil (scales the enemies)
# xp: { success: 50, failure: 10 }   # optional; default comes from jarvis.missions.rewards
# credits: { success: 25, failure: 5 }   # optional; default comes from jarvis.economy.missions
start: plataforma
scenes:
  plataforma:
    text: { pt-BR: "...", en: "..." }
    choices:                    # 2 to 4 choices
      - label: { pt-BR: "Porta de manutenção", en: "Maintenance door" }
        next: corredor
      - label: { pt-BR: "Seguir os trilhos", en: "Follow the tracks" }
        next: emboscada
  corredor:
    text: { pt-BR: "...", en: "..." }
    end: success                # success | failure
  emboscada:
    text: { pt-BR: "...", en: "..." }
    combat: { win: trem, lose: recuo }
  trem: { text: { pt-BR: "...", en: "..." }, end: success }
  recuo: { text: { pt-BR: "...", en: "..." }, end: failure }
```

A full example is in `examples/sinal-no-porto.yaml`.

**Rules the validator enforces** (same as the bot and the site editor):
- Each scene has exactly one of `choices`, `combat` or `end`.
- Every `next`, `win` and `lose` points to a scene that exists; every scene is reachable from `start`; no cycles; at least one `end`.
- `choices`: 2 to 4. Limits: title 80 characters, summary 300, scene text 1500, button label 80.
- Text is either one string or `{ pt-BR, en }`; pt-BR is required.
- For campaign chapters (`campaign`, `requires`, `reward.joinFaction`) use the **legion-campaign** skill.

## Canon policy (Marvel names)

- **Story may name** Marvel heroes, teams, villains and places: titles, scene text, button labels. "O Capitão América convoca você" is fine.
- **Identities stay original:** mission ids, enemy names, power names, item names and player codenames never use canon names. The validator rejects canon names where they are identities.
- Fights never name the enemy: ULTRON picks original machines from its list. Write the fight scene around "a machine", "a drone", or "a henchman working for <villain>", never "you fight Magneto".
- Famous villains stay behind the scenes (they send machines, they plot), not as the thing being hit.

## Balance

- Default XP (`jarvis.missions.rewards`): daily 40/10, weekly 120/30, story 80/20 (success/failure). Only set `xp` when the mission is clearly longer or shorter than usual; keep it within about ±50% of the default for its kind.
- Default credits (`jarvis.economy.missions`): daily 20/5, weekly 60/15, story 40/10. Same rule as XP: set `credits` only for an unusually long or short mission.
- Default limits: 1 daily per day, 1 weekly per week, each standalone story once.
- Length: 4 to 8 scenes is a good size. A daily is 1–2 decisions; a weekly or story 2–4.
- Fights: at most one in a daily, up to two elsewhere. A mission with a fight only appears when ULTRON and Sentinel are on; give a choice path to the fight, not a dead end before it.
- `difficulty` scales enemy stats: facil ×0.8, normal ×1.0, dificil ×1.25 (and one extra minion). `party` adds one enemy per player.
- `minLevel`: 1 for dailies; 3–5 for harder weeklies. Level 3 needs 200 XP, level 5 needs 800 (level = floor(√(XP / 50)) + 1).
- Give the player at least one real success path that does not depend on luck, and make failure endings short and kind ("tente de novo").

## pt-BR style

- Brazilian Portuguese, second person ("você"), present tense, short sentences. No "tu", no Portugal spellings (use "time", "trem", "ônibus").
- Buttons are short verb phrases: "Seguir os trilhos", not "Eu sigo os trilhos".
- Use the official Brazilian names of characters and teams: Capitão América, Homem de Ferro, Viúva Negra, Vingadores, Quarteto Fantástico, Doutor Destino, Tempestade, Ciclope, Mística.
- Dialogue uses straight double quotes. Inside a YAML string, either wrap the text in single quotes (`'Ele diz: "Vamos."'`) or escape them (`"Ele diz: \"Vamos.\""`).
- The English text says the same thing; it is not a looser rewrite.

## Validate

Run one of these and read every line:

```bash
# On the server (the data/ folder is mounted in the container):
docker compose run --rm legion legion content validate data/content/missions/resgate-no-metro.yaml
# From a clone of the repo, after `pnpm install && pnpm build`:
pnpm legion content validate path/to/resgate-no-metro.yaml
# Anywhere with Docker:
docker run --rm -v "$PWD:/work" ghcr.io/uminocelo/legion legion content validate /work/resgate-no-metro.yaml
```

Exit 0 means valid; 1 lists the errors (field and line); 2 means the file did not look like content (use `--type mission`). Never hand over a file that has not passed.
