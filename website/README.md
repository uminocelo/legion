# Site do Legion

Página de apresentação do projeto: o que é, os cinco bots, como um jogador começa e como hospedar.

- **Sem build:** `index.html`, `style.css` e `assets/`. Abra `index.html` no navegador para ver.
- **Sem chamadas externas:** as fontes (Oswald e Noto Sans, licença OFL em `assets/fonts/`) vão junto.
- **Ficha de exemplo:** `assets/ficha-exemplo.png` é gerada pelo mesmo código do `/perfil` (`packages/bot-cerebro/src/card.ts`). Se o visual da ficha mudar, gere de novo.
- **Publicação:** o workflow `.github/workflows/pages.yml` publica esta pasta em https://uminocelo.github.io/legion/ a cada mudança em `website/` no `main` (ou manualmente em Actions → Pages → Run workflow).

Os links "Tutorial" e "Ver o código" apontam para o repositório no GitHub.
