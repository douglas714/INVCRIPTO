# INVCRIPTO IA

Plataforma web para robô de cripto com layout premium verde/dourado, painel cliente, painel administrador, Supabase Auth, créditos INV, modo Paper Trade e scanner IA.

## Novidades desta versão

- Logo INVCRIPTO aplicada no painel.
- Favicon configurado em PNG/ICO.
- Layout premium baseado na paleta verde escuro + dourado.
- Dashboard com gráfico real, suporte/resistência, trading control e cards de análise.
- Radar IA com moedas fortes: BTC, ETH, BNB, SOL, XRP, ADA, AVAX, DOGE, LINK, DOT, LTC e TRX.
- Cliente pode seguir a recomendação da IA ou escolher manualmente a moeda.
- Mantém Supabase, CPF/telefone obrigatório, admin com bloqueio de usuário e créditos INV.

## Instalação

```bash
npm install
npm run dev
```

## Build Netlify

```text
Build command: npm run build
Publish directory: dist
```

## Supabase

Execute no Supabase SQL Editor:

```text
supabase/schema.sql
```

Depois cadastre seu usuário e rode:

```text
supabase/02_promover_admin.sql
```

## Variáveis de ambiente

Use `.env.example` apenas como modelo. Não suba chaves reais para o GitHub.
Cadastre as chaves reais no Netlify em `Site settings > Environment variables`.


## Atualização USDT/ENV

- O robô opera pares contra USDT.
- Ao conectar a API Binance, o backend deve consultar e exibir o saldo USDT disponível.
- O painel usa dólar/USDT para saldo, lucro e taxa.
- Créditos ENV: 1 ENV = US$ 1,00.
- Pagamentos em BRL devem converter para ENV pela cotação do dólar/USDT no momento da confirmação.
- Gráfico nativo SVG corrigido com candles visíveis, sem dependência externa.

## Atualização V1.4 — suporte em toda a cesta

- Entrada real limitada à zona de suporte; não compra acima do teto calculado.
- Proteções usam o percentual do perfil somente como distância mínima e procuram suporte abaixo.
- Reposicionamento automático de proteção antiga para suporte mais baixo.
- Mesmos níveis de suporte e resistência no gráfico e no motor.
- Bloqueio por resistência e janela de confirmação de vela esticada no suporte.

## Atualização V1.5 — Estratégia MTF-R

A conta real agora exige confirmação de H4, H1, M15, M5 e M1. O radar analisa cada ativo individualmente, a entrada é limitada ao suporte estrutural e as proteções procuram suportes H1/M15 ou H4/H1 antes de serem posicionadas. Consulte `LEIA_PRIMEIRO_ESTRATEGIA_MTF_V1_5.txt`.
