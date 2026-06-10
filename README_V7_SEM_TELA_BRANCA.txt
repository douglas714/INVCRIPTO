INVCRIPTO IA v7 - base LOGIN_CADASTRO_FIX funcionando

Correção principal:
- A versão anterior podia ficar branca quando o Netlify/publicação servia o index.html da raiz do projeto.
- O index.html da raiz apontava para /src/main.jsx, que só funciona com Vite/npm.
- Agora a raiz do ZIP também contém o index.html de produção e a pasta /assets, então funciona tanto publicando /dist quanto publicando a raiz.

Mantido:
- Estrutura completa: src, dist, public, docs, supabase, netlify/functions, package.json e netlify.toml.
- Layout premium verde/dourado da versão funcionando.
- Login/cadastro da versão base enviada.
- Deploy rápido sem npm install.

Aplicado:
- Anti tela branca com fallback visual.
- Card de Saldo ENV e botão Adicionar saldo.
- Botão Adicionar saldo também na aba Créditos ENV.
- CSS/assets copiados para raiz e dist.
- _redirects para SPA.

No Netlify:
1. Suba o ZIP completo no GitHub ou faça deploy manual do conteúdo do ZIP.
2. Em deploy via GitHub, o netlify.toml publica dist.
3. Em deploy manual ou publish root, a raiz também já está pronta.
4. Use Clear cache and deploy site.
