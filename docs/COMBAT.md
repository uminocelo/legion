# Combate do Sentinel

O combate é uma **função pura** da semente (`seed`), dos combatentes no início e das ações registradas em cada rodada. Por isso qualquer luta pode ser repetida e conferida com `/sentinel replay <combate>` (ADR 0020).

## Dados

- Todos os dados vêm de `mulberry32(seed)`, com a semente (uint32) criada uma vez por combate e guardada no banco.
- `d(n)` é um dado de 1 a n. Os dados são consumidos **sempre na ordem abaixo** (ADR 0021). Mudar a ordem muda os resultados; o teste "golden" (`packages/bot-sentinel/test/golden/`) existe para pegar isso.

## Combatentes

Cada combatente tem `hp` (atual), `maxHp`, `atk`, `def`, `spd`, `foc`, `powerCooldownMax` (padrão 3) e `powerCooldown` (atual). Atributos de jogador: `playerStats(arquétipo, nível, bônus, statCap)`, isto é, `computePlayerStats(arquétipo, nível)` mais o bônus do equipamento com teto no total (v0.10, [ECONOMY.md](ECONOMY.md#equipamento-nas-lutas)). Atributos ≤ 0 ou HP acima de 5000 são recusados.

Ações: **Atacar**, **Poder** (só com `powerCooldown = 0`) e **Defender**.

## Uma rodada

1. **Inimigos decidem**, em ordem de `id`: poder pronto e `d(100) ≤ 40` → poder; senão, HP abaixo de 30% e `d(100) ≤ 30` → defender; senão atacar. Só rola o dado quando a condição anterior permite.
2. **Jogadores sem escolha** atacam. Poder em recarga vira ataque.
3. **Defender** vale desde o início da rodada.
4. **Ordem de turno:** `spd` maior primeiro; empate por `id`. Quem caiu não age.
5. Para cada ataque ou poder:
   - **Alvo:** o oponente vivo com menos HP; empate por `id`.
   - **Acerto:** `r = d(20)`. 1 sempre erra; 20 sempre acerta e é crítico. Senão acerta se `r + ⌊spd/3⌋ ≥ 8 + ⌊spd_alvo/4⌋`.
   - **Dano (só no acerto):** ataque `max(1, atk + d(6) − ⌊def_alvo/2⌋)`; poder `max(1, ⌊foc × 1,5⌋ + d(8) − ⌊def_alvo/3⌋)`. Crítico dobra. Alvo defendendo recebe `max(1, ⌊dano/2⌋)`.
   - Usar poder põe `powerCooldown = powerCooldownMax`.
   - HP ≤ 0 → caído (HP 0).
6. **Fim da rodada:** todo `powerCooldown > 0` diminui 1 (inclusive o recém-usado: com máximo 3, o poder volta 3 rodadas depois).
7. **Fim do combate**, conferido após cada ação: um lado sem ninguém de pé perde e a rodada para ali (sem gastar mais dados). Na rodada `maxRounds` (padrão 20), vence o lado com maior soma de `hp/maxHp`; igual é empate.

**Abandono:** se nenhum jogador escolhe nada por 3 rodadas seguidas (`abandonAfterIdleRounds`), o combate acaba com vitória dos inimigos, sem rolar dados nessa rodada.

## Log e verificação

Uma entrada por ação (`round`, `actorId`, `action`, `targetId`, `roll`, `hit`, `crit`, `damage`, `targetHpAfter`), mais marcadores de rodada e de fim. `logHash` = SHA-256 do JSON canônico do log (chaves ordenadas). `replayCombat(seed, combatentes, entradas)` reproduz o mesmo log e o mesmo hash.

## No Discord

- O combate abre num tópico (`⚔️ Combate #id`) em `payload.channelId` ou `channels.combat`. Se o tópico não puder ser criado, vai no canal.
- Cada rodada tem botões Atacar / Poder / Defender. Só participantes clicam; dá para trocar a escolha até a rodada fechar. A rodada fecha quando todos os vivos escolheram ou após `roundTimeoutSeconds` (padrão 45).
- Ao reiniciar o bot, combates ativos ganham de volta o tempo limite da rodada; botões antigos continuam funcionando porque tudo está no banco.
- `raid_strike` (do ULTRON) resolve em uma rodada, sem botões: poder se pronto, senão ataque.
- Fim: vencedor, rodadas, dano por lado, MVP e o botão **Ver log completo** (15 linhas por página).

`/treino` luta contra o **Drone de Treino**: atributos de Tanque no seu nível com `atk × 0,7`, sem XP. Um combate por vez e espera de `training.cooldownSeconds` (padrão 300 s).
