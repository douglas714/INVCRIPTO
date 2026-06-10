INVCRIPTO IA - Correção gráfico escala real

Correções aplicadas:
- limpa candles ao trocar moeda/timeframe para evitar misturar ETH/BTC/SOL no mesmo gráfico;
- valida símbolo recebido pelo WebSocket da Binance antes de atualizar o candle;
- ignora preços fora da escala atual para não achatar os candles;
- corrige ticker 24h usando preço correto (c/p/a/b);
- reescala o gráfico com padding e remove outliers visuais;
- mantém deploy estático sem npm install no Netlify.

No Netlify:
Build command: echo Deploy estatico INVCRIPTO IA - sem npm install
Publish directory: dist
