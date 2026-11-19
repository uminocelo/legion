# Economia e equipamento (J.A.R.V.I.S. v2)

> v0.10. Créditos, equipamento, loja e o editor de itens.
> Não existe dinheiro real em lugar nenhum do Legion: créditos e itens só se ganham jogando ou pela staff.

## Créditos

Créditos são a moeda do jogo. Ficam no J.A.R.V.I.S. como um histórico (cada entrada ou saída é uma linha) e um saldo guardado ([ADR 0028](adr/0028-credits-ledger.md)). Cada pagamento tem uma chave única, então nada é pago duas vezes, mesmo quando um evento chega repetido ou o bot reinicia.

| De onde vem | Quanto (padrão) | Chave |
|---|---|---|
| Missão no fim (sucesso / fracasso) | diária 20/5, semanal 60/15, história 40/10; ou o campo `credits` da missão | `mission:<partida>:<membro>` |
| Resposta certa na trivia | 2 (o limite diário de XP não bloqueia) | `trivia:<tentativa>` |
| Evento do mundo que termina (vitória / derrota) | 30 / 10 para cada participante | `world:<evento>:<membro>` |
| Guerra de facções (`war.ended`) | 50 para cada herói da facção vencedora que pontuou (`jarvis.economy.war.winner`). Empate paga todas | `war:<guerra>:<membro>` |
| Staff (`/jarvis creditos dar`) | -10000 a 10000 | `staff:<interação>` |

- Missão abandonada e evento cancelado não pagam. Quem saiu do servidor não recebe.
- O saldo nunca fica negativo: uma saída maior que o saldo é recusada e nada muda.
- `/carteira` (só você vê) mostra o saldo e as últimas 10 movimentações.
- `jarvis.economy.enabled: false` desliga os pagamentos; o que já foi pago continua lá.
- `legion playtest-report` mostra os créditos do período por motivo, o que a staff deu ou tirou, e acusa ❌ quando um saldo não bate com o histórico ou fica negativo.

```yaml
jarvis:
  economy:
    enabled: true
    trivia: { correct: 2 }
    missions:
      daily: { success: 20, failure: 5 }
      weekly: { success: 60, failure: 15 }
      story: { success: 40, failure: 10 }
    worldEvents: { victory: 30, participation: 10 }
    war: { winner: 50 }
```

## Equipamento nas lutas

Cada herói tem três espaços: **traje**, **acessório** e **dispositivo**, com um item em cada. Um item equipado soma um bônus pequeno aos atributos.

- **Teto no total.** Os bônus de todos os itens equipados são somados e cada atributo fica limitado a `statCap` (padrão **2**); a vida a `statCap × 8` (padrão **16**). Três itens com +2 de ataque dão +2, não +6. `/inventario` mostra "limite atingido" quando a soma passa do teto.
- **Onde vale.** Treino (Sentinel), lutas de missão e golpes em eventos do mundo (ULTRON) e a ficha do `/perfil` (Cérebro) usam a mesma conta: `playerStats(arquétipo, nível, bônus, statCap)`.
- **Quando vale.** O bônus entra na foto da luta quando ela começa. Trocar de item no meio de uma luta só vale na próxima.
- **Item desativado.** Um item desativado (arquivo removido, ou `active: false`) sai do espaço e continua no inventário como "desativado". Não dá bônus e não volta sozinho quando for reativado.
- **J.A.R.V.I.S. desligado.** Sem J.A.R.V.I.S. ninguém tem equipamento e as lutas são como na v0.8.1.

```yaml
jarvis:
  economy:
    gear:
      statCap: 2      # 0 = equipamento só visual neste servidor ("sem efeito neste servidor")
```

Por que o teto é no total, e não só por item: [ADR 0029](adr/0029-gear-bonus-read-model-and-cap.md).

## Loja

