---
name: legion-trivia
description: Write trivia questions for a Legion Discord RPG server (J.A.R.V.I.S. /trivia) as a valid YAML list in pt-BR, each with a real source, a fair difficulty and plausible wrong choices. Use when the user asks for Legion trivia, "perguntas de trivia", questions about comics, Marvel, Marvel Rivals or a new category, or a file for /jarvis trivia importar. Always validate with `legion content validate` before handing the file over.
---

# Legion trivia

`/trivia` asks a member one question with 2 to 4 buttons. A fast right answer pays more XP. Questions come from content files (`data/content/trivia/pt-BR.yaml` or `en.yaml`) or are imported by staff with `/jarvis trivia importar` (up to 50 per file).

## Workflow

1. Settle the category, how many questions and the mix of difficulties.
2. **Research each fact.** Every question needs a source the staff can open: a Wikipedia page, the Marvel Database (marvel.fandom.com), marvel.com, the publisher's page or the issue itself ("Amazing Fantasy #15 (1962)"). If you cannot confirm a fact, drop the question; never guess.
3. Write the list. Check that `answer` points at the right choice (it starts at 0).
4. Validate (see **Validate**), fix every ❌, and hand over only a file that passes. Remind the user that facts are not checked by the validator: they should skim them.

## Format

```yaml
- id: quad-0101                 # unique across every trivia file; lowercase, digits, "-" or "_" (2–64)
  category: quadrinhos          # must be in jarvis.trivia.categories
  difficulty: normal            # facil | normal | dificil
  question: "Em que revista o Homem-Aranha estreou?"     # 5–300 characters
  choices: ["Amazing Fantasy #15", "The Amazing Spider-Man #1", "Strange Tales #110", "Tales of Suspense #39"]
  answer: 0                     # index in choices, starting at 0
  explanation: "O Homem-Aranha estreou em Amazing Fantasy #15 (1962)."   # 1–300, shown after the answer
  source: https://en.wikipedia.org/wiki/Amazing_Fantasy   # 3–200, a link or a reference
  # locale: en                  # optional; otherwise the file name (pt-BR.yaml / en.yaml) decides
```

Example: `examples/trivia.yaml`.

**Rules the validator enforces:** the fields above and their limits; 2–4 choices of up to 80 characters; `answer` is a valid index; ids never repeat (across all files checked together); `category` is one of the server's categories.

Default categories: `quadrinhos`, `rivals` (Marvel Rivals), `geral`, `vingadores`, `quarteto`, `cosmico`, `mistico`. For a new one (for example `marvel-filmes`), the owner adds it to `jarvis.trivia.categories` in `legion.config.yaml` and restarts; validate with `--categories` listing all of them.

## Writing good questions

- One fact per question. Ask about something a fan can know, not trivia about trivia.
- Wrong choices are plausible and of the same kind (four issue numbers, four writers, four years). No joke answers, no "todas as anteriores".
- The bot **shuffles the choices**, so do not write "a primeira opção" or rely on order. Keep `answer` honest anyway.
- The explanation adds context in one sentence ("Stan Lee e Steve Ditko o criaram em 1962").
- Ids: a short category prefix plus a number (`quad-0101`, `ving-0042`). Never reuse a shipped id (shipped prefixes: `quad-`, `rivals-`, `geral-`, `ving-`, `quar-`, `cosm-`, `mist-`, numbered up to about 0030); start your numbers at 0101 or use your own prefix.

## Balance (difficulty and XP)

| Difficulty | Base XP | Who gets it right |
| --- | --- | --- |
| `facil` | 10 | Anyone who saw the films or a few comics: names, powers, famous catchphrases |
| `normal` | 15 | Regular readers: creators, first villains, team rosters, home bases |
| `dificil` | 25 | Collectors: issue numbers, writers of specific sagas, debut years |

A balanced set is about 40% facil, 40% normal, 20% dificil.

## Canon policy

Trivia is story, so Marvel names are fine in questions, choices and explanations. Ids stay generic (`ving-0042`, not `capitao-america-1`).

## pt-BR style

- Brazilian Portuguese, neutral and short. Questions end with "?".
- Use the Brazilian names (Homem-Aranha, Vingadores, Quarteto Fantástico, Doutor Destino), and the original English title for comic issues and sagas ("Amazing Fantasy #15", "Guerra Civil" is fine when the Brazilian title is the common one).
- Catchphrases: quote the original in English when the question is about the English text ("It's clobberin' time!").

## Validate

```bash
docker compose run --rm legion legion content validate data/content/trivia/pt-BR.yaml
pnpm legion content validate path/to/trivia.yaml                      # from a clone, after pnpm build
docker run --rm -v "$PWD:/work" ghcr.io/uminocelo/legion legion content validate /work/trivia.yaml
# A category the server added:
pnpm legion content validate trivia.yaml --categories quadrinhos,rivals,geral,vingadores,quarteto,cosmico,mistico,marvel-filmes
```

Exit 0 means valid; 1 lists each error with the item number, id and field. Never hand over a file that has not passed.
