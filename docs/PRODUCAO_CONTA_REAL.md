# INVCRIPTO IA - checklist de produção para conta real

Este documento registra o que precisa estar configurado antes de usar o ambiente real.

## 1. Supabase

Execute os arquivos SQL nesta ordem:

1. `supabase/schema.sql`
2. `supabase/02_promover_admin.sql`
3. `supabase/03_real_trading_safety_schema.sql`

O terceiro arquivo cria:

- `real_orders`: auditoria de solicitações e retornos relacionados ao ambiente real.
- `bot_risk_settings`: trava de risco por usuário.
- `real_trading_safety`: configuração global com live desativado por padrão.
- lista atualizada dos 12 pares USDT aceitos pelo painel.

## 2. Netlify Environment Variables

Configure no Netlify, em Site settings > Environment variables:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APP_ENCRYPTION_KEY=
VITE_APP_URL=https://invcripto.netlify.app
VITE_PASSWORD_RESET_URL=https://invcripto.netlify.app/reset-password
VITE_DEFAULT_PAPER_BALANCE_USD=1000
BOT_ALLOWED_SYMBOLS=BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,ADAUSDT,AVAXUSDT,DOGEUSDT,LINKUSDT,DOTUSDT,LTCUSDT,TRXUSDT
BOT_DEFAULT_SYMBOL=BTCUSDT
BOT_QUOTE_ASSET=USDT
BOT_MAX_ORDER_USDT=15
BOT_MAX_DAILY_LOSS_USDT=25
BOT_REQUIRE_MANUAL_LIVE_CONFIRM=true
BOT_LIVE_TRADING_ENABLED=false
ENV_INITIAL_BALANCE=10
ENV_FEE_PERCENT=10
ENV_CURRENCY_USD_VALUE=1
PAYMENT_CONVERT_BRL_TO_USD=true
APP_ENV=production
APP_URL=https://invcripto.netlify.app
```

`APP_ENCRYPTION_KEY` precisa ser forte, com 32 ou mais caracteres. Se trocar essa chave depois de salvar APIs, será necessário salvar as APIs novamente.

## 3. API da corretora

Para segurança operacional:

- habilitar leitura;
- habilitar Spot Trading apenas quando for operar;
- manter saque desativado;
- usar IP permitido quando a corretora exigir whitelist;
- começar por valores pequenos;
- validar primeiro em ambiente de teste.

## 4. Estado atual do projeto

O projeto já possui:

- validação e salvamento criptografado da API;
- leitura de saldo USDT;
- painel com modo Demo e Real Spot;
- gráfico com candles e ticker;
- motor de decisão paper trade;
- schema de segurança para auditoria e travas.

A execução automática real deve permanecer bloqueada até concluir validação final de risco, logs e ordens em ambiente de teste.

## 5. Regras de segurança recomendadas

- `live_enabled=false` por padrão em `bot_risk_settings`.
- `max_order_usdt=15` para primeira etapa.
- `max_open_positions=1` enquanto estiver em validação.
- `max_daily_loss_usdt=25` na primeira etapa.
- nunca operar com chave com permissão de saque.

## 6. Teste obrigatório antes de liberar real

1. Criar usuário real pelo painel.
2. Promover admin.
3. Inserir API em ambiente de teste.
4. Validar saldo e permissão.
5. Conferir se o par selecionado está na lista permitida.
6. Conferir se o painel não usa fallback sintético para tomada de decisão real.
7. Conferir logs no Supabase.
8. Só depois habilitar manualmente o modo real por usuário.
