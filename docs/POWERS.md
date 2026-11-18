# Poderes

No cadastro, cada membro escolhe **1 poder principal** e até **2 secundários** de um catálogo. O tipo do poder principal define o **arquétipo** (e com ele os atributos base). Os poderes aparecem na ficha (`/perfil`) e no cartão; **não têm efeito numérico** além do arquétipo, então o equilíbrio do jogo não muda. O campo livre "Descreva seu poder" continua: é onde o membro conta, com as palavras dele, como o poder funciona.

## Ordem do cadastro

Regras → facção → **poder principal** (o arquétipo aparece na hora) → **secundários** (opcional) → ficha com codinome, descrição e origem.

O catálogo tem mais de 25 poderes, o limite de um menu do Discord, então os poderes vêm em dois menus, agrupados por tipo.

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

## Mutantes registrados antes

Quem já tinha ficha usa `/mutante poderes` **uma vez** para escolher os poderes. O arquétipo continua o mesmo, a não ser que a staff ligue `cerebro.powers.allowArchetypeChange`.

## Acrescentar ou trocar poderes

O catálogo vem em `packages/bot-cerebro/content/powers.yaml` (32 poderes). Para o seu servidor, crie `data/content/powers.yaml`: mesmo `id` substitui, `id` novo acrescenta. Reinicie o bot para carregar.

```yaml
- id: rajada-de-chi        # letras minúsculas, números e "-"
  type: offensive
  name: { pt-BR: "Rajada de chi", en: "Chi blast" }
  description: { pt-BR: "Concentra energia vital num golpe.", en: "Focuses life energy into a strike." }
```

- `name` até 60 caracteres, `description` até 100. `en` é opcional.
- Nomes de personagens existentes são recusados: use nomes genéricos de poderes. Veja [UNIVERSE.md](UNIVERSE.md).
- Se o arquivo tiver erro, o bot mantém o catálogo anterior e o `legion doctor` mostra o erro (check `cerebro.powers`) com item e campo.
- Tirar um poder do arquivo não apaga a escolha de quem já o tem: a ficha mostra o `id`.
