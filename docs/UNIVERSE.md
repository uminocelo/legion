# Universo Marvel

O Legion é um projeto de fã do universo Marvel. Este guia explica o que pode e o que não pode aparecer no conteúdo do seu servidor. Origens e equipes entram nas próximas versões e serão descritas aqui.

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
