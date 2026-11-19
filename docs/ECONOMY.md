# Economia e equipamento (J.A.R.V.I.S. v2)

> v0.10. Este documento cresce a cada parte: equipamento (US-15) primeiro; créditos e loja vêm depois.
> Não existe dinheiro real em lugar nenhum do Legion: créditos e itens só se ganham jogando ou pela staff.

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

## Inventário

- `/inventario` (só você vê): os três espaços, os itens que você tem e um menu por espaço para equipar; **Desequipar** esvazia o espaço. Só quem abriu o menu pode usar. Itens de nível maior que o seu aparecem com "nível N" e ainda não podem ser equipados.
- Cada item é único: você tem ou não tem. Itens entram no inventário pela staff (`/jarvis item dar`) e, depois, pela loja.
- O `/perfil` mostra os itens equipados no cartão e os atributos já com o bônus.

## Arquivos de itens

Os itens que vêm com o Legion estão em `packages/bot-jarvis/content/items/`. Os do servidor ficam em `data/content/items/*.yaml` (mesmo `id` substitui um item enviado) e são lidos ao iniciar. Um arquivo com erro é ignorado inteiro e o `legion doctor` mostra ❌.

```yaml
- id: traje-tatico               # letras minúsculas, números e "-" (3 a 48)
  slot: traje                    # traje | acessorio | dispositivo
  minLevel: 3                    # 1 a 50
  name: { pt-BR: Traje tático, en: Tactical suit }      # nome original, até 60 caracteres
  description: { pt-BR: "Placas finas nos ombros.", en: "Thin plates on the shoulders." }  # opcional, até 200
  bonus: { def: 1, hp: 8 }       # atk/def/spd/foc 0 a 2, hp 0 a 16
  cosmetic: false                # true = sem bônus (bonus: {} ou sem bonus)
  # shop: { price: 120, order: 10 }   # loja (versão seguinte)
  # active: false                     # tira o item: sai de quem equipou e fica no inventário
```

- No máximo 50 itens por arquivo. Nomes de personagens da Marvel são recusados ([UNIVERSE.md](UNIVERSE.md)).
- Remover um item do arquivo (ou `active: false`) desequipa de todo mundo e o deixa "desativado" no inventário.
- Confira antes de reiniciar: `docker compose run --rm legion legion content validate data/content/items`.
