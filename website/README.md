# Site do Legion

Publicado em https://uminocelo.github.io/legion/ pelo workflow `.github/workflows/pages.yml` a cada mudança em `website/`, no conteúdo dos bots (`packages/*/content/`) ou no `legion.config.example.yaml`.

## Estrutura

| Caminho | O que é |
|---|---|
| `src/*.html`, `src/bots/*.html` | Corpo de cada página. O cabeçalho e o rodapé vêm do layout em `scripts/build.mjs` |
| `style.css`, `assets/` | Estilo, fontes (Oswald e Noto Sans, licença OFL), ícone e a ficha de exemplo |
| `data/commands.json` | Comandos de cada bot, **gerados** das definições dos bots |
| `scripts/build.mjs` | Monta o site em `dist/` |
| `scripts/commands.mjs` | Gera `data/commands.json` |
| `test/site.test.ts` | Confere páginas, links e se `commands.json` está atualizado |

Marcadores nos fragmentos: `{{player}}` e `{{staff}}` (tabelas de comandos do bot da página), `{{config}}` (bloco do bot no `legion.config.example.yaml`), `{{doc:docs/X.md}}` (link para o GitHub) e `{{example:exemplos/...}}` (arquivo de exemplo copiado dos bots).

## Comandos

```bash
pnpm site:build              # monta website/dist (abra dist/index.html)
pnpm build && pnpm site:commands   # depois de mudar um comando de bot
pnpm site:check              # falha se data/commands.json estiver desatualizado
```

Mudou um comando e esqueceu de gerar de novo? `pnpm test` falha em `website/test/site.test.ts` e diz o que rodar.

## Regras

- Sem chamadas externas: nada de CDN, fontes ou scripts de fora.
- Funciona com 375 px de largura.
- A ficha de exemplo (`assets/ficha-exemplo.png`) é gerada pelo `card.ts` do Cérebro; se o visual mudar, gere de novo.
