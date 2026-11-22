# Modelo de servidor do Legion

Um **modelo de servidor do Discord** cria as categorias, os canais, os cargos e as permissões de uma vez. O Legion não cria canais: você monta o servidor pelo modelo e depois cola os IDs no `legion.config.yaml`.

**Link do modelo:** [https://discord.new/2atTmU2JHg59](https://discord.new/2atTmU2JHg59) (este documento é a lista que o modelo segue).

## Usar o modelo

1. Abra o link do modelo e escolha **Criar servidor**.
2. Instale o Legion ([SELF_HOSTING.md](SELF_HOSTING.md)) e convide os bots.
3. Ligue o modo desenvolvedor (Configurações → Avançado), clique com o botão direito em cada canal → **Copiar ID** e cole na chave indicada abaixo.
4. Rode `/cerebro setup aplicar:true canais:true` e depois `legion doctor`.

O modelo copia estrutura, cargos e permissões. Mensagens e bots não vêm junto.

## Categorias e canais

Tipo: 💬 texto · 📋 fórum · 🔊 voz · 📢 anúncios.

### 📜 Início (todos veem, até quem acabou de chegar)

| Canal | Tipo | Chave no config | Quem vê |
|---|---|---|---|
| `boas-vindas` | 💬 | `channels.welcome` | todos |
| `regras` | 💬 | `channels.rules` | todos |
| `anuncios` | 📢 | — | heróis registrados; só a staff escreve |
| `guia` | 💬 | `herbie.tips.channelId` (opcional) | heróis registrados |

### 🌍 O Mundo (heróis registrados)

| Canal | Tipo | Chave no config | Observação |
|---|---|---|---|
| `registro` | 💬 | `channels.registry` | cartões de novos heróis |
| `eventos` | 💬 | `channels.events` | invasões e raids do ULTRON |
| `missoes` | 💬 | `channels.missions` | cada missão abre um tópico aqui |
| `combate` | 💬 | `channels.combat` | tópicos de luta do Sentinel |
| `tutorial` | 💬 | `channels.tutorial` (opcional) | para quem tem a DM fechada |

### 💬 Comunidade (heróis registrados)

| Canal | Tipo | Observação |
|---|---|---|
| `geral` | 💬 | conversa livre |
| `fan-art` | 📋 | um post por arte |
| `teorias` | 📋 | um post por teoria ou pergunta |
| `taverna` | 🔊 | voz livre |

Nenhuma chave no config: o Legion só deixa esses canais visíveis para quem se registrou.

### Uma categoria por equipe (só a equipe e a staff)

Para cada equipe abaixo, a mesma estrutura:

| Canal | Tipo | Chave no config |
|---|---|---|
| (a categoria) | — | `factions[].categoryId` |
| `quartel-<equipe>` | 💬 | — (conversa da equipe) |
| `noticias-<equipe>` | 💬 | `factions[].newsChannelId` |
| `esquadroes-<equipe>` | 💬 | `factions[].squadChannelId` (v1.1, esquadrões) |
| `planos-<equipe>` | 📋 | — (estratégia e arcos) |
| `sala-<equipe>` | 🔊 | — |

| Categoria | Equipe (`key`) | Cargo |
|---|---|---|
| 🔵 X-Men | `xmen` | X-Men |
| 🔴 Irmandade | `brotherhood` | Irmandade |
| 🟡 Vingadores | `avengers` | Vingadores |
| ⚫ S.H.I.E.L.D. | `shield` | S.H.I.E.L.D. |
| 🟣 Guardiões | `guardians` | Guardiões |
| 🟠 Defensores | `defenders` | Defensores |
| ⚡ Thunderbolts | `thunderbolts` | Thunderbolts |
| 🌙 Filhos da Meia-Noite | `midnight_sons` | Filhos da Meia-Noite |

Independente não tem área: é a equipe de quem acabou de chegar, e a Comunidade serve a todos.

Na categoria, a permissão **Ver canal** fica: `@everyone` ❌, o cargo da equipe ✅, os cargos da staff ✅. Os canais dentro dela seguem a categoria (sincronizados). Se você esquecer, `/cerebro setup canais:true aplicar:true` acerta tudo.

### 🛡️ Staff (só a staff)

| Canal | Tipo | Chave no config |
|---|---|---|
| `fila-moderacao` | 💬 | `channels.modQueue` |
| `staff` | 💬 | — |
| `logs` | 💬 | — |
| `sala-staff` | 🔊 | — |

`@everyone` ❌ em Ver canal, cargos da staff ✅. O Legion não mexe em canais da staff.

## Cargos do modelo

Os cargos padrão do Legion ([CONFIG.md](CONFIG.md#roles)), com os mesmos nomes: Professor X, Conselho da Legião, Sentinela, Sinal Detectado, Mutante Registrado, as 9 equipes, os ranks e os opcionais. O Cérebro reconhece cada um pelo nome e não cria de novo. Arraste o cargo do bot para cima dos cargos de equipe e de rank.

## Depois de montar

- `legion doctor`: as linhas **Canais** e **Áreas das equipes** devem ficar ✅.
- Um ⚠️ em **Áreas das equipes** aponta um canal da área com permissão diferente; acerte ou deixe se foi de propósito.
- Coisas só do seu servidor (um canal de criadores de conteúdo, por exemplo) ficam fora do modelo público: acrescente depois, por cima.
