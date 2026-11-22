# Temporadas

Uma temporada é uma janela com ranking próprio: o XP que cada herói ganha **nessa janela** conta para o placar. No fim, os primeiros ganham medalha de colocação, o placar fica arquivado e a pontuação da temporada zera. O XP vitalício não muda.

Desligado por padrão (`jarvis.season.enabled: false`). Nada agenda até você ligar.

## Ligar

```yaml
jarvis:
  season:
    enabled: true
    length: month          # month, ou um número de dias entre 7 e 90
    reset: season_score    # só a pontuação da temporada; o XP vitalício fica
    rewards:
      top: 3               # 1–25 primeiros ganham medalha
```

Reinicie (`docker compose up -d`). Com temporadas ligadas, o J.A.R.V.I.S. agenda a próxima janela (no `month`, começa no dia 1 no fuso do servidor).

## Jogadores

`/temporada` mostra o placar da temporada ativa, o tempo restante e, se você já ganhou medalhas, quantas tem e a melhor colocação.

O placar usa o livro-caixa de XP: só entradas dentro da janela. Quem saiu do servidor não aparece. `/ranking` continua sendo o ranking periódico de sempre (dia / semana / mês / tudo); a temporada é outra lista.

## Staff

| Comando | O que faz |
| --- | --- |
| `/jarvis temporada iniciar` | Começa agora. Se já houver uma agendada, ela é antecipada |
| `/jarvis temporada encerrar` | Encerra a ativa, grava o arquivo, emite `season.ended` e agenda a próxima |

Um encerramento (job ou comando) fecha a temporada **uma vez**. Os `rewards.top` primeiros ganham uma medalha de colocação; repetir o evento não duplica. Detalhes em [STAFF.md](STAFF.md) e as chaves em [CONFIG.md](CONFIG.md).
