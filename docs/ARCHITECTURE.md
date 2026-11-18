# Arquitetura

Um processo Node.js, uma conta de bot no Discord, um banco (SQLite ou Postgres). Cada "bot" é um módulo que o runtime carrega; eles nunca se chamam diretamente, só trocam eventos.

## Monorepo

```mermaid
flowchart LR
  subgraph apps
    runner["apps/runner<br/>processo principal"]
    cli["apps/cli<br/>legion init/doctor/..."]
  end
  subgraph packages
    core["packages/core<br/>DB, bus, scheduler, router,<br/>RoleService, i18n, game math"]
    cerebro["packages/bot-cerebro"]
    future["bot-jarvis · bot-herbie ·<br/>bot-sentinel · bot-ultron (futuro)"]
  end
  runner --> core
  runner --> cerebro
  cli --> runner
  cli --> core
  cerebro --> core
  future -.-> core
```

## Boot do runner

```mermaid
sequenceDiagram
  participant R as runner
  participant C as config
  participant DB as banco
  participant RT as CoreRuntime
  participant D as Discord
  R->>C: lê .env e legion.config.yaml
  R->>R: importa só os bots em "bots:"
  C-->>R: valida tudo (erros legíveis → sai com código 1)
  R->>DB: abre e roda migrações (core + cada bot)
  R->>RT: loadBots: locales, comandos, componentes, register()
  R->>D: login (intents = união dos bots)
  D-->>R: ClientReady
  R->>RT: ready(): registra comandos se mudaram, replay de eventos,<br/>jobs recorrentes, scheduler, onReady() de cada bot
  Note over R: /healthz responde 200 (DB ok + Discord pronto)
  R->>RT: SIGTERM → stop(): drena handlers e jobs, fecha DB
```

## Fluxo de eventos

`bus.emit(tx, …)` grava o evento em `core_event_log` **na mesma transação** da mudança. Só depois do commit o evento é entregue (outbox). Entrega é *at-least-once*: cada consumidor registra `(consumerId, eventId)` em `core_event_consumption`; falhas são re-tentadas pelo scheduler (1s, 5s, 30s, 2m, 10m) e eventos não consumidos são reprocessados no boot.

```mermaid
flowchart LR
  cerebro((Cérebro)) -- member.joined --> sentinel((Sentinel))
  cerebro -- player.created --> jarvis((J.A.R.V.I.S.))
  cerebro -- player.created --> herbie((H.E.R.B.I.E.))
  cerebro -- player.rejoined --> jarvis
  jarvis -- rank.changed --> cerebro
  jarvis -- xp.awarded / level.changed --> herbie
  router[[core router]] -- command.executed --> herbie
  any[qualquer bot] -- report.flagged --> sentinel
  jarvis -- combat.requested --> sentinel
  sentinel -- combat.resolved --> jarvis
  ultron((ULTRON)) -- world.event --> any
```

Catálogo completo: [EVENTS.md](EVENTS.md).

## Cérebro: máquina de estados do cadastro

O passo fica em `members.onboarding_step`. Botões antigos ou repetidos nunca avançam nem voltam o estado: mostram a tela do passo atual.

```mermaid
stateDiagram-v2
  [*] --> joined: entra no servidor<br/>(cargo Sinal Detectado)
  joined --> rules_accepted: aceita as regras
  rules_accepted --> origin_chosen: escolhe a origem
  origin_chosen --> origin_chosen: escolhe poderes / arquétipo
  origin_chosen --> rules_accepted: Trocar origem
  origin_chosen --> registered: envia a ficha válida<br/>(facção inicial, transação + player.created)
  registered --> registered: sai e volta<br/>(cargos restaurados, player.rejoined)
  registered: Mutante Registrado + 1 facção + Recruta
```

Antes da v0.9 o terceiro passo era `faction_chosen`; a migração `0002_hero_origins` muda esses membros para `rules_accepted` (eles escolhem a origem e mantêm a facção). Veja o [ADR 0031](adr/0031-hero-origins.md).

Cargos são aplicados **depois** do commit. Se o Discord falhar, o banco continua certo e o job `cerebro.reconcile-member` acerta os cargos depois.

## Interações

Componentes usam ids `<bot>:v<versão>:<ação>:<args>`; um id desconhecido ou de versão antiga recebe "este botão expirou". Todo handler roda com limite de taxa e uma barreira de erro que responde `core.errors.generic` em vez de derrubar o processo. Ver [ADR 0001](adr/0001-node-typescript-over-elixir.md).
