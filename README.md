# Legion

Kit de bots de RPG para Discord, **auto-hospedável**, inspirado nos X-Men. Um único container roda cinco "bots" (personas) que compartilham um banco de dados:

| Bot | Papel | Versão |
|---|---|---|
| **Cérebro** | Recepção, cadastro do mutante, facções e cargos | v0.1.0 ✅ |
| J.A.R.V.I.S. | XP, níveis, ranks, trivia, missões | v0.2.0 |
| H.E.R.B.I.E. | Tutorial e dicas | v0.3.0 |
| Sentinel | Combate e moderação | v0.4.0 |
| ULTRON | Eventos mundiais e raids | v0.4.0 |

> 📸 _Capturas de tela em breve._

## Início rápido (3 passos)

1. **Crie o app no Discord** (detalhes abaixo) e copie o token, o Application ID e o ID do seu servidor.
2. **Configure:**
   ```bash
   git clone https://github.com/uminocelo/legion && cd legion
   cp .env.example .env                              # preencha os 3 IDs/segredos
   cp legion.config.example.yaml legion.config.yaml  # preencha os canais
   ```
   Ou responda às perguntas: `docker run --rm -it -v "$PWD:/out" ghcr.io/uminocelo/legion legion init --out /out`
3. **Suba:**
   ```bash
   docker compose up -d
   docker compose run --rm legion legion doctor
   ```

