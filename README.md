# INV CRIPTO IA — Plataforma Web + Paper Trade + INV

Estrutura inicial para o robô web Binance com Supabase, Netlify e GitHub.

## Módulos incluídos

- Login/cadastro via Supabase Auth.
- Cadastro com CPF único usando `cpf_hash`.
- Painel cliente.
- Painel administrador.
- Carteira INV: 1 INV = R$ 1,00.
- Crédito inicial de 10 INV.
- Cobrança futura: 10% sobre lucro líquido realizado.
- Paper trade usando gráfico real de BTC/USDT e ETH/USDT.
- Estrutura para Binance API Spot/Testnet/Real.
- Estrutura futura para Pix e webhooks.

## Como rodar local

```bash
npm install
npm run dev
```

## Como publicar no Netlify

Build command:

```bash
npm run build
```

Publish directory:

```text
dist
```

Configure as variáveis de ambiente do `.env.example` no Netlify.

## Supabase

Rode no SQL Editor:

```text
supabase/schema.sql
```

Depois ative Auth com e-mail/senha no Supabase.

## Importante

Este MVP inclui paper trade e estrutura. O módulo real de ordens Binance deve rodar em backend/worker 24h, não somente no navegador. Netlify Functions são boas para APIs e webhooks, mas robô contínuo deve rodar em VPS/Render/Railway/Fly.io ou Supabase Edge Functions com scheduler, respeitando limites.

Nunca peça permissão de saque nas chaves Binance dos clientes.
