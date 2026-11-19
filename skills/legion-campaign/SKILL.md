---
name: legion-campaign
description: Write a campaign for a Legion Discord RPG server (missions in chapters that unlock in order), including team recruitment arcs that end with reward.joinFaction, as valid YAML in pt-BR and en following Legion's canon policy and balance. Use when the user asks for a Legion campaign, a story arc, a recruitment arc for a team, "campanha", or an import file for /jarvis campanha importar. Always validate with `legion content validate` before handing the files over.
---

# Legion campaign

A campaign groups missions into **chapters** that unlock in order. Players see progress with `/campanha`. Progress comes from missions won: a chapter counts once it ends in **success**, and a lost chapter can be played again.

Kinds: `story` (any hero), `recruitment` (a team's arc: the last chapter puts the hero on the team), `tutorial` (the shipped `primeiro-contato`; do not write new ones).

Each chapter is a normal mission (see the **legion-mission** skill for scenes, choices and fights) with three extra fields: `campaign`, `requires` and, on a recruitment finale, `reward`.

## Two ways to deliver

1. **Import file** (staff, from Discord, no restart): one YAML with `campaign` and `missions`, imported with `/jarvis campanha importar` (up to 64 KB). Preview, then **Publicar** writes everything or nothing. Example: `examples/importar/noite-longa.yaml`.
2. **Content files** (server owner): one campaign file in `data/content/campaigns/<id>.yaml` and one file per chapter in `data/content/missions/<id>.yaml`; restart to load. Example: `examples/arquivos/`.

Ask which one the user wants; default to the import file.

## Workflow

1. Settle the kind, the team (for recruitment), the number of chapters, party size and where the fights go.
2. Write the campaign, then each chapter. pt-BR first, then en.
3. Validate the whole set at once (the validator checks chapters, `requires` and cycles across files). Fix every ❌.
4. Hand over only files that pass.

## Format

Campaign:

```yaml
id: sombras-da-cidade           # unique; lowercase, digits, "-"; no Marvel names
kind: story                     # story | recruitment | tutorial
title: { pt-BR: "Sombras sobre a cidade", en: "Shadows over the city" }
summary: { pt-BR: "Um mistério em três capítulos.", en: "A mystery in three chapters." }
# faction: avengers             # required for recruitment, refused otherwise
```

Chapter (a mission with these extra fields):

```yaml
id: sombras-2
kind: story                     # chapters are kind: story
campaign: { id: sombras-da-cidade, chapter: 2 }
requires:                       # every field optional; each one present must be met
  missions: [sombras-1]         # won before
  level: 3                      # minimum level, on top of minLevel
  origins: [ciencia, tecnologia]
  factions: [independent, xmen] # the hero's current team
# reward: { joinFaction: avengers }   # recruitment finale only
title: ...
```

Import file:

```yaml
campaign: { id: ..., kind: ..., title: ..., summary: ... }
missions:
  - { id: ...-1, campaign: { id: ..., chapter: 1 }, ... }
  - { id: ...-2, campaign: { id: ..., chapter: 2 }, requires: { missions: [...-1] }, ... }
```

**Rules the validator enforces:**
- The campaign of each chapter exists; each chapter number appears once.
- Every mission in `requires.missions` exists (in the file, the folder or the shipped content) and there are no cycles.
- `reward.joinFaction` only in a `recruitment` campaign, for that campaign's `faction`.
- In an import file, every mission is a chapter of that campaign, and ids of shipped campaigns and missions are refused.
- All mission rules (scenes, 2–4 choices, reachable endings, text limits) apply to each chapter.

Teams (`faction` keys): `xmen`, `brotherhood` (Mutante and Inumano only), `avengers`, `shield`, `guardians`, `defenders`, `thunderbolts`, `midnight_sons`, `independent`. Origins: `mutante`, `inumano`, `ciencia`, `tecnologia`, `mistico`, `cosmico`, `treinado`.

## Recruitment arcs

- 3–4 chapters. Chapter 1 has `requires: { level: 3 }`; each later chapter requires the previous one; the **last** chapter has a fight and `reward: { joinFaction: <team> }`.
- A team that only takes some origins (the Irmandade) keeps its arc locked for the others automatically; you do not need `requires.origins`.
- The arc is hidden from heroes already on the team. Joining also respects `cerebro.teams.switchCooldownDays` (30 days since the last switch); Cérebro decides, not the file.
- Every team already ships an arc. A server arc for the same team is fine (use a new id); to replace a shipped one, use its id in a content file (imports refuse shipped ids).

## Canon policy (Marvel names)

- Story text, titles and buttons may name Marvel characters, teams, villains and places; team members make good NPCs (Tempestade teaching a class, Nick Fury giving orders).
- Ids, enemy names and anything that is an identity stay original. The validator refuses canon names in identities.
- Fights are against ULTRON's original machines. Villains stay behind the scenes ("uma máquina a serviço do Doutor Destino").

## Balance

- Chapters use story XP by default (80 success / 20 failure). A 3-chapter arc pays about 240 XP when won; do not raise `xp` per chapter.
- One fight per arc is the minimum; two in a 4-chapter campaign is the most. Put the hardest fight last.
- `party`: 1 for recruitment arcs (each hero joins alone); story campaigns may use up to 4. In a party every member must meet `requires`.
- Difficulty: `facil` for the opening chapters, `normal` for the finale; `dificil` only for optional end-game campaigns with `level` 8+.

## pt-BR style

- Brazilian Portuguese, "você", present tense, short sentences.
- Chapter titles: "<Campaign title> N: <chapter name>", e.g. "Teste dos Vingadores 2: A Viúva Negra".
- Official Brazilian names: Vingadores, Irmandade, Guardiões da Galáxia, Defensores, Filhos da Meia-Noite, Quarteto Fantástico, Professor Xavier, Senhor das Estrelas.
- Endings: success names what changed; failure invites another try ("Treine e volte").

## Validate

Validate the folder (content files) or the import file:

```bash
docker compose run --rm legion legion content validate data/content
pnpm legion content validate path/to/noite-longa.yaml          # from a clone, after pnpm build
docker run --rm -v "$PWD:/work" ghcr.io/uminocelo/legion legion content validate /work/noite-longa.yaml
```

Exit 0 means valid; 1 lists errors by file and field; ⚠️ on a `requires` that names a missing mission means the chapter stays locked (allowed in files, but fix it before handing over). Never hand over files that have not passed.
