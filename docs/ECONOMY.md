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
