# INVCRIPTO IA - versão v3 white-screen fix

Versão estática para deploy rápido no Netlify, sem `npm install`.

## Correções desta versão

- Corrige tela branca: o login aparece por padrão antes de qualquer script/API externa.
- Remove dependência obrigatória do CDN do gráfico; existe gráfico nativo em Canvas embutido no `app.js`.
- Supabase JS passa a carregar sob demanda, sem bloquear a abertura da página.
- Boot protegido com fallback visual se algum erro de JavaScript acontecer.
- Candles Binance Spot via REST + WebSocket mantidos.
- Timeframes: 1m, 5m, 15m, 1h, 4h e 1d.
- Arrastar horizontal e zoom por scroll no gráfico nativo.
- Escala do eixo de preço recalculada com margem automática.
- Suporte e resistência recalculados por símbolo/timeframe com blindagem contra níveis absurdos de cache/símbolo anterior.
- Card de saldo ENV mantido com botão “Adicionar saldo”.
- Layout premium verde/dourado, logo e favicon mantidos.

## Deploy Netlify

O `netlify.toml` publica direto a pasta:

```toml
[build]
  publish = "dist"
  command = ""
```

Não precisa rodar `npm install`.

## Supabase

Edite o arquivo:

```text
dist/assets/config.js
```

Preencha apenas a chave pública:

```js
SUPABASE_ANON_KEY: 'SUA_ANON_PUBLIC_KEY_AQUI'
```

Nunca coloque `service_role` ou chave secreta no frontend.

## Banco de dados

Execute o SQL em:

```text
supabase/schema_invcripto.sql
```

Ele cria estrutura para CPF único, perfil, saldo ENV, recargas e funções administrativas.
