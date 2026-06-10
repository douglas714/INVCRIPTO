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
