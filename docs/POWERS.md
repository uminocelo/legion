# Poderes

No cadastro, cada membro escolhe uma **origem** e depois **1 poder principal** e até **2 secundários** entre os poderes daquela origem. O tipo do poder principal define o **arquétipo** (e com ele os atributos base). Os poderes aparecem na ficha (`/perfil`) e no cartão; **não têm efeito numérico** além do arquétipo, então o equilíbrio do jogo não muda. O campo livre "Descreva seu poder" continua: é onde o membro conta, com as palavras dele, como o poder funciona.

## Ordem do cadastro

Regras → **origem** → **poder principal** (o arquétipo aparece na hora) → **secundários** (opcional) → ficha com codinome, descrição e história. O botão **Trocar origem** volta ao menu de origens.

Quando uma origem tem mais de 25 poderes, o limite de um menu do Discord, os poderes vêm em mais de um menu, agrupados por tipo.

## Tipos e arquétipos

| Tipo (`type`) | Arquétipo padrão |
|---|---|
| `offensive` (Ofensivo) | Metamorfo |
| `defensive` (Defensivo) | Tanque |
| `psionic` (Psiônico) | Telepata |
| `elemental` (Elemental) | Elemental |
| `movement` (Movimento) | Velocista |
| `utility` (Utilitário) | Tecnopata |

Mude em `cerebro.powers.typeToArchetype` ([CONFIG.md](CONFIG.md#cerebro)). Um tipo cujo arquétipo não está em `cerebro.archetypes` some do cadastro.

## Origens

Cada poder pode ter `origins`: a lista de origens que podem escolhê-lo. **Sem `origins`, o poder vale para todas.** Origens: `mutante`, `inumano`, `ciencia`, `tecnologia`, `mistico`, `cosmico`, `treinado` ([UNIVERSE.md](UNIVERSE.md#origens)).

- O catálogo que vem com o Legion marca os superpoderes para Mutante, Inumano, Ciência, Místico e Cósmico, e traz habilidades (Treinado) e equipamentos (Tecnologia).
- Cada origem precisa de poderes de pelo menos **2 tipos**. Uma origem **sem nenhum poder** some do cadastro e o `legion doctor` mostra ❌ com o nome dela; com poderes de um tipo só, mostra ⚠️.
- Um poder de outra origem é recusado no menu e de novo ao enviar a ficha.

## Heróis registrados antes

Quem já tinha ficha sem poderes do catálogo usa `/heroi poderes` **uma vez** para escolher os poderes. O arquétipo continua o mesmo, a não ser que a staff ligue `cerebro.powers.allowArchetypeChange`.

Quem se registrou antes das origens virou **Mutante** e pode trocar de origem **uma vez** com `/heroi origem`. Poderes que servem na nova origem ficam; se algum não servir, o menu de poderes abre de novo (Cancelar não muda nada). O comando é `/heroi`. `/mutante` foi removido.

## Acrescentar ou trocar poderes

O catálogo vem em `packages/bot-cerebro/content/powers.yaml` (46 poderes). Para o seu servidor, crie `data/content/powers.yaml`: mesmo `id` substitui, `id` novo acrescenta. Reinicie o bot para carregar.

```yaml
- id: rajada-de-chi        # letras minúsculas, números e "-"
  type: offensive
  origins: [mistico, treinado]   # opcional; sem a chave = todas as origens
  name: { pt-BR: "Rajada de chi", en: "Chi blast" }
  description: { pt-BR: "Concentra energia vital num golpe.", en: "Focuses life energy into a strike." }
```

- `name` até 60 caracteres, `description` até 100. `en` é opcional.
- Nomes de personagens existentes são recusados: use nomes genéricos de poderes. Veja [UNIVERSE.md](UNIVERSE.md).
- Se o arquivo tiver erro, o bot mantém o catálogo anterior e o `legion doctor` mostra o erro (check `cerebro.powers`) com item e campo.
- Tirar um poder do arquivo não apaga a escolha de quem já o tem: a ficha mostra o `id`.
