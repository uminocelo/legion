# Legion skills for AI agents

Five skills that teach an AI coding agent (Claude Code, or any agent that reads Markdown instructions) how to write content for a Legion server and how to set one up:

| Skill | For |
| --- | --- |
| `legion-mission` | One mission: scenes, choices, fights, endings |
| `legion-campaign` | A campaign: chapters that unlock in order, recruitment arcs |
| `legion-trivia` | Trivia questions with sources |
| `legion-enemy` | ULTRON's enemies: stats and tiers |
| `legion-setup` | Installing Legion, `legion.config.yaml` and `legion doctor` |

Every skill ends the same way: the agent runs `legion content validate` on what it wrote and only hands over a file with no ❌. The validator uses the bots' own rules, so a file that passes is a file the bots load.

The skills are plain text. They hold no tokens, call no server and never read `.env`.

Install: see https://uminocelo.github.io/legion/skills.html (or `website/src/skills.html`).
