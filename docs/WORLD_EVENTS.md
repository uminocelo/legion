# ULTRON: inimigos, invasões e raids

O ULTRON é o vilão. Ele **nunca resolve combate**: monta os inimigos e pede a luta ao Sentinel (`combat.requested`). Todo número (HP, dano, XP, horários) é decidido por código determinístico; a IA opcional só escreve frases.

Ligue com `bots: [cerebro, jarvis, sentinel, ultron]` (o Sentinel é obrigatório) e defina `channels.events`.

## Inimigos

Ficam em `packages/bot-ultron/content/enemies.yaml`. Para trocar ou acrescentar, crie `data/content/enemies.yaml` (mesmo `id` substitui):

```yaml
- id: drone-vigia
  name: "Drone Vigia"       # nome original; nomes de personagens existentes são recusados
  tier: minion              # minion | elite | boss
  minLevel: 1
  base: { hp: 60, atk: 8, def: 5, spd: 9, foc: 6 }   # chefes usam hp: 0 (o HP vem do evento)
  powerCooldownMax: 4
  tauntKeys: [ultron.taunt.drone.1]
```

Se o arquivo tiver erro, o bot avisa no log e no `legion doctor` e **continua com os inimigos anteriores**.

## Encontros escalados

Para um grupo de nível L e tamanho n (1 a 4):

- **Atributos:** `piso(base × (1 + 0,10 × (L − 1)) × dificuldade × adaptativo)`, mínimo 1. Dificuldade: fácil 0,8, normal 1,0, difícil 1,25.
- **Composição:** n lacaios, +1 lacaio no difícil, +1 elite quando L ≥ 5 (exceto no fácil). Só entram inimigos com `minLevel ≤ L`.
- **Sorteio:** a semente do encontro (`mulberry32`) escolhe os modelos; mesma semente, mesmos inimigos. Semente e multiplicadores ficam salvos no encontro.
- **Dificuldade adaptativa** (desligada por padrão, `ultron.adaptive.enabled`): com pelo menos `minSample` combates em grupo, `1 + limite((vitórias − 0,65) × 0,5, ±0,15)`; empate vale meia vitória.

Uma missão de combate do J.A.R.V.I.S. (`mission.started`) gera um encontro uma única vez. Para testar sem missão, a staff usa `/ultron spawn <dificuldade> [membro1..4]`. O resultado do Sentinel fica salvo no encontro.

## Eventos mundiais

| | Invasão | Raid |
|---|---|---|
| Quando | Toda semana (`ultron.invasion.cron`, padrão sábado 20:00 no fuso do servidor) | Pela staff, ou `ultron.raids.cron` |
| Quem | Todas as facções juntas | Quem quiser, num tópico |
| Inimigo | Enxame (`invasion.templateId`) | Chefe (`raids.templateIds`) |
| Ondas | 1 a 5, pelo medidor de **ameaça** (`invasion.waves`) | Sempre 1 |
| Resultado | Total, maiores danos, **dano por facção** e cada onda | Total e maiores danos |

Ciclo: **agendado → anunciado** (`announceMinutesBefore`, 60 min) **→ em andamento → encerrado** (ou cancelado).

1. No início o HP é fixado: `hpPerParticipant × expectedParticipants × dificuldade` (padrão 300 × 8). Com a adaptativa ligada, os participantes esperados vêm da média dos 3 últimos eventos do mesmo tipo (mínimo 3).
2. Cada clique em **Atacar** é uma luta de uma rodada contra uma cópia do chefe, resolvida pelo Sentinel. O dano sai do HP compartilhado. Depois, espere `strikeCooldownMinutes` (10). Quem cai na luta espera o dobro.
3. HP em 0 → **vitória**. Tempo esgotado com HP sobrando → **derrota**. Numa invasão com várias ondas, HP em 0 com ondas sobrando começa a próxima na mesma mensagem (veja abaixo).
4. XP (pelo J.A.R.V.I.S., uma vez por participante): vitória 50 + até 50 de bônus proporcional ao dano; derrota 15. Sem o J.A.R.V.I.S., o evento funciona sem XP.

Tudo roda por tarefas agendadas no banco: se o bot reinicia, as tarefas atrasadas rodam uma vez na volta, e nada é postado duas vezes. Um evento cujo fim passou com o bot desligado termina na volta com o HP que tinha.

### Ondas

Uma invasão pode ter de 1 a 5 ondas. O número e a dificuldade são fixados quando ela começa:

- `ultron.invasion.waves: threat` (padrão): vêm do medidor de ameaça. Abaixo de 34: 1 onda, normal. De 34 a 66: 2 ondas, normal. 67 ou mais: 3 ondas, difícil. Com `threat.enabled: false`, 1 onda na dificuldade de `events.difficulty`.
- Um número de 1 a 5: sempre essa quantidade, na dificuldade de `events.difficulty`.

