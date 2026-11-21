# Painel da staff

Uma página web dentro do próprio Legion com membros, economia, eventos, guerra e ameaça, para a staff acompanhar o servidor sem comandos. Por enquanto só leitura; as ações (dar créditos, agendar evento…) chegam na v1.0.

- Roda no mesmo processo dos bots, na porta `dashboard.port` (8081).
- Login com o Discord (só o seu ID, `scope=identify`). Entram o **dono do servidor**, quem tem **Administrador** e os **cargos de staff** (Professor X, Conselho da Legião). Os outros recebem "Só a staff pode abrir o painel".
- O acesso é conferido de novo a cada página (no máximo a cada 60 s): quem perde o cargo sai em até um minuto.
- **Desligado por padrão.**

## Ligar

1. **Developer Portal** → https://discord.com/developers/applications → o app do **Cérebro** (o do `CEREBRO_CLIENT_ID`).
2. **OAuth2** → **Client Secret** → **Reset Secret** e copie. Não é o token do bot; trocar o segredo não mexe no `CEREBRO_TOKEN`.
3. Na mesma página, em **Redirects** → **Add Redirect**: `http://localhost:8081/callback` (ou `<publicUrl>/callback`, exatamente igual) → **Save Changes**.
4. No `.env`:
   ```
   DASHBOARD_CLIENT_SECRET=o-segredo-copiado
   ```
5. No `legion.config.yaml`:
   ```yaml
   dashboard:
     enabled: true
   ```
6. Docker: no `docker-compose.yml`, tire o `#` da linha `- "127.0.0.1:8081:8081"`.
7. Reinicie (`docker compose up -d`) e rode `legion doctor`: a linha **Painel da staff** deve ficar ✅.
8. Abra http://localhost:8081 e entre com o Discord.

## Configuração

| Chave | Padrão | Descrição |
|---|---|---|
| `dashboard.enabled` | `false` | Liga o painel |
| `dashboard.port` | `8081` | Porta dentro do container |
| `dashboard.publicUrl` | `http://localhost:8081` | Endereço que você abre no navegador; o Discord volta para `<publicUrl>/callback` |
| `dashboard.sessionHours` | `12` | Quanto tempo o login dura (1–720) |
| `dashboard.auditDays` | `180` | Quanto tempo a auditoria é guardada |

Sem o `DASHBOARD_CLIENT_SECRET`, os bots sobem normalmente e o painel fica desligado (o log e o `legion doctor` mostram ❌).

## Páginas

- **Visão geral** (`/`): todos os painéis.
- **Membros**: registrados por equipe e por faixa de nível.
- **J.A.R.V.I.S.**: economia (créditos em circulação, ganhos e gastos em 7 dias), maiores saldos, últimas compras.
- **ULTRON**: eventos mundiais (agendados, em andamento e dos últimos 7 dias), guerra (placar) e histórico, ameaça (nível e o tamanho da próxima invasão).
- **Auditoria** (`/audit`): ações da staff, mais novas primeiro.

Bot desligado = painel dele não aparece.

## Acesso de fora do computador

Por padrão o compose publica só em `127.0.0.1`: o painel abre só na máquina do Legion. Para abrir de outro lugar, **use https** com um proxy reverso. Por http fora do localhost, o login e o cookie passam sem criptografia; o `legion doctor` avisa com ⚠️.

Exemplo com [Caddy](https://caddyserver.com/) (cuida do certificado sozinho):

```
painel.seudominio.com {
  reverse_proxy 127.0.0.1:8081
}
```

Depois:

```yaml
dashboard:
  enabled: true
  publicUrl: https://painel.seudominio.com
```

e troque o redirect no Developer Portal para `https://painel.seudominio.com/callback`. Com https, o cookie ganha `Secure`.

## Segurança

- O segredo só vem do `.env`, nunca aparece no log nem no `legion doctor`.
- O token de acesso do Discord é usado uma vez no login e descartado.
- A sessão guarda só um hash (SHA-256) do cookie; cada login cria uma nova; **Sair** apaga. Sessões vencidas são apagadas todo dia.
- Cookies `HttpOnly`, `SameSite=Lax`, `Secure` em https. O `state` do login vale 10 min e precisa bater.
- Formulários com token CSRF e conferência de `Origin`.
- Páginas sem scripts; `Content-Security-Policy: default-src 'self'`, `X-Frame-Options: DENY`.
- No máximo 10 tentativas de login por minuto por IP.

## Problemas comuns

- **"Invalid OAuth2 redirect_uri"** no Discord: o redirect salvo não é exatamente `<publicUrl>/callback`.
- **"O Discord não aceitou o login"**: segredo errado (copiou o token do bot?) ou o código venceu; tente de novo.
- **"Só a staff pode abrir o painel"**: a conta não é dona, não tem Administrador nem cargo de staff.
- **"Não consegui falar com o Discord"**: o bot está sem conexão; tente daqui a pouco.

Decisões: [ADR 0034](adr/0034-staff-dashboard.md).
