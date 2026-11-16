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

## Problemas comuns

| Sintoma | Causa | Correção |
|---|---|---|
| `DISCORD_TOKEN inválido` nos logs | Token errado ou trocado | Developer Portal → Bot → Reset Token, atualize o `.env`, `docker compose up -d` |
| `Intents privilegiadas não liberadas` | Server Members Intent desligada | Ligue em Developer Portal → Bot e reinicie |
| Membros não ganham cargos | Cargo do bot está abaixo | Arraste o cargo do bot para cima (`/cerebro status` lista quais) |
| Comandos não aparecem | Discord ainda não atualizou | `legion register-commands` e reabra o Discord |
| Container "unhealthy" | Bot não conectou | `docker compose logs` mostra o motivo |

## Atualizar, backup, parar

- Atualizar: `docker compose pull && docker compose up -d`
- Backup: pare com `docker compose stop` e copie a pasta `data/`
- Parar: `docker compose down` (os dados em `data/` ficam)

## Postgres (opcional)

SQLite é suficiente para um servidor. Para usar Postgres, ponha `DATABASE_URL=postgres://legion:legion@postgres:5432/legion` no `.env` e suba com `docker compose --profile postgres up -d`.
