# Missões

Missões são histórias curtas com escolhas. Um membro registrado usa `/missao iniciar`, a missão abre um tópico em `channels.missions` e cada cena mostra botões. Em grupo (missões com `party` maior que 1), o líder abre um grupo, os outros clicam em **Entrar** e o líder clica em **Começar**.

- **Escolhas em grupo:** a maioria decide; empate fica com o voto do líder. Se o tempo (`jarvis.missions.choiceTimeoutMinutes`) acabar com alguns votos, eles decidem; sem nenhum voto, a missão é abandonada (sem XP).
- **Lutas:** uma cena de luta envia `mission.started` com `missionType: combat`. O ULTRON cria os inimigos (escalados pelo nível do grupo e pela dificuldade da missão) e o Sentinel conduz a luta no próprio tópico. Vitória segue para `win`, derrota (ou empate) para `lose`. Sem resultado em `combatTimeoutMinutes`, a missão fracassa. Missões com luta só aparecem quando `ultron` e `sentinel` estão em `bots`.
- **XP:** pago a cada membro no fim (sucesso ou fracasso), uma vez só, pelo J.A.R.V.I.S. (`reason: mission`). Quem saiu do servidor não recebe. Os valores vêm de `jarvis.missions.rewards`, por tipo, ou do campo `xp` da missão.
- **Créditos (v0.10):** pagos junto com o XP, uma vez só, com a mesma regra. Valores de `jarvis.economy.missions`, por tipo, ou do campo `credits` da missão (0 a 10000). Missão abandonada não paga ([ECONOMY.md](ECONOMY.md#créditos)).
- **Limites:** por padrão, 1 missão diária por dia, 1 semanal por semana (segunda a domingo) e cada história uma vez (`jarvis.missions.limits`). Cada membro do grupo gasta o seu limite. Um grupo que fecha sem começar não conta.
- **Reinício:** o progresso fica no banco. Ao reiniciar, a cena que faltava postar é postada uma vez e os prazos continuam.

## Importar pelo Discord

A staff pode importar um arquivo de missão sem acesso ao servidor: `/jarvis missao importar` e anexe o `.yaml`. Veja [STAFF.md](STAFF.md#missões). Para montar o arquivo sem escrever YAML, use o [editor de missões](https://uminocelo.github.io/legion/editor-missoes.html): ele confere tudo com as mesmas regras deste documento.

## Escrever uma missão

Crie um arquivo por missão em `./data/content/missions/<id>.yaml` (no Docker, `data/` é o volume do servidor). Um arquivo com o mesmo `id` de uma missão que vem com o Legion a substitui. Reinicie o Legion para carregar. Rode `legion doctor` para ver erros.

```yaml
id: resgate-no-metro            # único; letras minúsculas, números e "-"
kind: daily                     # daily | weekly | story
title:                          # texto único ou por idioma (pt-BR obrigatório, en opcional)
  pt-BR: Resgate no metrô
  en: Subway rescue
summary: Um trem parou entre duas estações e ninguém responde.
minLevel: 1                     # nível mínimo (padrão 1)
party: 2                        # até quantos jogadores (1 a 4; padrão 1)
difficulty: normal              # facil | normal | dificil (escala os inimigos)
xp: { success: 50, failure: 10 } # opcional; sem ele vale jarvis.missions.rewards
credits: { success: 25, failure: 5 } # opcional (v0.10); sem ele vale jarvis.economy.missions
start: plataforma               # cena inicial
scenes:
  plataforma:
    text: O túnel está escuro. Há uma porta de manutenção e os trilhos.
    choices:                    # 2 a 4 escolhas
      - { label: Porta de manutenção, next: corredor }
      - { label: Seguir os trilhos, next: emboscada }
  corredor:
    text: O corredor leva direto ao trem. Os passageiros estão bem.
    end: success
  emboscada:
    text: Drones do ULTRON bloqueiam os trilhos.
    combat: { win: trem, lose: recuo } # luta: precisa do ULTRON e do Sentinel
  trem:
    text: Os drones caem e vocês liberam o trem.
    end: success
  recuo:
    text: Vocês recuam. O trem fica parado até a manhã.
    end: failure
```

Regras que o Legion confere:

- Cada cena tem exatamente um de `choices`, `combat` ou `end`.
- Toda escolha e luta aponta para uma cena que existe, toda cena é alcançável a partir de `start`, não há ciclos (a história sempre termina) e há pelo menos um `end`.
- A história pode citar personagens, equipes e lugares da Marvel (título, cenas e botões): "O Capitão América convoca você" vale. Os **inimigos** das lutas continuam originais; veja [UNIVERSE.md](UNIVERSE.md).
- Um arquivo com erro não é carregado e a versão anterior da missão continua valendo. Missões que somem dos arquivos ficam inativas (o histórico continua).

## Campanhas

Uma **campanha** junta missões em capítulos que liberam em ordem. O jogador vê o progresso com `/campanha` (todas) ou `/campanha campanha:<id>` (os capítulos: ✅ feito, ▶️ disponível, 🔒 bloqueado com o motivo). O progresso vem das missões terminadas com **sucesso**: não há outra tabela para sincronizar.

Cada campanha é um arquivo em `./data/content/campaigns/<id>.yaml` (o mesmo `id` de uma campanha que vem com o Legion a substitui):

```yaml
id: sombras-da-cidade           # único; letras minúsculas, números e "-"
kind: story                     # tutorial | recruitment | story
title: { pt-BR: Sombras sobre a cidade, en: Shadows over the city }
summary: { pt-BR: Um mistério em três capítulos., en: A mystery in three chapters. }
# faction: avengers             # só em kind: recruitment (a equipe que recruta)
```

As missões apontam para a campanha e dizem o que precisam:

```yaml
id: sombras-2
kind: story
campaign: { id: sombras-da-cidade, chapter: 2 }
requires:
  missions: [sombras-1]         # terminadas com sucesso
  level: 3                      # nível mínimo (além do minLevel)
  origins: [ciencia, tecnologia] # origens aceitas
  factions: [independent, xmen] # equipe atual do herói
title: Rastros no porto
# ... summary, start e scenes como qualquer missão
```

- Todos os campos de `requires` são opcionais; cada um que aparece precisa ser cumprido.
- **Em grupo**, todo membro precisa cumprir. Quem não cumpre pode entrar no grupo, mas o grupo mostra o que falta para cada um e o líder só começa quando todos cumprem.
- No `/missao iniciar`, missões bloqueadas não aparecem na lista; digitar o id de uma mostra "Bloqueada: falta …".
- **Tutorial** (`kind: tutorial`): o Legion já vem com a campanha `primeiro-contato` (três capítulos, o último com luta), que o tutorial do H.E.R.B.I.E. segue ([TUTORIAL.md](TUTORIAL.md)).
- **Recrutamento** (`kind: recruitment`, com `faction`): a missão final pode ter `reward: { joinFaction: <equipe> }`, que tem de ser a equipe da campanha. O arco some para quem já está nessa equipe e para todos quando a equipe está desligada. O arco também segue a regra de origens da equipe (`origins`). Quando o grupo termina a missão com `joinFaction` com **sucesso**, o J.A.R.V.I.S. pede a entrada de cada membro (`faction.join_requested`) e o Cérebro decide: confere se a equipe está ligada, a origem, se o herói já está nela e o prazo de `cerebro.teams.switchCooldownDays` desde a última troca. O resultado aparece no tópico da missão, um por membro ("X entrou para Y" ou o motivo, com a data quando é o prazo). Falha ou abandono não pedem nada. A staff ainda pode mover alguém com `/cerebro equipe mover`, sem prazo.

Regras que o Legion confere (no arquivo, no editor e no import):

- a campanha da missão existe e cada capítulo aparece uma vez;
- toda missão em `requires.missions` existe, e não há ciclo (A exige B, B exige A);
- `joinFaction` só numa campanha de recrutamento, para a equipe dela, e a equipe está ligada.

No `/missao lista`, cada campanha mostra só o próximo capítulo (o primeiro ainda não vencido); o `/campanha` mostra todos.

Um capítulo de campanha só conta como jogado quando é vencido: quem perde pode tentar de novo. Uma história avulsa (sem `campaign`) continua sendo de uma vez só, a não ser com `missions.limits.storyRepeatable: true`.

Num arquivo do servidor, uma missão com erro é ignorada (❌ no `legion doctor`). Um `requires` que cita uma missão que ainda não existe só bloqueia a missão (⚠️ no `legion doctor`).

### Importar uma campanha pelo Discord

`/jarvis campanha importar arquivo:` com um `.yaml` que tem a campanha e as missões juntas:

```yaml
campaign:
  id: noite-longa
  kind: story
  title: Noite longa
  summary: Três capítulos numa noite.
missions:
  - id: noite-1
    campaign: { id: noite-longa, chapter: 1 }
    # ... o resto da missão
  - id: noite-2
    campaign: { id: noite-longa, chapter: 2 }
    requires: { missions: [noite-1] }
    # ...
```

O J.A.R.V.I.S. mostra uma prévia com os capítulos; **Publicar** grava tudo de uma vez (um erro em qualquer missão não grava nada). Ids de campanhas e missões que vêm com o Legion são recusados. O editor de missões do site baixa esse arquivo pronto.
