# Painel da staff

Uma página web dentro do próprio Legion com membros, economia, eventos, guerra e ameaça, e ações para a staff cuidar do servidor sem comandos (dar créditos e itens, mudar preços, agendar eventos, guerra, ameaça).

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
- **Auditoria** (`/audit`): ações da staff, mais novas primeiro, 50 por página.

Bot desligado = painel e ações dele não aparecem.

## Ações

Cada ação é um formulário no menu. Ela usa **a mesma regra e a mesma mensagem** do comando no Discord: se o comando recusaria, a ação também recusa, com o mesmo texto.

| Ação | Igual a | Campos |
|---|---|---|
| Dar créditos | `/jarvis creditos dar` | membro, quantidade (1–10000), motivo |
| Tirar créditos | `/jarvis creditos dar` com número negativo | membro, quantidade, motivo; não deixa o saldo negativo |
| Dar item | `/jarvis item dar` | membro, ID do item, motivo (opcional) |
| Mudar preço de item | — | ID do item, novo preço; vazio volta ao preço do arquivo |
| Agendar evento | `/ultron evento agendar` | tipo, quando (horário do servidor) |
| Iniciar evento agora | `/ultron evento iniciar` | tipo |
| Cancelar evento | `/ultron evento cancelar` | tipo (opcional) |
| Iniciar / encerrar guerra | `/ultron guerra iniciar` / `encerrar` | — |
| Definir ameaça | — | nível 0–100 (recusa com `ultron.threat.enabled: false`) |

- **Membro:** cole o ID do Discord (botão direito → Copiar ID, com o modo desenvolvedor ligado) ou a menção `<@…>`.
- **Preço:** fica guardado à parte (`price_override`) e **sobrevive** a `/jarvis item importar` e ao reinício. A `/loja`, a compra e os painéis usam o preço novo.
- **Enviar duas vezes** (clique duplo, recarregar a página) não repete a ação: cada formulário vale uma vez. Abra a ação de novo para repetir.

## Auditoria

Toda ação executada fica em `/audit`: quem, quando, qual ação, o membro alvo, os campos e o resultado (`ok: true` ou `ok: false` quando o serviço recusou). Textos longos são cortados em 200 caracteres. Formulário com campo inválido, sessão vencida ou token errado não chega a rodar e não entra na auditoria. A auditoria é guardada por `dashboard.auditDays` (180) dias.

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
- Formulários com token CSRF, conferência de `Origin` e chave de uso único (enviar de novo não repete).
- Páginas sem scripts; `Content-Security-Policy: default-src 'self'`, `X-Frame-Options: DENY`.
- No máximo 10 tentativas de login por minuto por IP.

## Problemas comuns

- **"Invalid OAuth2 redirect_uri"** no Discord: o redirect salvo não é exatamente `<publicUrl>/callback`.
- **"O Discord não aceitou o login"**: segredo errado (copiou o token do bot?) ou o código venceu; tente de novo.
- **"Só a staff pode abrir o painel"**: a conta não é dona, não tem Administrador nem cargo de staff.
- **"Não consegui falar com o Discord"**: o bot está sem conexão; tente daqui a pouco.

Decisões: [ADR 0034](adr/0034-staff-dashboard.md).
