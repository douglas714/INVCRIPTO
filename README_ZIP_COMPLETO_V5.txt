INVCRIPTO IA v5 COMPLETO PREMIUM FIX

Esta versão foi gerada usando o ZIP premium original como base, mantendo todos os arquivos do projeto:
- dist completo para deploy rápido no Netlify sem npm install
- src original
- public original
- docs
- supabase SQL
- netlify/functions
- netlify.toml

Correções aplicadas no deploy estático:
1. Tela branca corrigida sem quebrar o layout premium.
2. Layout verde/dourado restaurado usando o CSS premium original.
3. Gráfico Binance Spot em Canvas nativo com REST + WebSocket.
4. Escala do gráfico corrigida por candles visíveis.
5. Eixo de preço à direita corrigido.
6. Suporte/resistência calculados por símbolo/timeframe e candles visíveis.
7. Timeframes 1m, 5m, 15m, 1h, 4h, 1d funcionando.
8. Arrastar/zoom/LIVE funcionando.
9. Card Saldo ENV com botão Adicionar saldo.
10. Aba Créditos ENV completa.
11. Painel admin demo mantido.

Deploy Netlify:
- O netlify.toml publica direto a pasta dist.
- Não precisa npm install.
- Depois de subir, use Clear cache and deploy site.

Supabase:
- Preencha somente a anon public key em dist/assets/config.js.
- Nunca coloque service_role no frontend.