Guia passo a passo para quem não é desenvolvedor (Windows, macOS, Linux, Raspberry Pi): [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Criar o app no Discord

1. Abra o [Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **General Information** → copie o **Application ID** → `DISCORD_CLIENT_ID`.
3. **Bot** → **Reset Token** → copie → `DISCORD_TOKEN` (nunca compartilhe).
4. **Bot → Privileged Gateway Intents** → ligue **Server Members Intent** (o Cérebro precisa para ver quem entra) e salve.
5. No Discord, ative **Configurações → Avançado → Modo desenvolvedor**, clique com o botão direito no servidor → **Copiar ID** → `DISCORD_GUILD_ID`.

## Convidar o bot

```bash
docker compose run --rm legion legion invite-url
```
Abra o link. Ele já pede só as permissões que os bots ligados usam (gerenciar cargos e canais, ver canais, enviar mensagens, embeds, comandos de barra).

### ⚠️ Suba o cargo do bot

O Discord só deixa um bot dar cargos **abaixo** do cargo mais alto dele. Em **Configurações do servidor → Cargos**, arraste o cargo do bot (o nome do seu app) para **acima** de todos os cargos que o Legion gerencia (Sinal Detectado, Mutante Registrado, X-Men, Irmandade, Independente, Recruta, Agente, Veterano, Aviso de Live, Vanguarda, Duelista, Estrategista). `legion doctor` e `/cerebro status` listam exatamente quais estão acima dele.

O cargo **Assinante TikTok** é da integração do TikTok: o Legion nunca cria, edita, dá ou tira esse cargo.

## Variáveis de ambiente (`.env`)

| Variável | Obrigatória | Padrão | Para quê |
|---|---|---|---|
| `DISCORD_TOKEN` | sim | — | Token do bot |
| `DISCORD_CLIENT_ID` | sim | — | Application ID |
| `DISCORD_GUILD_ID` | sim | — | ID do servidor |
| `<BOT>_TOKEN` + `<BOT>_CLIENT_ID` | não | — | App próprio para um bot, ex. `JARVIS_TOKEN` e `JARVIS_CLIENT_ID` ([um app por bot](docs/SELF_HOSTING.md#um-app-por-bot-opcional)) |
| `DATABASE_URL` | não | `file:./data/legion.db` | SQLite (padrão) ou `postgres://…` |
| `LOG_LEVEL` | não | `info` | `debug`, `info`, `warn`, `error` |
| `HEALTH_PORT` | não | `8080` | `GET /healthz` |

Todo o resto fica em `legion.config.yaml` — veja [docs/CONFIG.md](docs/CONFIG.md).

## Comandos

- `docker compose up -d` — inicia (e reinicia sozinho se cair).
- `docker compose run --rm legion legion doctor` — confere tudo e diz como corrigir cada ❌ (`--json` para scripts).
- `docker compose run --rm legion legion register-commands` — registra os comandos de barra agora.
- `docker compose logs -f` — logs.

No servidor: `/trivia`, `/ranking`, `/sequencia` e `/jarvis` (com J.A.R.V.I.S.), `/ajuda`, `/regras`, `/tutorial`, `/idioma` e `/herbie` (com H.E.R.B.I.E.), `/cerebro setup` (staff; simula por padrão, `aplicar:true` para aplicar, `canais:true` para esconder canais de quem não se registrou), `/cerebro status`, `/perfil`, `/cerebro preferencias`.

## Atualizar

```bash
docker compose pull && docker compose up -d
```
As migrações do banco rodam sozinhas ao iniciar. Fixe uma versão com `LEGION_VERSION=0.1.0` no `.env` se preferir.

## Backup

Tudo fica em `./data`. Pare (`docker compose stop`), copie a pasta `./data` e suba de novo. Com Postgres, use `pg_dump`.

## Ligar mais bots

Adicione o bot em `bots:` no `legion.config.yaml` (o Cérebro é sempre obrigatório) e reinicie. Disponíveis: `cerebro`, `jarvis` e `herbie`.

### J.A.R.V.I.S. (trivia e XP)

Com `bots: [cerebro, jarvis]`, rode `legion register-commands` (ou reinicie) e os membros registrados ganham:

- `/trivia [categoria]`: pergunta rápida e só sua (quadrinhos, Marvel Rivals, geral). Acerto rápido vale mais XP; há limite diário.
- `/ranking [período] [facção]`: quem mais ganhou XP na semana (começa na segunda), no mês ou no total.
- `/sequencia`: dias seguidos com XP e o bônus de amanhã.
- `/perfil` passa a mostrar nível, XP e sequência. Ao cruzar 500 e 2000 XP, o Cérebro troca o cargo para Agente e Veterano.

Staff: `/jarvis xp` (ajuste manual com motivo), `/jarvis trivia recarregar`, `/jarvis trivia estatisticas`, `/jarvis recalcular` (refaz o progresso a partir do histórico). Para adicionar perguntas suas, veja [docs/CONFIG.md](docs/CONFIG.md#perguntas).

### H.E.R.B.I.E. (tutorial e ajuda)

Com `herbie` em `bots:`, quem termina o cadastro recebe uma DM do H.E.R.B.I.E. com um tutorial curto (ver o `/perfil`, fazer uma `/trivia`, escolher preferências). Cada passo dá XP pelo J.A.R.V.I.S. Se a DM estiver fechada, a mensagem vai para `channels.tutorial` (ou o canal de boas-vindas), mencionando a pessoa.

- `/ajuda [tópico]`: o que fazer agora (conforme o momento do membro) e a lista de comandos dos bots ligados.
- `/regras [termo]`: regras do servidor ou um termo do glossário, com autocompletar.
- `/tutorial [reiniciar]`: checklist do tutorial; também começa para quem já estava registrado antes.
- `/idioma`: português ou inglês; as respostas privadas de todos os bots seguem a escolha.
- Dicas diárias opcionais (desligadas por padrão) e explicação dos eventos do ULTRON.

Staff: `/herbie status` (funil do tutorial) e `/herbie dica-agora`. Tutorial, glossário e dicas podem ser personalizados: veja [docs/CONFIG.md](docs/CONFIG.md#herbie).

## Desenvolvimento

Node 22+, pnpm 10. `pnpm install && pnpm build && pnpm test`. Veja [CONTRIBUTING.md](CONTRIBUTING.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e [docs/EVENTS.md](docs/EVENTS.md).

## Marcas e personagens

Legion, Cérebro, H.E.R.B.I.E., J.A.R.V.I.S., ULTRON, Sentinel, X-Men e todos os outros nomes da Marvel pertencem à Marvel/Disney. Este é um **projeto de fã gratuito e sem fins lucrativos**, sem afiliação com a Marvel ou a Disney. Personagens canônicos não podem ser usados como identidade de jogadores ou inimigos: todo mutante é original.

## Apoie

O projeto é mantido apenas por doações e patrocínios (GitHub Sponsors, Ko-fi, Apoia.se, PIX — links em breve). Benefícios de apoiador são apenas cosméticos; nada que afete o jogo é vendido.

## Licença

**A definir.** O mantenedor vai escolher entre MIT e AGPL antes do primeiro lançamento público estável. Até lá, nenhuma licença é concedida além do que o GitHub permite para repositórios públicos.
