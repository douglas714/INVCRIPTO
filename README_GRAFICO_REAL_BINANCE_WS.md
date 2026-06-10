# Correção gráfico real Binance

Esta versão usa candles reais da Binance Spot com:

- snapshot inicial via REST `/api/v3/klines`;
- atualização em tempo real via WebSocket Binance `@kline`, `@ticker` e `@trade`;
- atualização do candle atual a cada trade recebido;
- fallback REST a cada 60 segundos;
- cache desativado na função Netlify.

Observação: TradingView pode exibir fonte Bitstamp/Coinbase em algumas páginas públicas. O INVCRIPTO usa Binance Spot como referência operacional, por isso o preço correto para execução é o da Binance.
