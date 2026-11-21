# Sessão de teste ao vivo

Roteiro para testar o Legion com amigos no seu servidor, numa sessão de umas 2 horas. Cada passo diz quem faz o quê e o que todo mundo deve ver. Marque ✅ ou ❌ na coluna **Resultado** e anote qualquer coisa estranha. No fim, o `legion playtest-report` confere no banco se XP, créditos, limites e lutas batem com o que vocês viram.

## Quem participa

| Papel | Quem | Precisa |
|---|---|---|
| **Dono** | Você | Dono do servidor, acesso ao terminal |
| **Staff 2** | Um amigo | Cargo do Conselho da Legião, **sem** Administrador |
| **J1, J2** | Amigos | Já cadastrados no Cérebro, ou se cadastram no passo 1 |
| **J3** | Amigo com conta nova | Nunca passou pelo cadastro neste servidor |

Com uma quinta conta dá para testar o "grupo cheio" no passo 4.

## Antes (só o dono, uns 15 minutos)

1. Atualize para a versão mais nova: `LEGION_VERSION=1.0.0` (ou `latest`) no `.env`, depois `docker compose pull && docker compose up -d`.
2. No `legion.config.yaml`, para esta sessão:
   ```yaml
   channels:
     missions: "<ID do canal de missões>"   # texto, todos os jogadores veem
   jarvis:
     trivia:
       review: second_staff                # perguntas novas esperam outro staff
     missions:
       choiceTimeoutMinutes: 3             # padrão 10; 3 deixa os testes de tempo curtos
   ```
   Depois: `docker compose up -d`.
3. `docker compose exec legion legion doctor`: **nenhum ❌**.
4. Anote a hora de início: `date -u +%Y-%m-%dT%H:%M:%SZ`. O relatório e os logs usam essa hora.

## Os limites mudam a ordem

Cada jogador tem **1 missão diária por dia e 1 semanal por semana** (`jarvis.missions.limits`). Patrulha noturna e A fábrica silenciosa são diárias, por isso o J1 faz a Patrulha e os outros fazem a Fábrica. O lobby abandonado vem **antes** da missão semanal, senão o limite semanal já estaria usado.

| Missão | Tipo | Nível | Grupo | Quem |
|---|---|---|---|---|
| Patrulha noturna | diária | 1 | solo | J1 |
| Sinal fantasma | semanal | 2 | até 4 | J2 (líder), J1, J3, Dono |
| A fábrica silenciosa | diária, com luta | 3 | até 4 | J2, J3, Dono |
| Primeiro contato | história | 1 | solo | J1 (teste de tempo) |

## 1. Cadastro e níveis (20 min)

| # | Passo | Deve acontecer | Resultado | Notas |
|---|---|---|---|---|
| 1.1 | J3 entra no servidor e faz o cadastro, escolhendo os poderes no catálogo | O poder principal define o arquétipo | | |
| 1.2 | J3 tenta antes um codinome de personagem existente (ex.: "Wolverine") | Recusado, pede outro | | |
| 1.3 | J1 e J2 se cadastram, se ainda não tiverem cadastro | Ficha aparece | | |
| 1.4 | Dono: `/jarvis xp` com +200 para J2, J3 e você mesmo; +50 para J1 (motivo: "teste") | Nível 3 para os três, nível 2 para J1 | | |
| 1.5 | Todos: `/perfil` | Cada um vê o próprio nível | | |

## 2. Missão solo (J1, 10 min)

| # | Passo | Deve acontecer | Resultado | Notas |
|---|---|---|---|---|
| 2.1 | J1: `/missao iniciar missao: Patrulha noturna` e jogue até o fim | Abre um tópico no canal de missões; cada cena aparece uma vez | | |
| 2.2 | | A mensagem final mostra o XP; o `/perfil` também | | |
| 2.3 | J1 tenta outra diária: `/missao iniciar` → A fábrica silenciosa | Some do autocompletar; digitando o id, é recusada pelo limite diário | | |
| 2.4 | J1 clica num botão antigo da Patrulha | "Esta escolha já passou" | | |

## 3. Lobby que nunca começa (J2, 5 min de espera)

| # | Passo | Deve acontecer | Resultado | Notas |
|---|---|---|---|---|
| 3.1 | J2: `/missao iniciar missao: Sinal fantasma`, ninguém clica em começar | Lobby aberto | | |
| 3.2 | Esperem 5 minutos (enquanto isso, faça o passo 7.1) | O lobby fecha sozinho | | |

## 4. Missão em grupo, votos e reinício (todos, 25 min)

