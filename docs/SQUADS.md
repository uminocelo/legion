# Esquadrões

Um esquadrão é um grupo dentro de uma equipe. Quem funda convida outras pessoas para jogarem juntas, com um cargo, um tópico privado, um convite permanente e um código de 6 caracteres.

Desligado por padrão (`squads.enabled: false`). Nada muda até você ligar.

## Ligar

```yaml
squads:
  enabled: true
  founderRole: staff_council   # key de roles, ou o ID do cargo; null = só a staff funda
  maxPerFounder: 1             # 1–50
  maxMembers: 50               # 1–1000, contando quem fundou
  maxSquads: 20                # 1–250, pedidos e ativos
```

Cada equipe que não seja Independente precisa de `factions[].squadChannelId`: o canal de texto onde o tópico privado do esquadrão é criado. O convite permanente sai em `channels.welcome`. Os dois são IDs entre aspas. Escrever `factions` troca a lista inteira; copie as 9 equipes de [CONFIG.md](CONFIG.md#factions) antes de acrescentar o canal.

Reinicie (`docker compose up -d`). Com esquadrões ligados, o processo também escuta convites do servidor. Não é uma intent privilegiada no Developer Portal: o reinício basta.

O `legion doctor` ganha a linha **Esquadrões**:

- ✅ permissões e canais ok
- ❌ lista cada permissão que falta: **Gerenciar servidor**, **Criar convite**, **Criar tópicos privados**, **Gerenciar tópicos**
- ⚠️ não conseguiu ler as permissões, alguma equipe está sem `squadChannelId`, ou o convite de um esquadrão ativo sumiu do Discord

`legion invite-url` só pede essas quatro permissões quando `squads.enabled` está ligado e o Cérebro está em `bots`. Com esquadrões desligados, o link continua o de antes. Se o doctor apontar falta de permissão, rode o invite de novo e autorize, ou marque as permissões no cargo do bot.

## Fundar

`/esquadrao criar` pede o nome e a equipe base. Quem funda precisa ser um herói registrado, ter o cargo de `founderRole` (a staff passa mesmo sem ele) e uma origem que a equipe aceite. O nome tem de 3 a 32 caracteres e não pode ser o de um personagem ou equipe da Marvel, nem repetir um esquadrão que já existe. Independente não serve de base.

O pedido vai para `channels.modQueue`, com os botões **Aprovar** e **Recusar**, e fica em `squad.created`. A staff decide por ali, por `/cerebro esquadrao aprovar` ou `recusar` (com motivo), ou pelo painel **Esquadrões**. Recusar e aprovar ficam na auditoria (`/audit`). Um segundo clique não cria outro esquadrão.

Aprovar cria, de uma vez:

- o cargo do esquadrão (abaixo do cargo do bot)
- um tópico privado no `squadChannelId` da equipe, com quem fundou
- um convite permanente em `channels.welcome`
- um código de 6 caracteres

Quem fundou recebe o código na resposta e na DM, e já entra como membro. Se o Discord recusar (permissão, canal faltando), o pedido continua aguardando: corrija e aprove de novo. O que já tinha sido criado é reaproveitado.

## Entrar

Quem chega pelo convite, e ainda não é herói, vê a pergunta depois de escolher a origem: entrar naquele esquadrão ou seguir sem ele. **Tenho um código de esquadrão** abre o código. Quem já é herói usa `/esquadrao entrar`.

Entram juntos na equipe base e no esquadrão (`squad.joined`):

- quem ainda está no cadastro, ou já está em Independente, muda para a equipe do esquadrão. Essa mudança não conta a espera de `teams.switchCooldownDays`
- quem já está na equipe do esquadrão só ganha o lugar
- quem está em outra equipe ouve para trocar de equipe primeiro, pela missão de recrutamento. Nada muda

A Irmandade só aceita origem Mutante ou Inumano. Outra origem vê a mensagem da equipe, o convite sugerido é esquecido e o cadastro segue sem esquadrão.

Um herói, um esquadrão. Sair com `/esquadrao sair` tira o cargo e o tópico, e a equipe fica. Se o líder tem co-líder, a liderança passa para o co-líder e o esquadrão continua ativo; sem co-líder, o líder não sai por esse comando — nomeia um co-líder com `/esquadrao coleader` ou arquiva com `/esquadrao arquivar`. O esquadrão cheio, inativo ou com código errado recusa. Cinco códigos desconhecidos em 10 minutos esperam o restante da janela; um código de esquadrão que existe e não está ativo não entra nessa conta.

`/esquadrao ver` mostra equipe, líder, co-líder e quantos membros. Quem lidera, o co-líder e a staff também vêem o convite e o código. Se alguém apagou o convite, essa consulta cria outro.

## Ferramentas do fundador

O líder (e o co-líder, onde indicado) gerencia o esquadrão ativo sem a staff:

- `/esquadrao renomear` (líder ou co-líder): troca o nome do esquadrão e o nome do cargo no Discord (mesmo ID de cargo). As mesmas regras de criar (3–32 caracteres, sem nome canônico Marvel, sem repetir).
- `/esquadrao coleader` (só o líder): nomeia um membro do esquadrão como co-líder, ou omite o membro para limpar. Só um co-líder por vez; nomear de novo substitui.
- `/esquadrao arquivar` (líder ou co-líder): arquiva o próprio esquadrão com motivo; some cargo, tópico e convite; os membros ficam na equipe. A staff continua podendo arquivar qualquer esquadrão com `/cerebro esquadrao arquivar`.

Rename, co-líder, transferência de liderança e arquivamento (jogador ou staff) ficam em `/audit`.

## Conteúdo do esquadrão

O líder de um esquadrão ativo pode enviar YAML de missão, campanha ou trivia com `/esquadrao conteudo enviar`. O arquivo precisa declarar `squad` com o nome ou o código desse esquadrão (campo opcional nos editores do site). O pedido vai para `channels.modQueue`; a staff aprova ou recusa. Conteúdo aprovado fica com `squad_id` e só aparece para quem tem assento ativo nesse esquadrão (com `squads.enabled`). Missões e campanhas sem `squad` continuam globais. Se o J.A.R.V.I.S. estiver desligado, o comando avisa e nada é enviado.

## Equipe e saída do servidor

Trocar de equipe por qualquer motivo que não seja a entrada no esquadrão tira a pessoa do esquadrão. Se quem lidera troca e há co-líder, a liderança passa; sem co-líder, o lugar some e o esquadrão continua ativo (`squad.left`, motivo `team_switch`).

Quem sai do servidor perde o lugar e não volta a ele ao entrar de novo. Se quem sai é o líder e há co-líder, a liderança passa e a fila da staff recebe **Liderança transferida**. Sem co-líder, o esquadrão é arquivado: somem cargo, tópico e convite, os membros continuam na equipe, e a fila recebe **Líder saiu**. Esse arquivamento por saída do servidor não escreve linha de auditoria. O arquivamento pela staff (`/cerebro esquadrao arquivar`, com motivo) ou pelo líder/co-líder (`/esquadrao arquivar`) escreve, e também mantém a equipe de cada membro.