A onda 1 tem o HP de sempre. Cada onda seguinte tem `waveHpGrowth` (0,25 = +25%) a mais de HP que a anterior, e o chefe sobe 1 nível. A troca acontece uma vez só, mesmo com vários ataques chegando juntos. Um ataque que começou na onda anterior e termina depois da troca acerta a onda nova. A mensagem do evento mostra "HP · Onda 2/3" na hora.

Tempo esgotado no meio é **derrota**: as ondas vencidas ficam como limpas e a atual como falha. O resultado lista cada onda com o tempo e quem mais causou dano nela. As ondas não alcançadas aparecem como tal. Se o bot reinicia entre ondas, ele volta na onda e no HP salvos. Raids têm sempre 1 onda.

### Ameaça

Um medidor de 0 a 100 por servidor, que começa em 0. Todo dia, às 00:10 no fuso do servidor, o ULTRON olha o dia anterior. Missões terminadas (vitória ou derrota; abandonadas não contam) mais ataques em eventos são a atividade do dia. Com pelo menos `threat.activeActions` (3), a ameaça cai `activeFall` (5). Com menos, sobe `idleRise` (10).

Cada dia conta uma vez só (`last_tick_day`). Se o bot ficou desligado, os dias perdidos são aplicados na volta, até 7. Os mais antigos são ignorados. `/ameaca` mostra a barra, o nível (baixa, média ou alta) e o que ele significa para a próxima invasão, mesmo sem evento marcado. `ultron.threat.enabled: false` desliga o medidor e o campo.

### Comandos

- `/ameaca`: o medidor de **ameaça**, o evento atual ou próximo, a onda, o HP, o tempo, seu dano e quando você pode atacar.
- Staff: `/ultron evento agendar <tipo> <quando>` (`AAAA-MM-DD HH:mm` no fuso do servidor, ou `+30m`, `+2h`), `/ultron evento iniciar <tipo>`, `/ultron evento cancelar [tipo]`, `/ultron spawn`, `/ultron status`.

Dois eventos do mesmo tipo não podem se sobrepor; uma raid durante uma invasão pode.

## Guerra de facções

Uma guerra por vez. Com `ultron.war.length: month` (padrão) ela começa no dia 1 e termina no dia 1 seguinte, no fuso do servidor. Um número de 7 a 90 é a duração em dias: a primeira começa na hora e a seguinte começa quando a anterior termina.

Pontos ficam na facção do herói **na hora do lance**. Trocar de equipe no meio não move o que já foi marcado. Independente não pontua. Quem saiu do servidor para de pontuar e conserva o que já ganhou.

| De onde vem | Padrão |
|---|---|
| Missão vencida / perdida | 10 / 3 (`war.points.missionSuccess` / `missionFailure`). Abandonada não conta |
| Ataque em invasão ou raid | 2 (`war.points.strike`) |
| Participar de um evento que termina em vitória ou derrota | 5 (`war.points.participation`) |
| Staff | -1000 a 1000, nunca 0, com motivo |

O vencedor é a facção com mais pontos, entre as que têm mais de zero. Empate: todas empatadas ganham. Ninguém pontuou: sem vencedor.

No fim, o ULTRON posta o resultado em `channels.events` e emite `war.ended`. O J.A.R.V.I.S. paga `jarvis.economy.war.winner` (padrão 50) uma vez a cada herói da facção vencedora que pontuou (`war:<guerra>:<membro>`). Economia desligada ou J.A.R.V.I.S. desligado: a guerra acontece e ninguém recebe créditos. A próxima guerra é agendada em seguida.

- `/guerra`: placar, tempo restante, seus pontos e os da sua facção. Sem guerra ativa, diz quando a próxima começa.
- Staff: `/ultron guerra iniciar`, `/ultron guerra encerrar`, `/ultron guerra pontos`.
- `ultron.war.enabled: false` não agenda nem pontua. Uma guerra já marcada ainda encerra.
- `legion doctor` mostra se há guerra ativa ou agendada. `legion playtest-report` tem a seção **Guerra** (pontos por facção e motivo, ajustes da staff) e acusa facção desconhecida ou chave de origem repetida. Também sai no `--json`.

Decisão: [ADR 0033](adr/0033-faction-war.md).

## Frases por IA (opcional)

Desligado por padrão (`ultron.ai.provider: none`): as frases vêm de `locales/` e **nenhuma chamada de rede** é feita. Para gerar provocações e anúncios com um modelo local (Ollama) ou qualquer API compatível com OpenAI, veja [SELF_HOSTING.md](SELF_HOSTING.md#ia-opcional-ollama). A IA recebe só fatos já decididos, a resposta passa por um filtro (menções, links e nomes de personagens existentes são removidos ou recusados) e qualquer erro, demora ou limite por hora volta para a frase fixa.
