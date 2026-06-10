# Arquitetura do INV CRIPTO IA

## Ambientes

1. **Paper Trade interno**: usa candles reais da Binance, mas cria ordens simuladas no Supabase/localStorage.
2. **Binance Spot Testnet**: usa ambiente de teste da Binance para validar ordens API.
3. **Binance Spot Real**: usa API real do cliente, somente BTC/USDT e ETH/USDT.

## Fluxo do cliente

Cadastro → CPF único → Painel → Configura API Binance → Ganha 10 INV → Inicia robô → Lucro realizado → cobra 10% em INV → Se INV zerar, pausa robô e solicita recarga.

## Painéis

### Cliente

- Dashboard com status do robô.
- Espelho do gráfico real.
- Análise ao vivo.
- Ordens simuladas/reais.
- INV e cobranças.
- Configurações Binance.

### Admin

- Lista de clientes.
- Saldo INV.
- Ajuste manual de saldo.
- Pagamentos.
- Logs e auditoria.
- Status dos robôs.

## Estratégia Paper/Spot MVP

- BTC/USDT e ETH/USDT.
- Sem futuros e sem margem no início.
- Spot basket: compras em pontos planejados, preço médio e venda com micro lucro.
- Sinais baseados em EMA, suporte/resistência, volatilidade e candles.

## INV

- 1 INV = R$ 1,00.
- Saldo inicial: 10 INV.
- Taxa: 10% sobre lucro líquido realizado.
- Se saldo INV = 0: robô pausa e bloqueia novas operações.
