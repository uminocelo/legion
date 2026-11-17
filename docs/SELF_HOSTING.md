# Hospedar o Legion (passo a passo)

Para quem nunca usou Docker. Leva uns 10 minutos.

## 1. Instale o Docker

- **Windows / macOS:** baixe e instale o [Docker Desktop](https://www.docker.com/products/docker-desktop/). Abra o app e espere aparecer "Engine running".
- **Linux (Ubuntu/Debian):** `curl -fsSL https://get.docker.com | sh` e depois `sudo usermod -aG docker $USER` (saia e entre de novo).
- **Raspberry Pi (4 ou 5, sistema 64-bit):** igual ao Linux. A imagem do Legion tem versão ARM64.

Teste num terminal (PowerShell no Windows): `docker --version`.

## 2. Baixe o Legion

Com git: `git clone https://github.com/uminocelo/legion && cd legion`.
Sem git: na página do GitHub, **Code → Download ZIP**, descompacte e abra um terminal nessa pasta.

Você só precisa de três arquivos: `docker-compose.yml`, `.env.example` e `legion.config.example.yaml`.

## 3. Crie o app no Discord

Siga "Criar o app no Discord" no [README](../README.md#criar-o-app-no-discord). Ao final você terá: token, Application ID e ID do servidor. **Não esqueça de ligar a "Server Members Intent".**

## 4. Preencha a configuração

Jeito fácil (perguntas no terminal):

```bash
docker run --rm -it -v "$PWD:/out" ghcr.io/uminocelo/legion legion init --out /out
```
(No PowerShell troque `"$PWD:/out"` por `"${PWD}:/out"`.)

Jeito manual: copie `.env.example` para `.env` e `legion.config.example.yaml` para `legion.config.yaml`, e preencha. Os IDs dos canais você copia no Discord com o botão direito → **Copiar ID** (precisa do Modo desenvolvedor).

## 5. Convide o bot e suba o cargo dele

```bash
docker compose run --rm legion legion invite-url
```
Abra o link, escolha seu servidor e autorize. Depois, em **Configurações do servidor → Cargos**, arraste o cargo do bot para cima de todos os cargos do Legion (veja o [README](../README.md#️-suba-o-cargo-do-bot)).

## 6. Confira e ligue

```bash
docker compose run --rm legion legion doctor
docker compose up -d
```
O `doctor` mostra ✅/⚠️/❌ e, para cada ❌, uma linha dizendo como corrigir. Rode de novo até não sobrar ❌.

No Discord, como staff (ou dono do servidor), rode `/cerebro setup`. Ele mostra o que faria; rode `/cerebro setup aplicar:true` para aplicar. Para esconder os canais de quem ainda não se registrou, use `canais:true` também (canais de staff e os excluídos em `cerebro.setup.excludeChannelIds` não são tocados).

## Um app por bot (opcional)

Por padrão todos os bots falam pelo mesmo app do Discord (o do Cérebro, `CEREBRO_TOKEN`). Se quiser que cada bot apareça separado, com nome, avatar, status e comandos próprios, crie um app para ele:

1. No [Developer Portal](https://discord.com/developers/applications), **New Application** (ex.: "J.A.R.V.I.S."), escolha nome e avatar. Em **Bot → Reset Token**, copie o token. Em **General Information**, copie o **Application ID**.
2. No `.env`, adicione os dois juntos (ou rode `legion init` e escolha "Um app por bot"):
   ```
   JARVIS_TOKEN=…
   JARVIS_CLIENT_ID=…
   ```
3. `legion invite-url` mostra um link por app, cada um só com as permissões daquele bot. Abra o do novo app e adicione-o ao servidor.
4. Reinicie (`docker compose up -d`). Os comandos do bot passam para o app dele e somem do app compartilhado (ou rode `legion register-commands`).
5. `legion doctor` confere cada app separadamente.

Detalhes:
- O app do **Cérebro** é o principal: é ele que cria e troca cargos e vê quem entra. Só ele precisa da **Server Members Intent** e do cargo acima dos cargos gerenciados. Esse é o app do `CEREBRO_TOKEN`.
- Tudo continua num processo e num banco; nenhum dado muda. Para voltar a um app só, apague as duas linhas do `.env` e reinicie.
- Mensagens e botões antigos de um bot continuam no app que os enviou; depois da troca, use o comando de novo.

## Problemas comuns

| Sintoma | Causa | Correção |
|---|---|---|
| `CEREBRO_TOKEN inválido` nos logs | Token errado ou trocado | Developer Portal → Bot → Reset Token, atualize o `.env`, `docker compose up -d` |
| `Intents privilegiadas não liberadas` | Server Members Intent desligada | Ligue em Developer Portal → Bot e reinicie |
| Membros não ganham cargos | Cargo do bot está abaixo | Arraste o cargo do bot para cima (`/cerebro status` lista quais) |
| Comandos não aparecem | Discord ainda não atualizou | `legion register-commands` e reabra o Discord |
| Container "unhealthy" | Bot não conectou | `docker compose logs` mostra o motivo |
| Staff não vê `/jarvis`, `/ultron`… | Cargo da staff sem Administrador | Veja abaixo |

### Guia "como jogar" fixado

Depois de configurar os canais, rode `/herbie guia publicar` (por padrão em `channels.rules`). O H.E.R.B.I.E. posta o guia e fixa a primeira mensagem; para fixar ele precisa de **Fixar mensagens** no canal (o convite novo já pede). Ao atualizar o Legion, rode de novo: a mesma mensagem é editada.

### Comandos da staff não aparecem

Os comandos da staff (`/jarvis`, `/herbie`, `/sentinel`, `/ultron`) vêm marcados como "só administradores", e um bot não pode mudar isso sozinho. Se os cargos **Professor X** e **Conselho da Legião** não têm Administrador, libere uma vez:

1. Configurações do servidor → **Integrações**.
2. Clique no bot (ou no app de cada bot, se usa [um app por bot](#um-app-por-bot-opcional)) → **Gerenciar**.
3. Em cada comando da staff (`/jarvis`, `/herbie`, `/sentinel`, `/ultron`): **Adicionar cargos ou membros** → escolha Professor X e Conselho da Legião → marque ✅.
4. Salve. O `legion doctor` passa a mostrar `staff-commands` como ok.

Mesmo vendo o comando, só quem tem esses cargos (ou é dono) consegue usá-lo.

## Atualizar, backup, parar

- Atualizar: `docker compose pull && docker compose up -d`
- Backup: pare com `docker compose stop` e copie a pasta `data/`
- Parar: `docker compose down` (os dados em `data/` ficam)

## IA opcional (Ollama)

O ULTRON pode escrever provocações e anúncios com IA. Os números do jogo nunca vêm da IA. Desligado por padrão.

1. No `docker-compose.yml`, o serviço `ollama` só sobe com o perfil `ai`:
   ```bash
   docker compose --profile ai up -d
   docker compose exec ollama ollama pull llama3.2
   ```
2. No `.env`: `AI_BASE_URL=http://ollama:11434/v1` e `AI_MODEL=llama3.2`. Para uma API paga compatível com OpenAI, use o endereço dela e `AI_API_KEY`.
3. No `legion.config.yaml`: `ultron.ai.provider: openai-compatible`.
4. `legion doctor` faz uma chamada de teste (só aviso se falhar).

Limites: `ultron.ai.timeoutMs` (4000) e `ultron.ai.maxCallsPerHour` (30). Ao passar disso, ou em qualquer erro, o bot usa as frases fixas. Só a duração e o sucesso de cada chamada ficam salvos; o texto, não.

## Postgres (opcional)

SQLite é suficiente para um servidor. Para usar Postgres, ponha `DATABASE_URL=postgres://legion:legion@postgres:5432/legion` no `.env` e suba com `docker compose --profile postgres up -d`.