| # | Passo | Deve acontecer | Resultado | Notas |
|---|---|---|---|---|
| 4.1 | J2 abre Sinal fantasma de novo; J1, J3 e Dono entram; J3 sai e entra de novo | Abre normalmente (o lobby do passo 3 não gastou o limite semanal); a lista do lobby muda a cada clique | | |
| 4.2 | (Com 5 contas) a quinta tenta entrar | Recusado: grupo cheio | | |
| 4.3 | J1 tenta começar | Só o líder começa | | |
| 4.4 | J2 começa | O tópico menciona todos | | |
| 4.5 | Votem com maioria (3 × 1) | Segue o caminho da maioria | | |
| 4.6 | Votem empatado (2 × 2, J2 num dos lados) | Vence o lado do líder | | |
| 4.7 | Alguém clica duas vezes | "Você já escolheu" | | |
| 4.8 | **Dono:** `docker compose restart legion` no meio de uma cena | A missão continua; nenhuma cena repetida | | |
| 4.9 | Numa cena, só 2 votam e esperem 3 minutos | O tempo acaba e vale o voto de quem votou | | |
| 4.10 | Terminem a missão | Todos recebem o XP semanal uma vez | | |
| 4.11 | Cada um tenta outra semanal | Recusada pelo limite semanal | | |

## 5. Luta em grupo (J2, J3, Dono, 15 min)

| # | Passo | Deve acontecer | Resultado | Notas |
|---|---|---|---|---|
| 5.1 | J2 abre A fábrica silenciosa; J3 e Dono entram; joguem até a luta | O ULTRON coloca os inimigos e o Sentinel conduz a luta **no tópico da missão**, com os três | | |
| 5.2 | Terminem a luta | A história segue pelo caminho certo (venceu ou perdeu) | | |
| 5.3 | Terminem a missão | Todos recebem o XP | | |

## 6. Tempo esgotado (J1, 3 min de espera)

| # | Passo | Deve acontecer | Resultado | Notas |
|---|---|---|---|---|
| 6.1 | J1: `/missao iniciar missao: Primeiro contato` e não responda | | | |
| 6.2 | Dono: `docker compose restart legion` | | | |
| 6.3 | Esperem 3 minutos | A missão termina como abandonada, sem XP; os botões ficam desativados | | |

## 7. Ferramentas da staff (Dono e Staff 2, 20 min)

| # | Passo | Deve acontecer | Resultado | Notas |
|---|---|---|---|---|
| 7.1 | Dono: `/jarvis trivia nova` | A pergunta fica esperando revisão | | |
| 7.2 | Staff 2 aprova na fila de moderação | Um jogador recebe a pergunta no `/trivia` sem reiniciar o bot | | |
| 7.3 | Dono desativa a pergunta (`/jarvis trivia desativar`) | Some na hora | | |
| 7.4 | Dono importa uma missão válida (`/jarvis missao importar`) e um inimigo válido (`/ultron inimigo importar`) | Prévia; depois de Publicar, entram em jogo | | |
| 7.5 | Dono importa uma missão com erro (apague uma cena para a qual alguma escolha leva) e um inimigo chamado "Magneto" | Lista os erros; nada muda | | |
| 7.6 | Staff 2 (sem Administrador) procura `/jarvis`, `/herbie`, `/sentinel`, `/ultron` | Até liberar em Integrações, o `legion doctor` avisa e os comandos não aparecem; depois aparecem | | |

## 8. Ficha do mutante (J1, 10 min)

| # | Passo | Deve acontecer | Resultado | Notas |
|---|---|---|---|---|
| 8.1 | J1: `/heroi poderes` e escolha os poderes | Funciona uma vez | | |
| 8.2 | J1: `/heroi poderes` de novo | Recusado | | |
| 8.3 | J1 compartilha a ficha pelo `/perfil` | A imagem mostra codinome, facção, poderes, nível e patente | | |
| 8.4 | Todos leem o post fixado do guia (`/herbie guia publicar` se não houver) | Ninguém sente falta de nada do site antigo | | |

## 9. Editores do site e importação de trivia (Dono e Staff 2, 25 min)

