# INVCRIPTO IA v6 — Base login/cadastro funcionando + gráfico/ENV

Esta versão foi gerada usando como base o ZIP `INV_CRIPTO_IA_LOGIN_CADASTRO_FIX(1).zip`, que era a modificação funcional de login/cadastro e layout premium.

Correções aplicadas sem remover a estrutura original:

- Mantido layout premium verde/dourado, logo e favicon.
- Mantidos `src`, `dist`, `public`, `docs`, `supabase`, `netlify/functions` e arquivos de deploy.
- Card de saldo ENV no dashboard com botão **Adicionar saldo**.
- Aba Créditos ENV com botão **Adicionar saldo**.
- Gráfico com escala mais segura, padding automático e eixo de preço.
- Suporte/resistência recalculados por símbolo/timeframe usando swings próximos do preço, evitando níveis absurdos muito antigos.
- Timeframes preservados: 1m, 5m, 15m, 1h, 4h, 1d.
- Arrastar/zoom/LIVE preservados.
- WebSocket Binance Spot incluído no `src` para atualização em tempo real quando houver rebuild.
- `dist` recebeu hotfix JS/CSS para manter ENV e fallback visual mesmo no deploy estático.
- `netlify.toml` configurado para publicar direto `dist`, sem rodar `npm install && npm run build`.

Deploy recomendado no Netlify:

1. Substitua todos os arquivos do repositório por esta versão.
2. Faça commit/push no GitHub.
3. No Netlify, use **Clear cache and deploy site**.
4. Configure as variáveis do Supabase no Netlify.

Observação: se quiser usar rebuild via Vite no futuro, restaure o comando de build para `npm install --no-audit --no-fund && npm run build`.
