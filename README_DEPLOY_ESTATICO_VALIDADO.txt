INVCRIPTO IA - PACOTE NETLIFY ESTATICO VALIDADO

Correção aplicada:
- A raiz do deploy não possui package.json, package-lock.json, .nvmrc ou .npmrc.
- Netlify não deve executar npm install nem npm run build.
- netlify.toml publica diretamente a pasta dist.
- O projeto fonte completo foi preservado dentro de project-source/.
- As functions usadas pelo deploy foram mantidas em netlify/functions/.

Configuração esperada no log do Netlify:
Build command: echo Deploy estatico INVCRIPTO IA - usando dist precompilado
Publish directory: dist

Validação local realizada:
- dist/index.html existe.
- assets JS/CSS referenciados no dist/index.html existem.
- CSS premium existe e contém classes premium/auth/dashboard.
- netlify.toml não contém npm install nem npm run build.
- raiz do pacote não contém package.json/package-lock.json/.nvmrc/.npmrc.
- projeto completo preservado em project-source/.

Após subir no GitHub:
Netlify > Deploys > Trigger deploy > Clear cache and deploy site.