Os editores ficam em [uminocelo.github.io/legion](https://uminocelo.github.io/legion/personalizar.html#editores).

| # | Passo | Deve acontecer | Resultado | Notas |
|---|---|---|---|---|
| 9.1 | Dono escreve 3 perguntas no [editor de trivia](https://uminocelo.github.io/legion/editor-trivia.html), baixa e importa com `/jarvis trivia importar` | Prévia: 3 novas. Com a revisão ligada, esperam o Staff 2 | | |
| 9.2 | Staff 2 aprova; um jogador faz `/trivia` | Uma das novas pode aparecer | | |
| 9.3 | `/jarvis trivia exportar`; abra o arquivo no editor (Abrir arquivo), mude uma pergunta, importe de novo | Prévia: 1 alterada, o resto igual | | |
| 9.4 | Importe um arquivo quebrado: copie uma pergunta com o mesmo `id` e ponha `answer: 9` em outra | Mostra os dois erros; nada muda | | |
| 9.5 | No [editor de missões](https://uminocelo.github.io/legion/editor-missoes.html): uma missão de **história**, grupo até 4, com uma cena de combate; no [de inimigos](https://uminocelo.github.io/legion/editor-inimigos.html): um lacaio nível 1. Importe os dois | As prévias batem com o que foi montado; entram em jogo | | |
| 9.6 | J2 e J3 jogam a missão nova | A luta acontece; o inimigo novo pode aparecer | | |
| 9.7 | Abram cada editor no celular, escrevam algo, fechem e abram de novo | Dá para usar; o rascunho continua lá | | |

## 10. Novidades da v0.9: origens, equipes e arcos (J1, J3, Staff 2, 30 min)

Para não esperar o nível 3, a staff pode dar XP com `/jarvis xp` (com motivo).

| # | Passo | Deve acontecer | Resultado | Notas |
|---|---|---|---|---|
| 10.1 | J3 se cadastra do zero | Escolhe uma origem, vê só os poderes dela e começa Independente | | |
| 10.2 | J1 (cadastrado antes da v0.9): `/heroi origem` | Pode trocar a origem uma vez; a segunda é recusada | | |
| 10.3 | J3 termina o tutorial (`/tutorial`) | Três capítulos do Primeiro contato, a primeira luta e a mensagem final sobre equipes | | |
| 10.4 | J3: `/missao lista` e `/campanha` | A lista mostra só o próximo capítulo de cada campanha, com um rodapé; `/campanha` mostra todas | | |
| 10.5 | J3 (nível 3, origem que não é Mutante nem Inumano): `/missao iniciar convite-no-metro-1` | Bloqueada, dizendo a origem que falta | | |
| 10.6 | J3 joga um arco inteiro (por exemplo `armadura-roubada`) | Ao vencer a luta do capítulo 3, entra na equipe, ganha o cargo e o tópico anuncia | | |
| 10.7 | J3 termina outro arco logo depois | A troca é recusada e o tópico mostra a data em que pode trocar | | |
| 10.8 | Staff 2: `/cerebro equipe mover` com J3 e um motivo | Move na hora, sem esperar | | |
| 10.9 | J1, J2 e J3 jogam `visita-ao-baxter-2` juntos | Lobby de até 3; a luta acontece | | |
| 10.10 | Todos: `/trivia categoria:vingadores`, `quarteto`, `cosmico` e `mistico` | Cada uma traz perguntas da categoria | | |

## 11. Novidades da v0.10: créditos, loja e equipamento (J1, J2, Dono, 25 min)

| # | Passo | Deve acontecer | Resultado | Notas |
|---|---|---|---|---|
| 11.1 | J1: `/carteira` depois dos passos anteriores | Saldo com os créditos das missões e da trivia; cada linha com o motivo | | |
| 11.2 | J1 joga uma missão diária até o fim | A mensagem final mostra "+N XP · +20 créditos"; `/carteira` sobe 20 | | |
| 11.3 | J2: `/loja` sem créditos | Lista com preços, nível e bônus; **Comprar** desligado; saldo 0 no rodapé | | |
| 11.4 | Dono: `/jarvis creditos dar membro:J2 quantidade:100 motivo:teste` | Confirma +100; `/carteira` de J2 mostra 100 com o motivo | | |
| 11.5 | J2: `/loja`, escolhe **Traje de treino**, **Comprar** | "Você comprou… Saldo: 40"; o item aparece em `/inventario` | | |
| 11.6 | J2 clica **Comprar** de novo no mesmo menu | "Você já tem"; o saldo continua 40 | | |
| 11.7 | J1 clica num botão da loja de J2 | "Este menu não é seu"; nada muda | | |
| 11.8 | J2: `/inventario`, equipa o traje | "Vale a partir da próxima luta"; o rodapé mostra +8 VIDA; `/perfil` mostra o item | | |
| 11.9 | J2 entra numa luta (missão com luta ou `/treino`) | A vida inicial é 8 maior que antes do item | | |
| 11.10 | Dono: monta um item no editor de itens, `/jarvis item importar` e **Publicar** | A prévia mostra 🆕 1; o item aparece na `/loja` | | |
| 11.11 | Dono: `/jarvis item desativar item:traje-de-treino` | Responde quantos foram desequipados; J2 continua com o traje no `/inventario`, marcado "desativado" | | |
| 11.12 | Dono: `/jarvis creditos dar membro:J2 quantidade:-100 motivo:teste` | Recusado: não dá para tirar mais do que o saldo | | |

## 12. Novidades da v1.0: guerra, ondas, ameaça e painel (todos, 40 min)

Antes: o dono liga o painel ([DASHBOARD.md](DASHBOARD.md)) e confere `legion doctor` (**Painel da staff** ✅). Staff 2 precisa de um cargo de staff sem Administrador.

| # | Passo | Deve acontecer | Resultado | Notas |
|---|---|---|---|---|
| 12.1 | Dono: `/ultron guerra iniciar` | Confirma a guerra com a data do fim; `/guerra` mostra o placar zerado | | |
| 12.2 | J1 (X-Men) termina uma missão; J2 (outra equipe) ataca num evento | `/guerra` mostra pontos para as duas equipes; "meus pontos" de cada um bate | | |
| 12.3 | Dono: `/ultron guerra pontos membro:J1 pontos:15 motivo:teste` | +15 na equipe de J1, com o motivo; `legion playtest-report` lista o ajuste | | |
| 12.4 | Dono: `/ultron guerra encerrar` | Post do resultado com a equipe vencedora; cada membro vencedor ganha 50 créditos em `/carteira` | | |
| 12.5 | Dono (painel): **Definir ameaça** 70, depois **Iniciar evento agora** tipo Invasão | Ameaça 70 / 100 no painel; a invasão tem 3 ondas, difícil | | |
| 12.6 | J1, J2, J3 atacam até zerar a 1ª onda | A mesma mensagem passa para a onda 2 com mais HP; ataques atrasados entram na onda nova | | |
| 12.7 | Deixe o tempo acabar no meio das ondas | Derrota; o resultado mostra as ondas vencidas e a que falhou | | |
| 12.8 | J1: `/ameaca` | Mostra o medidor (barra, faixa, o que significa) mesmo sem evento | | |
| 12.9 | Staff 2: abre http://localhost:8081 e entra com o Discord | Entra; vê membros, economia, eventos, guerra e ameaça | | |
| 12.10 | J3 (sem cargo de staff) tenta entrar | "Só a staff pode abrir o painel" (403) | | |
| 12.11 | Dono tira o cargo de Staff 2; Staff 2 recarrega depois de 1 min | 403; precisa de outro login quando o cargo voltar | | |
| 12.12 | Dono (painel): **Dar créditos** J2, 30, "painel" | Mensagem igual à do `/jarvis creditos dar`; `/carteira` de J2 +30; a linha aparece em `/audit` | | |
| 12.13 | Dono: recarrega a página do formulário enviado (reenviar) | "Este formulário já foi enviado"; o saldo não muda de novo | | |
| 12.14 | Dono (painel): **Tirar créditos** J2, um valor maior que o saldo | Recusado com a mesma mensagem do comando; `/audit` mostra `ok: false` | | |
| 12.15 | Dono (painel): **Mudar preço** `traje-de-treino` para 5; depois `/jarvis item importar` de qualquer arquivo de itens | `/loja` mostra 5 antes e depois da importação; preço vazio volta ao original | | |
| 12.16 | Dono (painel): **Agendar evento** Raid para daqui a 10 min, depois **Cancelar evento** | O anúncio sai no canal de eventos; o cancelamento confirma; os dois em `/audit` | | |
| 12.17 | Abra o painel num celular | Usável na largura do celular (tabelas rolam para o lado) | | |

## Depois

1. **Relatório:** `docker compose exec legion legion playtest-report --since <hora de início>`. A seção **Conferência** deve dizer ✅. Cada ❌ é um problema (XP pago duas vezes ou faltando, limite furado, luta com o grupo errado, carteira diferente do histórico de créditos, pontos de guerra numa facção desconhecida). A seção **Economia** lista as compras e o que a staff deu ou tirou. A seção **Guerra** lista os pontos por facção e por motivo, e os ajustes da staff. As ações do painel ficam em `/audit`. Os ⚠️ merecem uma olhada. Use `--json` para guardar o resultado.
2. **Ondas e ameaça:** se a invasão de sábado teve mais de uma onda, confira no resultado se cada onda aparece com o tempo e quem mais causou dano. `/ameaca` deve mostrar o medidor mesmo sem evento. A ameaça só muda uma vez por dia, às 00:10.
3. **Logs:** `docker compose logs legion --since <hora de início> | grep '"level":50'` deve sair vazio. Para os avisos: `grep '"level":40'`.
4. **Volte a config:** tire o `choiceTimeoutMinutes: 3` (e a revisão, se não quiser deixar ligada) e rode `docker compose up -d`.
5. **Bugs:** abra uma issue no GitHub para cada ❌ desta página ou do relatório, com o passo, o que aconteceu e o trecho do log.
