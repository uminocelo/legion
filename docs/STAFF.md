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

Quer uma categoria nova, como `marvel`? Acrescente em `jarvis.trivia.categories` no `legion.config.yaml` e reinicie uma vez.

## Missões

Escreva a missão num arquivo `.yaml` (formato em [MISSIONS.md](MISSIONS.md); copie uma das missões do `content/missions/` como ponto de partida).

1. `/jarvis missao importar arquivo:` e anexe o `.yaml` (até 64 KB).
2. O J.A.R.V.I.S. confere o arquivo com as mesmas regras dos arquivos de conteúdo: campos, cenas ligadas, sem ciclos, com final, sem nomes de personagens existentes nos títulos e escolhas. Se houver erro, ele lista campo e linha, e **nada muda**.
3. Sem erros, aparece uma prévia (tipo, nível, grupo, cenas, lutas). **Publicar** coloca a missão em jogo na hora; **Cancelar** descarta.

Mesmo `id` de uma missão que já existe? A prévia avisa e a importada substitui a de arquivo. Para voltar à versão do arquivo, apague a importada no banco ou importe o arquivo original de novo.

| Comando | O que faz |
|---|---|
| `/jarvis missao lista` | Todas as missões, ligadas ou não, e quem importou (ou "arquivo") |
| `/jarvis missao desativar` / `ativar` | Tira ou volta uma missão para novas partidas. Partidas em andamento terminam normalmente |

## Inimigos do ULTRON

Mesmo formato do `enemies.yaml` ([WORLD_EVENTS.md](WORLD_EVENTS.md)): uma lista com um ou mais inimigos.

1. `/ultron inimigo importar arquivo:` e anexe o `.yaml`.
2. A prévia mostra cada inimigo como 🆕 (novo) ou ♻️ (substitui um que existe), com tier, nível e atributos. Erros listam item e campo, e nada muda.
3. **Publicar**: os próximos encontros já podem usar os inimigos.

| Comando | O que faz |
|---|---|
| `/ultron inimigo lista` | Todos os inimigos e de onde vieram |
| `/ultron inimigo desativar` / `ativar` | Tira ou volta um inimigo. Precisa sobrar pelo menos um minion de nível 1 |

## Segurança

- Só arquivos enviados ao próprio Discord são baixados (`cdn.discordapp.com`), com limite de tamanho.
- A prévia vale para um clique: depois de publicar ou cancelar, importe de novo.
- Quem não é staff não vê os comandos e, mesmo com um botão antigo, recebe "Apenas a staff".
