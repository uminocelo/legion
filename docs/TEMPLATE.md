# Modelo de servidor do Legion

Um **modelo de servidor do Discord** cria as categorias, os canais, os cargos e as permissões de uma vez. O Legion não cria canais: você monta o servidor pelo modelo; o `legion init` (e `legion init --fill-channels`) preenche os IDs no `legion.config.yaml` pelos nomes desta lista.

**Link do modelo:** [https://discord.new/2atTmU2JHg59](https://discord.new/2atTmU2JHg59) (este documento é a lista que o modelo segue).

## Usar o modelo

1. Abra o link do modelo e escolha **Criar servidor**.
2. Instale o Legion ([SELF_HOSTING.md](SELF_HOSTING.md)) e convide os bots.
3. Rode `legion init` (ou `legion init --fill-channels` se o YAML já existir). Confira o relatório (preenchido / mantido / ausente / ambíguo) e rode `legion doctor`. Se algum nome não bater, o fallback continua sendo copiar o ID à mão (modo desenvolvedor → botão direito no canal → **Copiar ID**).
4. Rode `/cerebro setup aplicar:true canais:true` e depois `legion doctor` de novo se precisar.

O modelo copia estrutura, cargos e permissões. Mensagens e bots não vêm junto.

## Refazer o modelo (mantenedores)

`pnpm legion template` mostra o plano. Com o Cérebro num servidor vazio que você criou, `pnpm legion template --guild <id>` diz o que vai fazer e `--guild <id> --create` monta tudo e publica o modelo. Ele recusa um servidor com cargos ou canais fora desta lista e só apaga os canais padrão do Discord. O cargo do Cérebro precisa ficar no topo da lista. É uma ferramenta para montar o modelo: os bots em funcionamento continuam sem criar canais.

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
| `atualizacoes-discord` | 💬 | — (canal de atualizações da comunidade, veja abaixo) |
| `alertas-seguranca` | 💬 | — (canal de notificações de segurança, veja abaixo) |

`@everyone` ❌ em Ver canal, cargos da staff ✅. O Legion não mexe em canais da staff.

## Comunidade do Discord (depois de criar)

O modelo não guarda as configurações de Comunidade. Só o **dono do servidor** (ou um bot com **Administrador**) consegue ligar a Comunidade, então ligue à mão em **Configurações do servidor → Ativar Comunidade**:

| Configuração | Use o canal |
|---|---|
| Canal de regras | `regras` |
| Canal de atualizações da comunidade | `atualizacoes-discord` (avisos do Discord para a moderação) |
| Canal de notificações de segurança | `alertas-seguranca` (alertas de atividade estranha, como raids e spam por DM) |

Com a Comunidade ligada, o `anuncios` pode virar um canal de anúncios de verdade.

**Descrição do servidor** (Configurações → Perfil do servidor; aparece nos convites):

> Base de heróis originais do universo Marvel. Crie seu herói, entre numa equipe, faça missões e trivia, lute e defenda o servidor nas invasões do ULTRON. Tudo dentro do Discord.

## Cargos do modelo

Os cargos padrão do Legion ([CONFIG.md](CONFIG.md#roles)), com os mesmos nomes: Professor X, Conselho da Legião, Sentinela, Sinal Detectado, Herói Registrado, as 9 equipes, os ranks e os opcionais. O Cérebro reconhece cada um pelo nome e não cria de novo. Arraste o cargo do bot para cima dos cargos de equipe e de rank.

## Depois de montar

- `legion doctor`: as linhas **Canais** e **Áreas das equipes** devem ficar ✅.
- Um ⚠️ em **Áreas das equipes** aponta um canal da área com permissão diferente; acerte ou deixe se foi de propósito.
- Coisas só do seu servidor (um canal de criadores de conteúdo, por exemplo) ficam fora do modelo público: acrescente depois, por cima.
