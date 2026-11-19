---
name: legion-enemy
description: Write enemies for ULTRON in a Legion Discord RPG server (the machines and henchmen players fight in missions, invasions and raids) as a valid YAML list with balanced stats and original names. Use when the user asks for Legion enemies, "inimigos", minions, elites, bosses, or a file for /ultron inimigo importar. Always validate with `legion content validate` before handing the file over.
---

# Legion enemy

ULTRON builds every fight from a list of enemy templates. Sentinel runs the fight; numbers are decided by code, never by text. Enemies live in `data/content/enemies.yaml` (same `id` replaces a shipped one) or are imported by staff with `/ultron inimigo importar`.

## Workflow

1. Settle the tier, the level the enemy appears from, and the flavour (drone, cultist, mercenary robot...).
2. Pick stats from the **Balance** table, then adjust one or two stats to give it a personality.
3. Write the list, validate it (see **Validate**), fix every ❌, and hand over only a file that passes.

## Format

```yaml
- id: drone-vigia               # unique; lowercase, digits, "-" (2–41)
  name: "Drone Vigia"           # 2–60 characters; ORIGINAL, never a Marvel name
  tier: minion                  # minion | elite | boss
  minLevel: 1                   # appears for groups at this level or higher
  base: { hp: 60, atk: 8, def: 5, spd: 9, foc: 6 }   # integers; bosses use hp: 0
  powerCooldownMax: 4           # 1–10 rounds between powers
  tauntKeys: [ultron.taunt.generic.1]   # locale keys ULTRON may say; [] is fine
```

Example: `examples/enemies.yaml`.

**Rules the validator enforces:** the fields above; stats are integers from 0 to 5000 (`atk`, `def`, `spd`, `foc` at least 1); `hp` at least 1 except for bosses (a boss's HP comes from the event); ids never repeat in a file; the name is not a canon character.

`tauntKeys` must be keys that exist in ULTRON's locales, or the raw key shows up in chat. Safe keys: `ultron.taunt.generic.1`, `.2`, `.3`. A server can add its own lines in `locales/` and point to them.

## Canon policy

Enemy names are identities, so they are **always original**. Canon names such as "Magneto" are refused, and even when a name slips past the list, an enemy that is really a Marvel character breaks the policy. Tie an enemy to a villain through its name only in an original way ("Sentinela Latveriano", "Arauto do Titã Louco", "Cultista do Sol Negro"): the mission text can say who it works for.

## Balance

Shipped templates, for reference:

| Tier | minLevel | hp | atk | def | spd | foc | cooldown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| minion | 1–3 | 45–80 | 6–9 | 3–8 | 6–12 | 4–11 | 3–4 |
| elite | 5–8 | 120–140 | 11–12 | 9–12 | 8–10 | 10–12 | 3 |
| boss | 1 | 0 | 14–16 | 10–12 | 8–11 | 14–17 | 3 |

- Keep a new enemy inside its tier's range; trade stats (a fast minion has low def) instead of raising all of them.
- Encounters scale on top: `floor(base × (1 + 0.10 × (level − 1)) × difficulty)`, difficulty facil 0.8, normal 1.0, dificil 1.25. Do not pre-scale for high levels.
- Composition: one minion per player, +1 minion on dificil, +1 elite when the group is level 5+ (not on facil). Only enemies with `minLevel ≤ level` are picked.
- At least one `minion` with `minLevel: 1` must stay active, or encounters for new players cannot be built.
- Bosses are for invasions and raids (`ultron.invasion.templateId`, `ultron.raids.templateIds`), not for mission fights.

## pt-BR style

- Names in Brazilian Portuguese, two or three words, title case: "Drone Vigia", "Enxame de Nanites", "Caçador Sintético".
- Ids are the name in lowercase without accents, with "-": `cacador-sintetico`.

## Validate

```bash
docker compose run --rm legion legion content validate data/content/enemies.yaml
pnpm legion content validate path/to/enemies.yaml                      # from a clone, after pnpm build
docker run --rm -v "$PWD:/work" ghcr.io/uminocelo/legion legion content validate /work/enemies.yaml
```

Exit 0 means valid; 1 lists errors by item and field. Never hand over a file that has not passed.
