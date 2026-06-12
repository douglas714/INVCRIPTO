# INVCRIPTO Connector Local

O conector local permite manter o painel web no Netlify e usar o IP da sua propria maquina para consultar e operar na Binance.

## Como funciona

1. O cliente acessa o painel web.
2. O painel grava comandos no Supabase.
3. Este conector roda no Windows.
4. O conector le comandos pendentes no Supabase.
5. A chamada para Binance sai pela internet da sua maquina.
6. O resultado volta para o Supabase.
7. O painel mostra saldo, status e ordens.

## Como iniciar

Use:

```bat
INSTALAR_E_EXECUTAR_CONNECTOR.bat
```

O BAT nao executa `npm install` e nao precisa de `node_modules`. O conector usa apenas recursos nativos do Node.js. Isso evita erro de certificado como `SELF_SIGNED_CERT_IN_CHAIN`.

## Seguranca

- Nao publique o arquivo `.env`.
- Nao use chave Binance com saque habilitado.
- A maquina precisa ficar ligada para executar comandos Binance.
- A venda protegida fica salva na Binance depois que a compra real executa.
