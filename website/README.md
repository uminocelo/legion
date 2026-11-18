# Site do Legion

Publicado em https://uminocelo.github.io/legion/ pelo workflow `.github/workflows/pages.yml` a cada mudança em `website/`, nos pacotes (`packages/**`, que os editores usam para validar) ou no `legion.config.example.yaml`.

## Estrutura

| Caminho | O que é |
|---|---|
| `src/*.html`, `src/bots/*.html` | Corpo de cada página. O cabeçalho e o rodapé vêm do layout em `scripts/build.mjs` |
| `style.css`, `assets/` | Estilo, fontes (Oswald e Noto Sans, licença OFL), ícone e a ficha de exemplo |
| `data/commands.json` | Comandos de cada bot, **gerados** das definições dos bots |
| `scripts/build.mjs` | Monta o site em `dist/` |
| `scripts/commands.mjs` | Gera `data/commands.json` |
| `editor/*.ts` | Editores de missões, trivia e inimigos. Validam com o código dos próprios bots (`domain/*.ts`), empacotado pelo esbuild em `dist/assets/js/` |
| `editor/core-shim.ts` | Substitui `@legion/core` no navegador: só o filtro de nomes (lista embutida) e as mensagens de erro |
| `test/site.test.ts` | Confere páginas, links e se `commands.json` está atualizado |
| `test/editors.test.ts` | Arquivos dos editores passam nos comandos de importar; as missões, perguntas e inimigos prontos abrem e salvam sem mudar |

Marcadores nos fragmentos: `{{player}}` e `{{staff}}` (tabelas de comandos do bot da página), `{{config}}` (bloco do bot no `legion.config.example.yaml`), `{{doc:docs/X.md}}` (link para o GitHub) e `{{example:exemplos/...}}` (arquivo de exemplo copiado dos bots).

## Comandos

```bash
pnpm site:build              # monta website/dist; os editores precisam de um servidor:
                             # cd website/dist && python3 -m http.server
pnpm build && pnpm site:commands   # depois de mudar um comando de bot
pnpm site:check              # falha se data/commands.json estiver desatualizado
```

Mudou um comando e esqueceu de gerar de novo? `pnpm test` falha em `website/test/site.test.ts` e diz o que rodar.

## Regras

- Sem chamadas externas: nada de CDN, fontes ou scripts de fora. Os editores não enviam nada; o rascunho fica no `localStorage`.
- Os editores só importam módulos sem Node (`domain/*.ts`, `canon-filter.ts`, `content-issues.ts`); um teste confere o pacote.
- Funciona com 375 px de largura.
- A ficha de exemplo (`assets/ficha-exemplo.png`) é gerada pelo `card.ts` do Cérebro; se o visual mudar, gere de novo.
