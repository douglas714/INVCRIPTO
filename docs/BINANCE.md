# Binance

## Permissões recomendadas para API do cliente

- Leitura: obrigatório.
- Spot trading: obrigatório para operar real.
- Saque: nunca permitir.
- IP whitelist: recomendado quando usarmos servidor fixo.

## Símbolos permitidos

- BTCUSDT
- ETHUSDT

## Modos

- Paper: não envia ordem real.
- Testnet: usa ambiente de teste.
- Live: envia ordens reais Spot.

## Aviso

No Spot não existe venda descoberta sem margem/futuros. A estratégia deve comprar/vender o ativo possuído, usando DCA/basket e micro lucro.
