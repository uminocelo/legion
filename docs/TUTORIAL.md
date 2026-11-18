# Tutorial

Quem termina o cadastro recebe do H.E.R.B.I.E. um tutorial curto. Desde a v0.9 o tutorial é a campanha **Primeiro contato** do J.A.R.V.I.S.: a pessoa aprende jogando, e o H.E.R.B.I.E. acompanha cada passo.

## Os passos

| # | Passo (`id`) | O que fazer | Termina quando | XP |
| --- | --- | --- | --- | --- |
| 1 | `perfil` | `/perfil` | o comando roda | 20 |
| 2 | `capitulo-1` | `/missao iniciar primeiro-contato-1`: escolhas, sozinho | o capítulo 1 termina com **sucesso** | 30 |
| 3 | `primeira-trivia` | `/trivia` | qualquer resposta, certa ou errada | 20 |
| 4 | `capitulo-2` | `/missao iniciar primeiro-contato-2`: em grupo (até 2) ou sozinho | o capítulo 2 termina com sucesso | 30 |
| 5 | `capitulo-3` | `/missao iniciar primeiro-contato-3`: a primeira luta (ULTRON e Sentinel) | o capítulo 3 termina com sucesso | 40 |

Ao terminar: bônus de 50 XP e uma mensagem sobre as **equipes**: todo herói começa Independente, cada equipe tem um arco de recrutamento em `/campanha`, os arcos abrem no nível 3 e quem termina o último capítulo entra para a equipe.

- Só o passo atual conta: fazer um passo antes da hora não adianta, e o texto do passo diz o que fazer.
- Perder um capítulo não conta, mas o capítulo pode ser jogado de novo até vencer (capítulos de campanha só ficam "jogados" quando vencidos).
- Cada passo dá XP uma vez, mesmo que o evento chegue duas vezes.
- `/tutorial` mostra o checklist; `/tutorial reiniciar` retoma quem pulou, sem pagar de novo os passos feitos.
- A mensagem vai por DM; se a DM estiver fechada, vai para `channels.tutorial` (ou o canal de boas-vindas), mencionando a pessoa.

## Sem algum bot

| Situação | O que muda |
| --- | --- |
| Sem J.A.R.V.I.S. (ou `jarvis.missions.enabled: false`) | O capítulo 1 vira `/cerebro preferencias` e o capítulo 2 vira `/heroi poderes`. Sem J.A.R.V.I.S., a trivia some e não há XP |
| Sem ULTRON ou Sentinel | A luta não existe, então o passo do capítulo 3 some |
| Sem J.A.R.V.I.S. | O convite não fala da campanha e a mensagem final diz para falar com a staff para entrar numa equipe |

## Quem já tinha feito o tutorial antigo

O tutorial antigo se chamava `boas-vindas`. Na primeira vez que o bot liga na v0.9, o progresso de todo mundo passa para `primeiro-contato`, sem mensagem:

- quem completou ou pulou continua completo ou pulado, e não é convidado de novo;
- quem estava no meio continua do primeiro passo novo que ainda não fez. Os passos com o mesmo id (`perfil`, `primeira-trivia`, `preferencias`) contam como feitos.

Se o servidor tem o próprio `tutorial.yaml` com `chain: boas-vindas`, nada muda.

## Personalizar

Copie `packages/bot-herbie/content/tutorial.yaml` para `./data/content/tutorial.yaml` e edite. Um arquivo com erro mantém a versão anterior (veja o log e o `legion doctor`).

```yaml
chain: primeiro-contato
intro:                       # opcional: texto do convite ({count} = número de passos)
  bodyKey: herbie.tutorial.intro_campaign
  requiresBot: jarvis
  fallbackBodyKey: herbie.tutorial.intro   # quando o J.A.R.V.I.S. não está ligado
steps:
  - id: capitulo-1
    titleKey: herbie.quest.capitulo1.title
    bodyKey: herbie.quest.capitulo1.body
    requiresBot: jarvis
    requiresFeature: missions           # missions | mission-combat (missões com luta)
    trigger: { event: mission.completed, where: { missionId: primeiro-contato-1, outcome: success } }
    fallback:                           # usado quando o bot ou o recurso não está ligado
      id: preferencias
      titleKey: herbie.quest.preferencias.title
      bodyKey: herbie.quest.preferencias.body
      trigger: { event: command.executed, where: { command: cerebro, subcommand: preferencias } }
    rewardXp: 30
completionRewardXp: 50
completion:                  # opcional: texto extra ao terminar
  bodyKey: herbie.tutorial.final_teams
  requiresBot: jarvis
  fallbackBodyKey: herbie.tutorial.final_teams_staff
```

- `trigger.event`: `command.executed`, `trivia.answered`, `mission.completed`, `level.changed` ou `streak.updated`. `where` compara campos exatos do evento ([EVENTS.md](EVENTS.md)). Em `mission.completed`, `missionId` é o id da missão no arquivo dela.
- Os textos ficam nos locales do H.E.R.B.I.E. (`titleKey`, `bodyKey`).
- Os capítulos são a campanha `primeiro-contato` do J.A.R.V.I.S. ([MISSIONS.md](MISSIONS.md#campanhas)); um arquivo do servidor com o mesmo id substitui a campanha ou um capítulo.

Decisões: [ADR 0017](adr/0017-data-driven-tutorial-quests.md) (passos com gatilhos de eventos) e [ADR 0032](adr/0032-campaigns-and-team-joins.md) (campanhas).
