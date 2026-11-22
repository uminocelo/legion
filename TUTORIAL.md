# Tutorial: seu servidor com o Legion, do zero ao primeiro jogo

Para quem é **dono ou staff de um servidor** e quer colocar o Legion no ar. No fim você terá os cinco bots rodando, os cargos criados, o guia "como jogar" fixado e terá feito você mesmo o caminho de um jogador novo.

Comece criando o servidor pelo [modelo do Legion](docs/TEMPLATE.md): ele já traz as categorias, os canais e as áreas das equipes. Para a visão geral, leia o [playbook](https://uminocelo.github.io/legion/playbook-montar.html).

Leva cerca de **40 minutos**. Cada etapa termina com um **✅ Confira**: só siga quando ele bater.

Referências usadas no caminho: [README](README.md) (resumo), [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) (Docker e problemas comuns), [docs/CONFIG.md](docs/CONFIG.md) (todas as opções).

---

## 0. O que você precisa

- Um servidor do Discord em que você é **dono** ou tem **Administrador**.
- Um computador que fica ligado: Windows, macOS, Linux ou um Raspberry Pi 4/5 (64-bit). O Legion usa pouco: um container e um arquivo SQLite.
- [Docker](https://www.docker.com/products/docker-desktop/) instalado (veja o [passo 1 do guia de hospedagem](docs/SELF_HOSTING.md#1-instale-o-docker)).
- No Discord: **Configurações → Avançado → Modo desenvolvedor** ligado (para copiar IDs com o botão direito).

## 1. Prepare os canais

Crie (ou escolha) estes canais. Os nomes são livres; o Legion usa os IDs.

| Canal | Para quê | Quem vê |
|---|---|---|
| `#boas-vindas` | O Cérebro recebe quem chega e mantém o botão **Começar** | Todos |
| `#regras` | Regras do servidor e o guia "como jogar" fixado | Todos |
| `#registro` | Cartões públicos de novos mutantes (opcional) | Todos |
| `#missoes` | Tópicos das missões do J.A.R.V.I.S. | Registrados |
| `#combate` | Tópicos de treino e lutas do Sentinel | Registrados |
| `#eventos` | Invasões e raids do ULTRON | Registrados |
| `#fila-moderacao` | Denúncias para a staff | **Só a staff** |

Com o botão direito em cada canal → **Copiar ID**, anote os IDs num bloco de notas.

**✅ Confira:** você tem 6 ou 7 IDs (números longos, como `1572018586715824168`) e o ID do servidor (botão direito no ícone do servidor → **Copiar ID**).

## 2. Crie o app do Cérebro no Discord

O Cérebro é o bot principal: recebe membros, cria cargos e cuida do cadastro. Os outros bots usam o mesmo app, a não ser que você dê um app próprio para eles (passo 9).

1. Abra o [Developer Portal](https://discord.com/developers/applications) → **New Application** → nome **Cérebro**.
2. **General Information:** escolha um avatar e copie o **Application ID**.
3. **Bot:**
   - **Username:** Cérebro (é o nome que aparece no chat).
   - **Reset Token** → copie o token. **Ele é uma senha: nunca cole em chats nem prints.**
   - Em **Privileged Gateway Intents**, ligue **Server Members Intent** e salve.

**✅ Confira:** você tem o token e o Application ID, e a Server Members Intent está ligada.

## 3. Baixe e configure

```bash
git clone https://github.com/uminocelo/legion && cd legion
```
(Sem git: no GitHub, **Code → Download ZIP** e abra um terminal na pasta.)

O jeito mais fácil é responder às perguntas do `legion init`, que cria o `.env` e o `legion.config.yaml`:

```bash
docker run --rm -it -v "$PWD:/out" ghcr.io/uminocelo/legion legion init --out /out
```
(No PowerShell: `"${PWD}:/out"`.)

Se preferir à mão, copie `.env.example` para `.env` e preencha:

```
CEREBRO_TOKEN=        # token do passo 2
CEREBRO_CLIENT_ID=    # Application ID do passo 2
DISCORD_GUILD_ID=     # ID do servidor
```

> Instalou uma versão antiga? `DISCORD_TOKEN` e `DISCORD_CLIENT_ID` ainda funcionam, mas o `legion doctor` vai pedir para renomear para `CEREBRO_TOKEN` e `CEREBRO_CLIENT_ID` (mesmos valores).

Depois copie `legion.config.example.yaml` para `legion.config.yaml` e ajuste duas partes:

```yaml
bots: [cerebro, jarvis, herbie, sentinel, ultron]

channels:
  welcome: "ID do #boas-vindas"
  rules: "ID do #regras"
  registry: "ID do #registro"
  missions: "ID do #missoes"
  combat: "ID do #combate"
  events: "ID do #eventos"
  modQueue: "ID do #fila-moderacao"
```

Use **aspas** nos IDs. Quer começar menor? `bots: [cerebro, jarvis, herbie]` já dá cadastro, trivia, XP e tutorial; ligue Sentinel e ULTRON depois.

**✅ Confira:** existem os arquivos `.env` e `legion.config.yaml` na pasta, e o `.env` nunca vai para o git (ele já está no `.gitignore`).

## 4. Convide o bot e suba o cargo dele

```bash
docker compose run --rm legion legion invite-url
```

Abra o link, escolha o servidor e autorize. O link já pede só as permissões que os bots ligados usam (cargos, canais, mensagens, tópicos, fixar mensagens e, com o Sentinel, moderar membros).

Agora o passo que mais dá problema: em **Configurações do servidor → Cargos**, arraste o cargo **Cérebro** para **acima** de todos os cargos que o Legion gerencia (facções, ranks, Sinal Detectado, Herói Registrado e os cargos de aviso). O Discord só deixa um bot dar cargos abaixo do cargo mais alto dele.

**✅ Confira:** o Cérebro aparece na lista de membros (offline por enquanto) e o cargo dele está no topo dos cargos do Legion.

## 5. Ligue e confira

```bash
docker compose run --rm legion legion doctor
```

O `doctor` testa o token, o app, a intent, os canais, as permissões e o conteúdo. Cada ❌ vem com uma linha dizendo como corrigir. Corrija e rode de novo até sobrar só ✅ e ⚠️ (avisos, como "cargo ainda não existe", somem no passo 6).

```bash
docker compose up -d
docker compose logs -f
```

Espere a linha `Legion is ready` e saia dos logs com `Ctrl+C` (o bot continua rodando).

**✅ Confira:** o Cérebro está **online** no Discord e digitar `/` mostra comandos como `/perfil` e `/ajuda`. Se os comandos não aparecerem, rode `docker compose run --rm legion legion register-commands` e reabra o Discord.

## 6. Configure o servidor com `/cerebro setup`

No Discord, num canal da staff:

1. `/cerebro setup` mostra **o que faria**, sem mudar nada: cargos que vão ser criados, cores que vão mudar.
2. `/cerebro setup aplicar:true` aplica.
3. Opcional: `/cerebro setup aplicar:true canais:true` esconde os canais de quem ainda não se registrou, para que o membro novo veja primeiro o `#boas-vindas`. Canais da staff e os de `cerebro.setup.excludeChannelIds` não são tocados.
4. `/cerebro status` confirma que o cargo do bot está acima de todos os cargos gerenciados.

Dê os cargos **Professor X** (dono) e **Conselho da Legião** (staff) para as pessoas certas. O Legion cria esses cargos, mas nunca os dá sozinho.

**✅ Confira:** os cargos X-Men, Irmandade, Independente, Recruta, Agente e Veterano existem, e `/cerebro status` não mostra problemas.

## 7. Libere os comandos da staff

Os comandos `/jarvis`, `/herbie`, `/sentinel` e `/ultron` vêm visíveis só para administradores. Se a staff não tem Administrador:

1. **Configurações do servidor → Integrações → Cérebro → Gerenciar.**
2. Em cada um desses comandos: **Adicionar cargos ou membros** → Professor X e Conselho da Legião → ✅.
3. Salve.

**✅ Confira:** `legion doctor` mostra `staff-commands` como ok, e alguém do Conselho vê `/jarvis` ao digitar `/`.

## 8. Publique o guia "como jogar"

```
/herbie guia publicar
```

O H.E.R.B.I.E. posta o guia em `#regras` e fixa a primeira mensagem. O guia só mostra as partes dos bots ligados. Ao atualizar o Legion, rode de novo: as mesmas mensagens são editadas, sem duplicar.

Para mudar o texto, copie `packages/bot-herbie/content/guide.pt-BR.yaml` para `data/content/guide.pt-BR.yaml`, edite e publique de novo.

**✅ Confira:** o guia está fixado em `#regras`. Se ele não foi fixado, dê ao bot a permissão **Fixar mensagens** nesse canal e rode de novo.

## 9. Faça o caminho de um jogador

Use uma segunda conta (ou peça a um amigo) e faça tudo como um membro novo:

1. Entre no servidor: o Cérebro dá as boas-vindas em `#boas-vindas`.
2. Clique em **Começar** → aceite as regras → escolha a facção → o **poder principal** (ele define o arquétipo) → até 2 secundários → preencha codinome, descrição e origem.
3. `/perfil`: a ficha vem com o **cartão** em imagem. **Compartilhar** posta no canal.
4. O H.E.R.B.I.E. manda o tutorial por DM (ou no canal, se a DM estiver fechada). Siga os passos: cada um dá XP.
5. `/trivia`, depois `/missao lista` e `/missao iniciar`.
6. Com o Sentinel: `/treino` abre uma luta contra o Drone de Treino em `#combate`.
7. Com o ULTRON: `/ameaca` mostra o próximo evento. A staff pode testar com `/ultron evento iniciar`.

**✅ Confira:** a conta de teste ganhou os cargos de registrado, da facção e Recruta, e `/ranking` mostra o XP dela.

Algo travou? Veja [Problemas comuns](docs/SELF_HOSTING.md#problemas-comuns). `docker compose logs` quase sempre diz o motivo.

## 10. Opcional: um app para cada bot

Se quiser que J.A.R.V.I.S., H.E.R.B.I.E., Sentinel e ULTRON apareçam como membros separados, com nome e avatar próprios, crie um app para cada um e adicione ao `.env`:

```
JARVIS_TOKEN=
JARVIS_CLIENT_ID=
```

Detalhes em [Um app por bot](docs/SELF_HOSTING.md#um-app-por-bot-opcional). Lembre de liberar os comandos da staff (passo 7) no app de cada bot.

## Dia a dia

| Quero… | Faça |
|---|---|
| Atualizar | `docker compose pull && docker compose up -d`, depois `/herbie guia publicar` |
| Fixar uma versão | `LEGION_VERSION=1.1.0` no `.env` |
| Cuidar do servidor pela web | Ligue o [painel da staff](docs/DASHBOARD.md): membros, economia, eventos, guerra e ações com auditoria |
| Backup | `docker compose stop`, copie a pasta `data/`, `docker compose up -d` |
| Criar perguntas de trivia | `/jarvis trivia nova`, ou várias no [editor de trivia](https://uminocelo.github.io/legion/editor-trivia.html) e `/jarvis trivia importar` ([docs/STAFF.md](docs/STAFF.md)) |
| Criar itens para a loja | Monte no [editor de itens](https://uminocelo.github.io/legion/editor-itens.html) e importe com `/jarvis item importar` ([docs/ECONOMY.md](docs/ECONOMY.md#criar-itens)) |
| Criar missões ou inimigos | Monte no [editor de missões](https://uminocelo.github.io/legion/editor-missoes.html) ou no [de inimigos](https://uminocelo.github.io/legion/editor-inimigos.html); importe com `/jarvis missao importar` ou `/ultron inimigo importar` |
| Ajustar XP de alguém | `/jarvis xp` (sempre com motivo) |
| Ver denúncias | `#fila-moderacao` e `/sentinel denuncias` |
| Agendar um evento | `/ultron evento agendar` |
| Conferir a saúde | `docker compose run --rm legion legion doctor` |

Pronto: chame os amigos.