- `/loja [pagina]` (só você vê) lista os itens à venda: os itens ativos com `shop.price`, 25 por página, na ordem de `shop.order`, depois nível, depois nome. Cada linha mostra preço, espaço, nível e bônus, e marca "você já tem", "precisa do nível N" e "visual". O rodapé mostra seu saldo.
- Escolha um item no menu e clique em **Comprar**. O botão fica desligado sem créditos suficientes ou sem o nível. Só quem abriu a loja pode usar.
- A compra é uma coisa só: tira os créditos e põe o item no inventário na mesma transação. Se algo falhar, nada muda. A chave `buy:<membro>:<item>` impede pagar duas vezes, mesmo com dois cliques ao mesmo tempo.
- Recusas (nada é cobrado): créditos insuficientes, item que você já tem, item que saiu da loja, nível baixo, e preço mudado desde que a loja abriu (mostra o preço novo; clique de novo para comprar).
- Não há venda de volta nem reembolso. Para corrigir um engano, a staff usa `/jarvis creditos dar`.
- Com `jarvis.economy.enabled: false` a loja fica fechada. O `legion doctor` avisa ⚠️ quando a economia está ligada e nenhum item está à venda.
- Os itens que vêm com o Legion custam de 60 a 360 créditos; o broche de recruta não está à venda (é presente da staff).

## Inventário

- `/inventario` (só você vê): os três espaços, os itens que você tem e um menu por espaço para equipar; **Desequipar** esvazia o espaço. Só quem abriu o menu pode usar. Itens de nível maior que o seu aparecem com "nível N" e ainda não podem ser equipados.
- Cada item é único: você tem ou não tem. Itens entram no inventário pela staff (`/jarvis item dar`) ou pela `/loja`.
- O `/perfil` mostra os itens equipados no cartão e os atributos já com o bônus.

## Criar itens

Três jeitos, todos com o mesmo formato e as mesmas regras:

1. **Editor no navegador:** o [editor de itens](https://uminocelo.github.io/legion/editor-itens.html) monta o arquivo com os limites de cada bônus, confere nomes e baixa `itens.yaml`. Dá para abrir um arquivo existente e partir dos itens do Legion.
2. **Pelo Discord:** `/jarvis item importar` com o arquivo anexado. A prévia mostra o que é novo, o que muda (e quantos jogadores têm cada item alterado) e o que fica igual; **Publicar** aplica. Itens importados são da staff: reiniciar não mexe neles, e `/jarvis item exportar` devolve o arquivo.
3. **Na pasta:** `data/content/items/*.yaml`, lidos ao iniciar.

Dicas de equilíbrio: a maioria dos itens dá +1 num atributo ou +8 de vida; +2 ou +16 é para níveis altos. Lembre que o total equipado tem teto, então três itens fortes não somam mais que o teto. Preços dos itens do Legion: 60 a 360 créditos, e uma missão diária paga 20.

Um item alterado vale a partir da próxima luta. Para tirar um item de jogo sem apagar de ninguém, use `/jarvis item desativar` ([STAFF.md](STAFF.md#itens)).

## Arquivos de itens

Os itens que vêm com o Legion estão em `packages/bot-jarvis/content/items/`. Os do servidor ficam em `data/content/items/*.yaml` (mesmo `id` substitui um item enviado) e são lidos ao iniciar. Um arquivo com erro é ignorado inteiro e o `legion doctor` mostra ❌. Os itens importados pelo Discord não podem usar o id de um item dos arquivos.

```yaml
- id: traje-tatico               # letras minúsculas, números e "-" (3 a 48)
  slot: traje                    # traje | acessorio | dispositivo
  minLevel: 3                    # 1 a 50
  name: { pt-BR: Traje tático, en: Tactical suit }      # nome original, até 60 caracteres
  description: { pt-BR: "Placas finas nos ombros.", en: "Thin plates on the shoulders." }  # opcional, até 200
  bonus: { def: 1, hp: 8 }       # atk/def/spd/foc 0 a 2, hp 0 a 16
  cosmetic: false                # true = sem bônus (bonus: {} ou sem bonus)
  shop: { price: 140, order: 10 } # opcional: à venda na /loja (price 1 a 100000; order 0 a 10000)
  # active: false                     # tira o item: sai de quem equipou e fica no inventário
```

- No máximo 50 itens por arquivo. Nomes de personagens da Marvel são recusados ([UNIVERSE.md](UNIVERSE.md)).
- Remover um item do arquivo (ou `active: false`) desequipa de todo mundo e o deixa "desativado" no inventário.
- Confira antes de reiniciar: `docker compose run --rm legion legion content validate data/content/items`.
