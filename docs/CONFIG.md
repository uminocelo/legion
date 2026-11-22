# Configuração (`legion.config.yaml`)

Segredos ficam no `.env` (veja o README; tokens por bot em [SELF_HOSTING](SELF_HOSTING.md#um-app-por-bot-opcional)). Tudo aqui tem padrão; um arquivo com só `bots: [cerebro]` e os canais já funciona. Erros aparecem como `legion.config.yaml → caminho.da.chave: motivo` e impedem o boot.

## Chaves gerais

| Chave | Padrão | Descrição |
|---|---|---|
| `locale` | `pt-BR` | Idioma padrão: `pt-BR` ou `en` |
| `timezone` | `America/Sao_Paulo` | Fuso IANA usado para "dias" |
| `bots` | `[cerebro]` | Bots ligados; `cerebro` é obrigatório quando há outros. Valores: `cerebro`, `jarvis`, `herbie`, `sentinel`, `ultron` |
| `channels.welcome` | `null` | Canal de boas-vindas (Cérebro) |
| `channels.rules` | `null` | Canal de regras |
| `channels.registry` | `null` | Cartões públicos de cadastro (`null` = usa `welcome`) |
| `channels.tutorial` | `null` | H.E.R.B.I.E.: tutorial de quem tem DM fechada (vazio = usa `welcome`) |
| `channels.events` | `null` | Eventos do ULTRON; o H.E.R.B.I.E. explica cada anúncio aqui |
| `channels.combat` | `null` | Sentinel: onde os combates abrem tópicos (vazio = canal onde o `/treino` foi usado) |
| `channels.missions` | `null` | J.A.R.V.I.S.: onde as missões abrem tópicos (vazio = `channels.combat`, senão o canal do `/missao`) |
| `channels.modQueue` | `null` | Sentinel: fila de denúncias, visível só para a staff |
| `channels.trivia` | `null` | Usado por bots futuros |
| `roles` | lista abaixo | Cargos gerenciados. Se definida, **substitui** a lista padrão inteira |
| `factions` | as 9 equipes (abaixo) | `{ key, roleKey, emoji, origins? }`. Sem a chave, vale a lista padrão com as equipes cujo cargo existe em `roles`. Tirar uma equipe a desliga ([UNIVERSE.md](UNIVERSE.md#equipes)) |
| `events.replayLookbackDays` | `7` | Quantos dias de eventos reprocessar no boot |
| `scheduler.pollIntervalMs` | `5000` | Intervalo do scheduler (mín. 500) |
| `dashboard.enabled` | `false` | Painel web da staff; precisa de `DASHBOARD_CLIENT_SECRET` ([DASHBOARD.md](DASHBOARD.md)) |
| `dashboard.port` | `8081` | Porta do painel |
| `dashboard.publicUrl` | `http://localhost:8081` | Endereço do painel no navegador (o Discord volta para `<publicUrl>/callback`) |
| `dashboard.sessionHours` | `12` | Duração do login (1–720) |
| `dashboard.auditDays` | `180` | Dias que a auditoria é guardada |

IDs são *snowflakes* do Discord; escreva entre aspas (`'123…'`).

### `roles`

Campos: `key` (fixa; o código usa ela), `name` (o que aparece no Discord), `color` (`'#RRGGBB'` ou `null`), `group` (`staff`, `onboarding`, `faction`, `rank`, `community`, `rivals`), `managedBy` (`manual`, `cerebro`, `integration`, …), `hoist`, `mentionable`. `renamedFrom` (opcional): nomes antigos do cargo; o Cérebro renomeia um cargo achado por um deles em vez de criar outro.

```yaml
roles:
  - { key: staff_owner, group: staff, name: Professor X, color: '#F1C40F', managedBy: manual, hoist: true }
  - { key: staff_council, group: staff, name: Conselho da Legião, color: '#9B59B6', managedBy: manual, hoist: true }
  - { key: staff_bots, group: staff, name: Sentinela, color: '#95A5A6', managedBy: manual }
  - { key: signal, group: onboarding, name: Sinal Detectado, color: null, managedBy: cerebro }
  - { key: registered, group: onboarding, name: Herói Registrado, renamedFrom: [Mutante Registrado], color: '#5DADE2', managedBy: cerebro }
  - { key: faction_xmen, group: faction, name: X-Men, color: '#3498DB', managedBy: cerebro, hoist: true }
  - { key: faction_brotherhood, group: faction, name: Irmandade, color: '#E74C3C', managedBy: cerebro, hoist: true }
  - { key: faction_independent, group: faction, name: Independente, color: '#2ECC71', managedBy: cerebro, hoist: true }
  - { key: faction_avengers, group: faction, name: Vingadores, color: '#D4AC0D', managedBy: cerebro, hoist: true }
  - { key: faction_shield, group: faction, name: S.H.I.E.L.D., color: '#566573', managedBy: cerebro, hoist: true }
  - { key: faction_guardians, group: faction, name: Guardiões, color: '#8E44AD', managedBy: cerebro, hoist: true }
  - { key: faction_defenders, group: faction, name: Defensores, color: '#E67E22', managedBy: cerebro, hoist: true }
  - { key: faction_thunderbolts, group: faction, name: Thunderbolts, color: '#17A589', managedBy: cerebro, hoist: true }
  - { key: faction_midnight_sons, group: faction, name: Filhos da Meia-Noite, color: '#6C3483', managedBy: cerebro, hoist: true }
  - { key: rank_recruta, group: rank, name: Recruta, color: null, managedBy: cerebro }
  - { key: rank_agente, group: rank, name: Agente, color: null, managedBy: cerebro }
  - { key: rank_veterano, group: rank, name: Veterano, color: null, managedBy: cerebro }
  - { key: tiktok_sub, group: community, name: Assinante TikTok, color: null, managedBy: integration }
  - { key: supporter, group: community, name: Apoiador, color: null, managedBy: manual }
  - { key: live_ping, group: community, name: Aviso de Live, color: null, managedBy: cerebro }
  - { key: rivals_vanguard, group: rivals, name: Vanguarda, color: null, managedBy: cerebro }
  - { key: rivals_duelist, group: rivals, name: Duelista, color: null, managedBy: cerebro }
  - { key: rivals_strategist, group: rivals, name: Estrategista, color: null, managedBy: cerebro }
```

Regras: `tiktok_sub` precisa ter `managedBy: integration` (o Legion nunca toca nesse cargo). Cargos `manual` são criados se faltarem, mas nunca dados a ninguém. Os bots nunca apagam cargos nem renomeiam cargos que não gerenciam.


### `factions`

As equipes ([UNIVERSE.md](UNIVERSE.md#equipes)). Cada uma aponta para um cargo do grupo `faction` em `roles`. `origins` limita quem pode entrar (sem a chave, todas as origens). Nomes e descrições ficam nos textos (`cerebro.faction.<key>`).

```yaml
factions:
  - { key: independent, roleKey: faction_independent, emoji: 🟢 }
  - { key: xmen, roleKey: faction_xmen, emoji: 🔵 }
  - { key: brotherhood, roleKey: faction_brotherhood, emoji: 🔴, origins: [mutante, inumano] }
  - { key: avengers, roleKey: faction_avengers, emoji: 🟡 }
  - { key: shield, roleKey: faction_shield, emoji: ⚫ }
  - { key: guardians, roleKey: faction_guardians, emoji: 🟣 }
  - { key: defenders, roleKey: faction_defenders, emoji: 🟠 }
  - { key: thunderbolts, roleKey: faction_thunderbolts, emoji: ⚡ }
  - { key: midnight_sons, roleKey: faction_midnight_sons, emoji: 🌙 }
```

## `cerebro`

| Chave | Padrão | Descrição |
|---|---|---|
| `welcomePing` | `true` | Menciona o membro na mensagem de boas-vindas |
| `persistentWelcome` | `true` | Mantém uma mensagem fixa com o botão "Começar" no canal de boas-vindas |
| `publicRegistryCard` | `true` | Posta um cartão público quando alguém se registra |
| `codename.min` / `codename.max` | `2` / `32` | Tamanho do codinome |
| `origins` | as 7, nesta ordem | Origens do cadastro: lista de `{ key, emoji }` com `mutante`, `inumano`, `ciencia`, `tecnologia`, `mistico`, `cosmico`, `treinado`. A ordem é a do menu; tire uma para escondê-la. Chave desconhecida ou repetida é erro. Nomes e descrições ficam nos textos (`cerebro.origin.<key>`). Veja [UNIVERSE.md](UNIVERSE.md#origens) |
| `teams.startFaction` | `independent` | Equipe de quem acaba de se registrar. Se não existir em `factions`, vale a primeira da lista (e o `legion doctor` mostra ❌) |
| `teams.switchCooldownDays` | `30` | Dias entre duas trocas de equipe pelas missões de recrutamento (0 a 365). A staff (`/cerebro equipe mover`) não espera |
| `archetypes` | os 6 | Subconjunto de `Telepata, Elemental, Metamorfo, Velocista, Tanque, Tecnopata` |
| `powers.enabled` | `true` | Cadastro com o catálogo de poderes ([POWERS.md](POWERS.md)). `false` volta o menu de arquétipos |
| `powers.maxSecondary` | `2` | Quantos poderes secundários (0 a 2) |
| `powers.typeToArchetype` | ofensivo→Metamorfo, defensivo→Tanque, psiônico→Telepata, elemental→Elemental, movimento→Velocista, utilitário→Tecnopata | Arquétipo de cada tipo de poder principal. Poderes de tipos cujo arquétipo não está em `archetypes` não aparecem |
| `powers.allowArchetypeChange` | `false` | `/heroi poderes` e `/heroi origem` podem trocar o arquétipo de quem já se registrou |
| `optInRoles` | `live_ping`, `rivals_*` | Keys de cargos que o membro liga/desliga sozinho (máx. 20) |
| `canonAttemptFlag.count` / `.windowMinutes` | `3` / `10` | Tentativas de nome canon antes de avisar a staff |
| `setup.excludeChannelIds` | `[]` | Canais que `/cerebro setup canais:true` nunca toca |

## Textos (`locales/`)

Qualquer texto pode ser trocado sem mexer no código: crie `locales/pt-BR.json` (ou `en.json`) ao lado do `legion.config.yaml` só com as chaves que quer mudar, por exemplo as regras:

```json
{ "cerebro": { "rules": { "summary": "1. Respeite todos.\n2. Sem spam.\n3. Divirta-se!" } } }
```

As chaves existentes estão em `packages/*/locales/pt-BR.json`.

## `jarvis`

| Chave | Padrão | Descrição |
|---|---|---|
| `trivia.categories` | `[quadrinhos, rivals, geral, vingadores, quarteto, cosmico, mistico]` | Categorias aceitas (letras minúsculas, `-`, `_`). Pode acrescentar outras, como `marvel`; sem texto no locale, aparece o próprio nome |
| `trivia.timeLimitSeconds` | `20` | Tempo para responder; depois disso a pergunta expira com 0 XP |
| `trivia.cooldownSeconds` | `30` | Espera entre perguntas do mesmo membro |
| `trivia.noRepeatDays` | `30` | Não repete pergunta vista nesse período (se todas foram vistas, usa a mais antiga) |
| `trivia.dailyXpCap` | `300` | XP máximo de trivia por dia local; acertos acima disso dão 0 XP mas contam para a sequência |
| `trivia.baseXp` | `facil 10, normal 15, dificil 25` | XP por acerto |
| `trivia.speedBonusMax` | `5` | Bônus máximo por rapidez (proporcional ao tempo restante) |
| `trivia.review` | `none` | Perguntas criadas com `/jarvis trivia nova`: `none` entram em jogo na hora; `second_staff` esperam outra pessoa da staff aprovar (em `channels.modQueue`, senão no canal do comando) |
| `levels.levelFactor` | `50` | XP para o nível n = `levelFactor × (n-1)²` |
| `levels.maxLevel` | `50` | Nível máximo |
| `ranks` | `recruta 0, agente 500, veterano 2000` | XP mínimo de cada rank; `recruta` deve ser 0 e os valores crescentes. O Cérebro troca os cargos |
| `streak.bonusPerDay` / `streak.bonusCap` | `5` / `7` | Bônus diário = `bonusPerDay × min(dias, bonusCap)` |
| `leaderboard.size` | `10` | Linhas do `/ranking` |
| `leaderboard.channelCooldownSeconds` | `15` | Intervalo mínimo do `/ranking` público por canal |
| `missions.enabled` | `true` | Liga o `/missao` (e os capítulos do tutorial do H.E.R.B.I.E.; desligado, o tutorial usa os passos de reserva) |
| `missions.rewards.daily` | `successXp 40, failureXp 10` | XP de uma missão diária; o arquivo da missão pode definir `xp` próprio |
| `missions.rewards.weekly` | `successXp 120, failureXp 30` | XP de uma missão semanal |
| `missions.rewards.story` | `successXp 80, failureXp 20` | XP de uma missão de história |
| `missions.limits.dailyPerMember` | `1` | Missões diárias por membro por dia (fuso do servidor) |
| `missions.limits.weeklyPerMember` | `1` | Missões semanais por membro por semana (segunda a domingo) |
| `missions.limits.storyRepeatable` | `false` | `false`: cada história só pode ser jogada uma vez. Um capítulo de campanha só conta depois de vencido: quem perde pode tentar de novo |
| `missions.choiceTimeoutMinutes` | `10` | Sem escolha nesse tempo, a missão é abandonada (sem XP) |
| `missions.combatTimeoutMinutes` | `15` | Sem resultado da luta nesse tempo, a missão fracassa |
| `missions.lobbyTimeoutMinutes` | `5` | Tempo para um grupo se formar |
| `economy.enabled` | `true` | `false`: nenhum pagamento de créditos; `/carteira` e `/inventario` continuam funcionando |
| `economy.trivia.correct` | `2` | Créditos por resposta certa (o limite diário de XP da trivia não bloqueia) |
| `economy.missions.daily` / `weekly` / `story` | `success 20, failure 5` / `60, 15` / `40, 10` | Créditos no fim de uma missão, por tipo (o campo `credits` da missão tem prioridade) |
| `economy.worldEvents.victory` / `participation` | `30` / `10` | Créditos para cada participante de um evento do mundo que termina em vitória / derrota |
| `economy.war.winner` | `50` | Créditos para cada herói da facção vencedora que pontuou na guerra. Empate paga todas. `0` não paga. Com a economia desligada, a guerra acontece e ninguém recebe |
| `economy.gear.statCap` | `2` | Quanto o equipamento soma, no total, a cada atributo (vida: `statCap × 8`). `0` = equipamento só visual ([ECONOMY.md](ECONOMY.md)) |

### Perguntas

As perguntas vêm de `packages/bot-jarvis/content/trivia/*.yaml` (30 em pt-BR) e de pacotes do servidor em `./data/content/trivia/*.yaml`. O nome do arquivo (`pt-BR.yaml`, `en.yaml`) define o idioma. Cada item:

```yaml
- id: meu-servidor-0001     # único e estável; mudar o id cria outra pergunta
  category: geral           # precisa estar em jarvis.trivia.categories
  difficulty: normal        # facil | normal | dificil
  question: Pergunta?
  choices: ["A", "B", "C", "D"]   # 2 a 4, sem repetir
  answer: 2                 # índice em choices, começando em 0
  explanation: Por que C.
  source: https://…         # obrigatório: link ou referência ("Shang-Chi #4 (2021)")
```

Ao iniciar, e com `/jarvis trivia recarregar`, as perguntas são sincronizadas pelo `id`: novas entram, alteradas são atualizadas e as que sumiram dos arquivos ficam inativas (nunca apagadas, para o histórico continuar válido). Se algum arquivo tiver erro, nada é desativado e a staff vê a lista de erros.

## `herbie`

| Chave | Padrão | Descrição |
|---|---|---|
| `delivery` | `dm` | `dm`: tutorial por DM (canal de reserva se a DM falhar); `channel`: sempre no canal |
| `tutorial.enabled` | `true` | Liga o tutorial para quem se registra |
| `tutorial.allowSkip` | `true` | Mostra o botão "Pular tutorial" |
| `tips.enabled` | `false` | Dica diária num canal |
| `tips.channelId` | `null` | Canal das dicas (obrigatório se ligadas) |
| `tips.cron` | `0 12 * * *` | Horário da dica, no `timezone` do servidor |
| `explainWorldEvents` | `true` | Explica anúncios do ULTRON em `channels.events` |

### Conteúdo do H.E.R.B.I.E.

Os arquivos vêm em `packages/bot-herbie/content/`. Para personalizar, copie o arquivo para `./data/content/` com o mesmo nome; o do servidor tem prioridade. Se ele tiver erro, o H.E.R.B.I.E. avisa no log e continua com a versão anterior.

- `tutorial.yaml`: os passos. Cada passo tem `id`, `titleKey`/`bodyKey` (textos nos locales), `trigger` (`event` entre `command.executed`, `trivia.answered`, `mission.completed`, `level.changed`, `streak.updated`, e `where` com campos exatos do evento), `rewardXp`, e opcionalmente `requiresBot`, `requiresFeature` (`missions` ou `mission-combat`) e `fallback` (passo usado quando o bot/recurso não está ligado). `completionRewardXp` é o bônus final; `intro` e `completion` trocam os textos do convite e do fim. Detalhes em [TUTORIAL.md](TUTORIAL.md).
- `glossary.pt-BR.yaml` / `glossary.en.yaml`: termos do `/regras` (`id`, `term`, `aliases`, `summary` até 300 caracteres, `details` até 1500, `related`, `bot` opcional para esconder quando o bot está desligado). Use aspas nos textos com `:`.
- `tips.pt-BR.yaml` / `tips.en.yaml`: dicas (`id`, `text`, `bot` opcional), postadas em rodízio sem repetir.
- `guide.pt-BR.yaml` / `guide.en.yaml`: o guia "como jogar" do `/herbie guia publicar`, no idioma do servidor (`id`, `title` até 256 caracteres, `body` até 4000, `bot` opcional). Republique depois de editar.

Textos dos passos (`herbie.quest.*`) podem ser trocados pela pasta `./locales` (veja `locales/README.txt`).

## `sentinel`

| Chave | Padrão | Descrição |
|---|---|---|
| `combat.maxRounds` | `20` | Rodadas máximas por combate |
| `combat.roundTimeoutSeconds` | `45` | Tempo para escolher a ação |
| `combat.powerCooldownRounds` | `3` | Recarga do Poder, em rodadas |
| `combat.abandonAfterIdleRounds` | `3` | Rodadas seguidas sem ninguém agir até o abandono |
| `training.cooldownSeconds` | `300` | Espera entre treinos |
| `training.dummyAtkMultiplier` | `0.7` | Ataque do drone (Tanque no seu nível × este valor) |
| `rateLimits.commandsPerMinute` | `20` | Comandos por membro por minuto (todos os bots) |
| `rateLimits.componentsPer10Seconds` | `15` | Botões por membro a cada 10 s |
| `rateLimits.reportsPerHour` | `3` | Denúncias por membro por hora |
| `rateLimits.violationsToFlag` | `5` | Bloqueios em 10 min até avisar a staff |
| `antiCheat.xpAnomalyPerHour` | `600` | XP por hora acima do qual a staff é avisada (ajustes da staff não contam) |
| `antiCheat.newAccountDays` | `7` | Contas mais novas que isso geram um aviso (`0` desliga) |
| `moderation.enabled` | `true` | Fila e botões de moderação |
| `moderation.timeoutOptionsMinutes` | `[10, 60]` | Botões de timeout (1 a 4 opções) |

Regras do combate: [COMBAT.md](COMBAT.md).

## `ultron`

Precisa do `sentinel` em `bots:` e de `channels.events` quando invasões, raids agendadas ou a guerra de facções estão ligadas.

| Chave | Padrão | Descrição |
|---|---|---|
| `combat.maxRounds` | `20` | Rodadas máximas das lutas de missão |
| `scaling.growth` | `0.10` | Crescimento dos atributos por nível |
| `scaling.difficultyMultiplier` | `{ facil: 0.8, normal: 1.0, dificil: 1.25 }` | Multiplicador por dificuldade |
| `adaptive.enabled` | `false` | Dificuldade adaptativa |
| `adaptive.windowCombats` / `minSample` | `50` / `10` | Combates considerados / mínimo para ajustar |
| `adaptive.target` / `maxAdjust` | `0.65` / `0.15` | Taxa de vitória alvo / ajuste máximo |
| `events.pingRoleKey` | `null` | Cargo (chave em `roles`) marcado no anúncio. Deixe o cargo mencionável no Discord. Nunca @everyone |
| `events.announceMinutesBefore` | `60` | Anúncio antes do início |
| `events.strikeCooldownMinutes` | `10` | Espera entre ataques (o dobro para quem cai) |
| `events.hpPerParticipant` / `expectedParticipants` | `300` / `8` | HP compartilhado = um × outro × dificuldade |
| `events.difficulty` | `normal` | Dificuldade dos eventos |
| `events.bossLevel` | `auto` | Nível do chefe (`auto` = mediana do último evento, ou 5) |
| `events.rewards` | `{ victoryXp: 50, bonusXpMax: 50, participationXp: 15 }` | XP dos participantes |
| `invasion.enabled` / `cron` | `true` / `"0 20 * * 6"` | Invasão semanal, no fuso do servidor |
| `invasion.durationMinutes` / `templateId` | `60` / `enxame-de-nanites` | Duração / inimigo |
| `invasion.waves` | `threat` | Ondas por invasão: `threat` (pelo medidor: 1, 2 ou 3) ou um número de 1 a 5 |
| `invasion.waveHpGrowth` | `0.25` | HP extra de cada onda em relação à anterior (0,25 = +25%) |
| `threat.enabled` | `true` | Liga o medidor de ameaça (tique diário às 00:10) e o campo **Ameaça** do `/ameaca` |
| `threat.idleRise` / `activeFall` | `10` / `5` | Quanto a ameaça sobe num dia quieto / cai num dia ativo |
| `threat.activeActions` | `3` | Missões terminadas + ataques num dia para ele contar como ativo |
| `raids.cron` | `null` | Raids automáticas (`null` = só pela staff) |
| `raids.durationMinutes` / `templateIds` | `45` / `[bastiao-prime]` | Duração / chefes possíveis |
| `ai.provider` | `none` | `none` ou `openai-compatible` (veja SELF_HOSTING.md) |
| `war.enabled` | `true` | Liga a guerra de facções. `false` não agenda a próxima e não pontua; uma guerra que já está ativa ainda encerra |
| `war.length` | `month` | `month` (começa no dia 1, no fuso do servidor) ou um número de dias entre 7 e 90 |
| `war.points.missionSuccess` / `missionFailure` | `10` / `3` | Pontos de uma missão vencida / perdida. Abandonada não pontua |
| `war.points.strike` | `2` | Pontos de um ataque em invasão ou raid |
| `war.points.participation` | `5` | Pontos por participar de um evento do mundo que termina em vitória ou derrota |
| `ai.timeoutMs` / `maxCallsPerHour` | `4000` / `30` | Limites da IA |

Inimigos e eventos: [WORLD_EVENTS.md](WORLD_EVENTS.md).

