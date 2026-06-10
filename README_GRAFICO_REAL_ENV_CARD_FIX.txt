INVCRIPTO IA - Gráfico escala real + Card ENV

Correções:
- Corrigido gráfico achatado/desconfigurado por mistura de candles/preços fora de escala.
- Candles são limpos ao trocar moeda/timeframe.
- WebSocket valida o símbolo antes de atualizar o preço.
- Suporte/resistência recalculados somente com candles válidos.
- Incluído card de Saldo ENV no topo do painel.
- Card ENV tem botão "Adicionar saldo" que abre a aba Créditos ENV.
- Aba Créditos ENV tem opções de recarga 10/25/50/100 ENV e botão Adicionar saldo para teste.
- Função admin-credit-inv sem dependência externa, usando fetch nativo.
- Deploy estático sem npm install no Netlify.

Netlify:
Build command: echo Deploy estatico INVCRIPTO IA - sem npm install
Publish directory: dist
