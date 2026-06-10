INVCRIPTO IA - Deploy rapido sem NPM

Esta versao foi criada porque o Netlify estava falhando em "Install dependencies" por timeout.

O pacote agora sobe como site estatico pre-compilado:
- Nao tem package.json
- Nao tem package-lock.json
- Nao roda npm install
- Netlify publica direto a pasta dist
- Funcoes Netlify usam fetch nativo, sem dependencias externas

Config no Netlify:
Build command: echo Deploy estatico INVCRIPTO IA - sem npm install
Publish directory: dist
Functions directory: netlify/functions

Depois de subir no GitHub, usar:
Deploys > Trigger deploy > Clear cache and deploy site

As variaveis de ambiente continuam sendo configuradas no Netlify, nao no GitHub.
