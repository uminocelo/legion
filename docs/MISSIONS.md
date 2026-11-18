# Missões

Missões são histórias curtas com escolhas. Um membro registrado usa `/missao iniciar`, a missão abre um tópico em `channels.missions` e cada cena mostra botões. Em grupo (missões com `party` maior que 1), o líder abre um grupo, os outros clicam em **Entrar** e o líder clica em **Começar**.

- **Escolhas em grupo:** a maioria decide; empate fica com o voto do líder. Se o tempo (`jarvis.missions.choiceTimeoutMinutes`) acabar com alguns votos, eles decidem; sem nenhum voto, a missão é abandonada (sem XP).
- **Lutas:** uma cena de luta envia `mission.started` com `missionType: combat`. O ULTRON cria os inimigos (escalados pelo nível do grupo e pela dificuldade da missão) e o Sentinel conduz a luta no próprio tópico. Vitória segue para `win`, derrota (ou empate) para `lose`. Sem resultado em `combatTimeoutMinutes`, a missão fracassa. Missões com luta só aparecem quando `ultron` e `sentinel` estão em `bots`.
- **XP:** pago a cada membro no fim (sucesso ou fracasso), uma vez só, pelo J.A.R.V.I.S. (`reason: mission`). Quem saiu do servidor não recebe. Os valores vêm de `jarvis.missions.rewards`, por tipo, ou do campo `xp` da missão.
- **Limites:** por padrão, 1 missão diária por dia, 1 semanal por semana (segunda a domingo) e cada história uma vez (`jarvis.missions.limits`). Cada membro do grupo gasta o seu limite. Um grupo que fecha sem começar não conta.
- **Reinício:** o progresso fica no banco. Ao reiniciar, a cena que faltava postar é postada uma vez e os prazos continuam.

## Importar pelo Discord

A staff pode importar um arquivo de missão sem acesso ao servidor: `/jarvis missao importar` e anexe o `.yaml`. Veja [STAFF.md](STAFF.md#missões). Para montar o arquivo sem escrever YAML, use o [editor de missões](https://uminocelo.github.io/legion/editor-missoes.html): ele confere tudo com as mesmas regras deste documento.

## Escrever uma missão

Crie um arquivo por missão em `./data/content/missions/<id>.yaml` (no Docker, `data/` é o volume do servidor). Um arquivo com o mesmo `id` de uma missão que vem com o Legion a substitui. Reinicie o Legion para carregar. Rode `legion doctor` para ver erros.

```yaml
id: resgate-no-metro            # único; letras minúsculas, números e "-"
kind: daily                     # daily | weekly | story
title:                          # texto único ou por idioma (pt-BR obrigatório, en opcional)
  pt-BR: Resgate no metrô
  en: Subway rescue
summary: Um trem parou entre duas estações e ninguém responde.
minLevel: 1                     # nível mínimo (padrão 1)
party: 2                        # até quantos jogadores (1 a 4; padrão 1)
difficulty: normal              # facil | normal | dificil (escala os inimigos)
xp: { success: 50, failure: 10 } # opcional; sem ele vale jarvis.missions.rewards
start: plataforma               # cena inicial
scenes:
  plataforma:
    text: O túnel está escuro. Há uma porta de manutenção e os trilhos.
    choices:                    # 2 a 4 escolhas
      - { label: Porta de manutenção, next: corredor }
      - { label: Seguir os trilhos, next: emboscada }
  corredor:
    text: O corredor leva direto ao trem. Os passageiros estão bem.
    end: success
  emboscada:
    text: Drones do ULTRON bloqueiam os trilhos.
    combat: { win: trem, lose: recuo } # luta: precisa do ULTRON e do Sentinel
  trem:
    text: Os drones caem e vocês liberam o trem.
    end: success
  recuo:
    text: Vocês recuam. O trem fica parado até a manhã.
    end: failure
```

Regras que o Legion confere:

- Cada cena tem exatamente um de `choices`, `combat` ou `end`.
- Toda escolha e luta aponta para uma cena que existe, toda cena é alcançável a partir de `start`, não há ciclos (a história sempre termina) e há pelo menos um `end`.
- Títulos e textos de botões não podem ter nomes de personagens existentes da Marvel. Use personagens originais na história também.
- Um arquivo com erro não é carregado e a versão anterior da missão continua valendo. Missões que somem dos arquivos ficam inativas (o histórico continua).
