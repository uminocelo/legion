# Universo Marvel

O Legion é um projeto de fã do universo Marvel. Este guia explica de onde vêm os heróis dos jogadores e o que pode e o que não pode aparecer no conteúdo do seu servidor. As equipes estão na seção [Equipes](#equipes).

## Origens

Todo herói tem uma **origem**: de onde vêm os poderes dele. O jogador escolhe no cadastro, logo depois das regras.

| Origem (`key`) | Emoji | Ideia |
|---|---|---|
| Mutante (`mutante`) | 🧬 | Nasceu com o gene X; os poderes despertaram sozinhos |
| Inumano (`inumano`) | 💠 | Poderes latentes despertados pela névoa terrígena |
| Ciência (`ciencia`) | ⚗️ | Experimento, acidente ou soro |
| Tecnologia (`tecnologia`) | 🤖 | Armaduras, armas e engenhocas |
| Místico (`mistico`) | 🔮 | Magia, artefatos, pactos com outras dimensões |
| Cósmico (`cosmico`) | 🌌 | Poder vindo das estrelas |
| Treinado (`treinado`) | 🥋 | Sem superpoderes: técnica e disciplina |

**A origem não muda números.** Atributos de combate vêm do arquétipo (o tipo do poder principal) e do nível, como antes. A origem decide **quais poderes** o herói pode escolher:

- cada poder do catálogo pode ter `origins: [...]`; **sem `origins`, vale para todas**;
- os superpoderes que vêm com o Legion servem para Mutante, Inumano, Ciência, Místico e Cósmico; Treinado tem **habilidades** (artes marciais, pontaria, acrobacia, furtividade) e Tecnologia tem **equipamentos** (armadura, propulsores, drones, canhão de plasma);
- cada origem precisa de poderes de pelo menos 2 tipos; uma origem sem poderes some do cadastro e aparece com ❌ no `legion doctor`.

Detalhes do formato em [POWERS.md](POWERS.md#origens). A staff escolhe a ordem, os emojis e quais origens aparecem em `cerebro.origins` ([CONFIG.md](CONFIG.md#cerebro)).

Todo herói novo começa **Independente** (`cerebro.teams.startFaction`). Entrar numa equipe vai acontecer pelas missões de recrutamento ([Equipes](#equipes)).

### Heróis de antes das origens

Na atualização, todo herói que já existia virou **Mutante** e manteve tudo: codinome, poderes, nível, facção e ficha. Cada um pode trocar de origem **uma única vez** com `/heroi origem`:

- se os poderes atuais servem na nova origem, eles ficam;
- se algum não serve, o menu de poderes abre para escolher de novo; **Cancelar** não muda nada e a troca continua disponível;
- terminar (mesmo escolhendo Mutante de novo) encerra a troca.

O H.E.R.B.I.E. avisa o servidor uma vez, num post no canal do tutorial (ou de boas-vindas), sem mandar DM para ninguém. Enquanto a troca estiver aberta, `/perfil` e `/heroi` lembram o próprio herói.

O campo livre da ficha que antes se chamava "Origem" agora aparece como **História**: é o texto do jogador contando como ganhou os poderes.

## Equipes

As facções agora são as equipes da Marvel. Cada uma tem um cargo no Discord, um emoji e uma descrição:

| Equipe | Chave | Quem aceita |
|---|---|---|
| 🟢 Independente | `independent` | todos (é onde todo herói novo começa) |
| 🔵 X-Men | `xmen` | todos |
| 🔴 Irmandade | `brotherhood` | só **Mutante** e **Inumano** |
| 🟡 Vingadores | `avengers` | todos |
| ⚫ S.H.I.E.L.D. | `shield` | todos |
| 🟣 Guardiões | `guardians` | todos |
| 🟠 Defensores | `defenders` | todos |
| ⚡ Thunderbolts | `thunderbolts` | todos |
| 🌙 Filhos da Meia-Noite | `midnight_sons` | todos |

- **Quem aceita** é o `origins` da equipe em `factions` ([CONFIG.md](CONFIG.md)). Sem `origins`, a equipe aceita todas as origens.
- As chaves `xmen`, `brotherhood` e `independent` são as mesmas de antes: quem já estava numa delas continua lá.
- Servidores que escreveram a própria lista `factions` (ou a própria `roles`) continuam com ela; o `legion doctor` mostra com ℹ️ as equipes novas que ficaram de fora.
- **Desligar uma equipe** é tirá-la de `factions`. Ela some do `/ranking` e dos menus; quem estava nela continua com a chave guardada, mas aparece e recebe o cargo como **Independente**. O `legion doctor` avisa (⚠️) quantos heróis estão em equipes desligadas. Religar a equipe devolve todos.
- A staff move um herói com `/cerebro equipe mover membro equipe motivo`: ignora a regra de origem e o tempo de espera, troca o cargo e guarda quem moveu e o motivo.
- Toda troca de equipe fica registrada (de onde, para onde, por quê e por quem). Entrar numa equipe pelas missões de recrutamento chega na próxima versão; essas trocas vão respeitar `cerebro.teams.switchCooldownDays` (30 dias).

### "Herói", não "mutante"

Os bots falam em **herói** com os jogadores. "Mutante" fica para a origem Mutante e para personagens e lugares das histórias. O comando `/mutante` virou `/heroi` e continua funcionando como apelido até a v1.0. O nome padrão do cargo **Mutante Registrado** não mudou, porque os cargos são achados pelo nome: se quiser outro nome ("Herói Registrado"), renomeie o cargo no Discord **e** o `name` do cargo `registered` em `roles` ([CONFIG.md](CONFIG.md)) antes de reiniciar; trocar só no arquivo cria um cargo novo.

## Nomes da Marvel: identidade original, história livre

**Pode** citar personagens, equipes, vilões e lugares da Marvel na **história**:

- título da missão, texto das cenas e texto dos botões;
- título e resumo de campanhas;
- perguntas de trivia.

Exemplos: "O Capitão América convoca você ao Helicarrier", "Uma reunião no Edifício Baxter", "Os Vingadores precisam de reforços".

**Não pode** usar nomes canônicos como **identidade**:

- codinome de jogador;
- nome de poder;
- nome de inimigo ou chefe (inclusive vilões como Magneto ou Doutor Destino);
- nome de item;
- texto gerado por IA.

Vilões famosos ficam nos bastidores. Para lutar contra o plano de um vilão, crie capangas originais **a serviço dele**:

| Em vez de | Use |
|---|---|
| Inimigo "Doutor Destino" | "Sentinela Latveriano" |
| Inimigo "Caveira Vermelha" | "Cultista do Sol Negro" |
| Chefe "Thanos" | "Arauto do Titã Louco" |

Regra prática: o **nome** do inimigo é seu; a **cena** pode contar para quem ele trabalha.

## Como o filtro funciona

A lista fica em `packages/core/data/canon-names.txt` (nomes em português e inglês). O filtro ignora acentos, maiúsculas, pontuação e troca de letras por números (`W0lv3r1ne`). Nomes de 6 letras ou mais também são recusados dentro de palavras maiores ("Wolverinezinho").

Nomes que também são palavras comuns começam com `=` na lista e só são recusados sozinhos: "Nova" é recusado, "Estrela Nova" passa; "Coisa" é recusado, "Coisa Ruim" passa.

Ids (`patrulha-noturna`, `recrutamento-vingadores`) não passam pelo filtro: eles não aparecem para os jogadores.

Os editores do site usam a mesma lista e as mesmas regras dos bots. Veja a decisão em [adr/0030](adr/0030-canon-names-identities-vs-narrative.md).
