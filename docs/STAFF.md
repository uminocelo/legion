# Guia da staff: conteúdo pelo Discord

Quem tem o cargo **Professor X** (`staff_owner`) ou **Conselho da Legião** (`staff_council`), ou é dono do servidor, pode criar e cuidar do conteúdo sem mexer em arquivos nem reiniciar o bot. Tudo fica salvo no banco: sobrevive a reinícios, e arquivos de conteúdo nunca sobrescrevem o que foi feito aqui.

> Os comandos da staff vêm marcados como "só administradores". Se o cargo da staff **não** tem Administrador, libere os comandos uma vez: veja [Comandos da staff não aparecem](SELF_HOSTING.md#comandos-da-staff-não-aparecem). O `legion doctor` avisa quando falta isso.

## Trivia

Exemplo: você leu *Shang-Chi #4* e quer uma pergunta sobre a edição.

1. `/jarvis trivia nova categoria:quadrinhos dificuldade:normal` (o idioma é opcional; padrão `pt-BR`).
2. Preencha o formulário:
   - **Pergunta**
   - **Alternativas**: uma por linha, de 2 a 4
   - **Resposta certa**: o número da alternativa (1 a 4)
   - **Explicação**: aparece depois da resposta
   - **Fonte**: um link ou uma referência, como `Shang-Chi #4 (2021)`. Links viram botão; texto aparece no rodapé.
3. Pronto. Com `jarvis.trivia.review: none` (padrão), a pergunta já entra em jogo. Com `second_staff`, ela vai para o `channels.modQueue` (ou para o canal onde você usou o comando) e **outra** pessoa da staff aprova ou recusa.

Outros comandos:

| Comando | O que faz |
|---|---|
| `/jarvis trivia lista` | Lista com filtros: `status` (ativa, pendente, desativada, todas), `categoria`, `autor`, `pagina` |
| `/jarvis trivia editar pergunta:…` | Abre o formulário preenchido. Só perguntas criadas no Discord; as de arquivo se editam no arquivo. Toda edição fica no histórico |
| `/jarvis trivia desativar` / `ativar` | Tira ou volta uma pergunta (inclusive de arquivo) na hora; continua desligada depois de recarregar os arquivos |
| `/jarvis trivia importar arquivo:` | Importa até 50 perguntas de um `.yaml` (feito no [editor de trivia](https://uminocelo.github.io/legion/editor-trivia.html) ou pelo `exportar`): prévia, depois **Publicar**. Mesmo `id` atualiza; a regra `review` vale aqui também |
| `/jarvis trivia exportar` | Baixa `trivia-staff.yaml` no mesmo formato dos arquivos de conteúdo (backup ou para compartilhar) |

Várias perguntas de uma vez: monte no [editor de trivia](https://uminocelo.github.io/legion/editor-trivia.html) e use `/jarvis trivia importar`.

Quer uma categoria nova, como `marvel`? Acrescente em `jarvis.trivia.categories` no `legion.config.yaml` e reinicie uma vez.

## Missões

Monte a missão no [editor de missões](https://uminocelo.github.io/legion/editor-missoes.html) (cenas, escolhas, combates e finais, conferidos na hora, a partir do zero ou de uma missão pronta) ou escreva o `.yaml` à mão (formato em [MISSIONS.md](MISSIONS.md)).

1. `/jarvis missao importar arquivo:` e anexe o `.yaml` (até 64 KB).
2. O J.A.R.V.I.S. confere o arquivo com as mesmas regras dos arquivos de conteúdo: campos, cenas ligadas, sem ciclos, com final. Personagens da Marvel podem aparecer na história ([UNIVERSE.md](UNIVERSE.md)). Se houver erro, ele lista campo e linha, e **nada muda**.
3. Sem erros, aparece uma prévia (tipo, nível, grupo, cenas, lutas). **Publicar** coloca a missão em jogo na hora; **Cancelar** descarta.

Mesmo `id` de uma missão que já existe? A prévia avisa e a importada substitui a de arquivo. Para voltar à versão do arquivo, apague a importada no banco ou importe o arquivo original de novo.

| Comando | O que faz |
|---|---|
| `/jarvis missao lista` | Todas as missões, ligadas ou não, e quem importou (ou "arquivo") |
| `/jarvis missao desativar` / `ativar` | Tira ou volta uma missão para novas partidas. Partidas em andamento terminam normalmente |

### Campanhas

Uma campanha (missões em capítulos, [MISSIONS.md](MISSIONS.md#campanhas)) vai num arquivo só, com `campaign` e `missions`. No editor de missões, preencha a campanha e baixe o **arquivo de campanha**.

1. `/jarvis campanha importar arquivo:` e anexe o `.yaml` (até 64 KB).
2. O J.A.R.V.I.S. confere a campanha e cada missão: capítulos sem repetir, `requires` com missões que existem e sem ciclos, `joinFaction` só em recrutamento e para uma equipe ligada. Ids de campanhas e missões que vêm com o Legion são recusados. Com qualquer erro, **nada muda**.
3. A prévia lista os capítulos. **Publicar** grava a campanha e todas as missões juntas; elas aparecem na hora em `/campanha` e `/missao`.

## Inimigos do ULTRON

Mesmo formato do `enemies.yaml` ([WORLD_EVENTS.md](WORLD_EVENTS.md)): uma lista com um ou mais inimigos.

1. `/ultron inimigo importar arquivo:` e anexe o `.yaml`.
2. A prévia mostra cada inimigo como 🆕 (novo) ou ♻️ (substitui um que existe), com tier, nível e atributos. Erros listam item e campo, e nada muda.
3. **Publicar**: os próximos encontros já podem usar os inimigos.

| Comando | O que faz |
|---|---|
| `/ultron inimigo lista` | Todos os inimigos e de onde vieram |
| `/ultron inimigo desativar` / `ativar` | Tira ou volta um inimigo. Precisa sobrar pelo menos um minion de nível 1 |

## Guerra de facções

A guerra soma pontos da facção no momento do lance (missão, ataque, participação). O resultado sai em `channels.events`. Os créditos dos vencedores vêm do J.A.R.V.I.S. (`jarvis.economy.war.winner`).

| Comando | O que faz |
|---|---|
| `/ultron guerra iniciar` | Começa agora. Se já houver uma agendada, ela é antecipada |
| `/ultron guerra encerrar` | Encerra a guerra ativa, posta o resultado e agenda a próxima |
| `/ultron guerra pontos membro pontos motivo` | Ajuste de -1000 a 1000, nunca 0. Fica registrado quem fez e o motivo, e aparece no `legion playtest-report` |

`/guerra` (jogadores) mostra o placar, o tempo, os pontos da pessoa e os da facção dela.

## Créditos

| Comando | O que faz |
|---|---|
| `/jarvis creditos dar membro quantidade motivo` | Dá (ou tira, com número negativo) de -10000 a 10000 créditos. Não deixa o saldo ficar negativo. Fica registrado quem fez e o motivo, e aparece no `legion playtest-report` |

## Itens

Itens vêm de arquivos ([ECONOMY.md](ECONOMY.md#arquivos-de-itens)) ou do Discord. Monte o arquivo no [editor de itens](https://uminocelo.github.io/legion/editor-itens.html).

| Comando | O que faz |
|---|---|
| `/jarvis item dar membro item [motivo]` | Entrega um item a um membro (uma vez por membro). Fica registrado quem deu e o motivo |
| `/jarvis item importar arquivo` | Anexe o `.yaml` (até 50 itens). A prévia mostra 🆕 novos, ✏️ alterados (com quantos jogadores têm cada um) e ＝ iguais; **Publicar** aplica tudo de uma vez. Ids de itens dos arquivos são recusados; qualquer erro é listado e nada muda |
| `/jarvis item exportar` | Baixa `itens-staff.yaml` com os itens importados. Reimportar o mesmo arquivo não muda nada |
| `/jarvis item desativar item` | Tira o item de jogo e da loja na hora. Desequipa de quem usa (responde quantos) e cada um continua com o item. Vale mesmo depois de reiniciar |
| `/jarvis item ativar item` | Volta um item desativado. Quem tem precisa equipar de novo |

## Esquadrões

Desligados por padrão. O passo a passo de ligar, fundar e entrar está em [SQUADS.md](SQUADS.md). A staff aprova, recusa e arquiva; cada uma dessas ações fica em `/audit`.

| Comando | O que faz |
|---|---|
| `/cerebro esquadrao aprovar esquadrao` | Cria o cargo, o tópico privado, o convite permanente e o código. Quem fundou entra no esquadrão |
| `/cerebro esquadrao recusar esquadrao motivo` | Recusa o pedido. O motivo vai para quem fundou, se a DM estiver aberta |
| `/cerebro esquadrao arquivar esquadrao motivo` | Arquiva um esquadrão ativo. Some o cargo, o tópico e o convite. Os membros continuam na equipe |

O pedido também aparece em `channels.modQueue`, com **Aprovar** e **Recusar**. No painel, a tabela **Esquadrões** faz as mesmas duas coisas. Quem fundou e sai do servidor arquiva o esquadrão sem linha de auditoria; a fila avisa **Líder saiu**.

## Áreas e notícias das equipes

Cada equipe pode ter uma categoria só dela (`factions[].categoryId`) e um canal de notícias (`factions[].newsChannelId`), veja [CONFIG.md](CONFIG.md#factions) e o [modelo de servidor](TEMPLATE.md). `/cerebro setup canais:true aplicar:true` fecha cada área para quem é de outra equipe; o `legion doctor` confere (**Áreas das equipes**). No canal de notícias, o ULTRON posta o placar da equipe na guerra (no máximo uma vez por hora, só quando muda), o resultado da guerra e o de cada evento, com quantos heróis da equipe participaram.

## Painel da staff

Com o painel ligado ([DASHBOARD.md](DASHBOARD.md)), as mesmas tarefas têm formulários na web: dar e tirar créditos, dar item, mudar o preço de um item (sobrevive a importações), agendar, iniciar ou cancelar eventos, iniciar e encerrar a guerra e definir a ameaça. As regras e as mensagens são as dos comandos, e tudo fica na auditoria (`/audit`).

## Segurança

- Só arquivos enviados ao próprio Discord são baixados (`cdn.discordapp.com`), com limite de tamanho.
- A prévia vale para um clique: depois de publicar ou cancelar, importe de novo.
- Quem não é staff não vê os comandos e, mesmo com um botão antigo, recebe "Apenas a staff".
