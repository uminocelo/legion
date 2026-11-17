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
| `channels.tutorial` / `trivia` / `events` / `modQueue` / `combat` | `null` | Usados por bots futuros |
| `roles` | lista abaixo | Cargos gerenciados. Se definida, **substitui** a lista padrão inteira |
| `factions` | xmen, brotherhood, independent | `{ key, roleKey, emoji }` |
| `events.replayLookbackDays` | `7` | Quantos dias de eventos reprocessar no boot |
| `scheduler.pollIntervalMs` | `5000` | Intervalo do scheduler (mín. 500) |

IDs são *snowflakes* do Discord; escreva entre aspas (`'123…'`).

### `roles`

Campos: `key` (fixa; o código usa ela), `name` (o que aparece no Discord), `color` (`'#RRGGBB'` ou `null`), `group` (`staff`, `onboarding`, `faction`, `rank`, `community`, `rivals`), `managedBy` (`manual`, `cerebro`, `integration`, …), `hoist`, `mentionable`.

```yaml
roles:
  - { key: staff_owner, group: staff, name: Professor X, color: '#F1C40F', managedBy: manual, hoist: true }
  - { key: staff_council, group: staff, name: Conselho da Legião, color: '#9B59B6', managedBy: manual, hoist: true }
  - { key: staff_bots, group: staff, name: Sentinela, color: '#95A5A6', managedBy: manual }
  - { key: signal, group: onboarding, name: Sinal Detectado, color: null, managedBy: cerebro }
  - { key: registered, group: onboarding, name: Mutante Registrado, color: '#5DADE2', managedBy: cerebro }
  - { key: faction_xmen, group: faction, name: X-Men, color: '#3498DB', managedBy: cerebro, hoist: true }
  - { key: faction_brotherhood, group: faction, name: Irmandade, color: '#E74C3C', managedBy: cerebro, hoist: true }
  - { key: faction_independent, group: faction, name: Independente, color: '#2ECC71', managedBy: cerebro, hoist: true }
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

## `cerebro`

| Chave | Padrão | Descrição |
|---|---|---|
| `welcomePing` | `true` | Menciona o membro na mensagem de boas-vindas |
| `persistentWelcome` | `true` | Mantém uma mensagem fixa com o botão "Começar" no canal de boas-vindas |
| `publicRegistryCard` | `true` | Posta um cartão público quando alguém se registra |
| `codename.min` / `codename.max` | `2` / `32` | Tamanho do codinome |
| `archetypes` | os 6 | Subconjunto de `Telepata, Elemental, Metamorfo, Velocista, Tanque, Tecnopata` |
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
| `trivia.categories` | `[quadrinhos, rivals, geral]` | Categorias aceitas (letras minúsculas, `-`, `_`) |
| `trivia.timeLimitSeconds` | `20` | Tempo para responder; depois disso a pergunta expira com 0 XP |
| `trivia.cooldownSeconds` | `30` | Espera entre perguntas do mesmo membro |
| `trivia.noRepeatDays` | `30` | Não repete pergunta vista nesse período (se todas foram vistas, usa a mais antiga) |
| `trivia.dailyXpCap` | `300` | XP máximo de trivia por dia local; acertos acima disso dão 0 XP mas contam para a sequência |
| `trivia.baseXp` | `facil 10, normal 15, dificil 25` | XP por acerto |
| `trivia.speedBonusMax` | `5` | Bônus máximo por rapidez (proporcional ao tempo restante) |
| `levels.levelFactor` | `50` | XP para o nível n = `levelFactor × (n-1)²` |
| `levels.maxLevel` | `50` | Nível máximo |
| `ranks` | `recruta 0, agente 500, veterano 2000` | XP mínimo de cada rank; `recruta` deve ser 0 e os valores crescentes. O Cérebro troca os cargos |
| `streak.bonusPerDay` / `streak.bonusCap` | `5` / `7` | Bônus diário = `bonusPerDay × min(dias, bonusCap)` |
| `leaderboard.size` | `10` | Linhas do `/ranking` |
| `leaderboard.channelCooldownSeconds` | `15` | Intervalo mínimo do `/ranking` público por canal |

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
  source: https://…         # obrigatório
```

Ao iniciar, e com `/jarvis trivia recarregar`, as perguntas são sincronizadas pelo `id`: novas entram, alteradas são atualizadas e as que sumiram dos arquivos ficam inativas (nunca apagadas, para o histórico continuar válido). Se algum arquivo tiver erro, nada é desativado e a staff vê a lista de erros.

