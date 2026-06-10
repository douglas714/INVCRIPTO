INVCRIPTO IA - Correção de deploy Netlify

Correção aplicada:
- Removida dependência lightweight-charts que estava travando no npm install.
- Gráfico substituído por gráfico nativo SVG/React, sem pacote externo.
- package-lock removido para o Netlify baixar direto do registry oficial.
- netlify.toml alterado para npm install --no-audit --no-fund && npm run build.

Após subir ao GitHub, use Clear cache and deploy site no Netlify.
