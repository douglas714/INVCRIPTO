INVCRIPTO IA - DEPLOY RÁPIDO CORRIGIDO

Esta versão foi alterada para NÃO rodar npm install nem npm run build no Netlify.

Configuração incluída no netlify.toml:
- command = echo Static deploy - using precompiled dist
- publish = dist

Também foi ajustado o package.json para que, caso o Netlify tente executar npm run build por algum override antigo, o comando apenas mostre uma mensagem e não recompile o projeto.

Após subir no GitHub, use no Netlify:
Deploys > Trigger deploy > Clear cache and deploy site

Se no painel do Netlify existir Build command override manual, ele pode sobrescrever o netlify.toml. Remova esse override ou deixe igual ao comando acima.
