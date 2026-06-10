# INV CRIPTO IA

Plataforma web para robô Binance Spot BTC/ETH com login Supabase, CPF único, telefone obrigatório, carteira INV, painel cliente, painel administrador e modo Paper Trade com gráfico real.

## Configuração rápida

1. Crie/abra o projeto Supabase `pxczyddzqagzijsipche`.
2. No Supabase SQL Editor, execute:
   - `supabase/schema.sql`
3. Cadastre seu usuário pelo site.
4. No Supabase SQL Editor, execute:
   - `supabase/02_promover_admin.sql`
5. Configure o Netlify usando `NETLIFY_ENV_VARIAVEIS.txt`.
6. Suba para GitHub e conecte no Netlify.

## Build Netlify

```bash
npm install
npm run build
```

Publish directory:

```text
dist
```

## Cadastro obrigatório

O cadastro exige:

- Nome completo
- CPF único
- Telefone obrigatório
- E-mail
- Senha

## Painel admin

O painel admin permite:

- Ver clientes
- Ver CPF mascarado
- Ver telefone
- Adicionar INV manualmente
- Bloquear usuário
- Desbloquear usuário

Ao bloquear um usuário, os robôs dele são pausados automaticamente.
