# INVCRIPTO Connector Local

O conector local permite manter o painel web no Netlify e usar o IP da sua própria máquina para consultar a Binance.

## Como funciona

1. O cliente acessa o painel web normalmente.
2. O painel grava comandos no Supabase.
3. Este conector roda na sua máquina.
4. O conector lê comandos pendentes no Supabase.
5. A chamada para Binance sai pela internet da sua máquina.
6. O resultado volta para o Supabase.
7. O painel mostra o status para o cliente.

## Instalação

Dentro da pasta `local-connector`:

```bash
npm install
copy .env.example .env
npm start
```

Preencha o `.env` com os dados reais do Supabase e a mesma chave de criptografia usada no Netlify.

## Segurança

- Não publique o arquivo `.env`.
- Não use chave Binance com saque habilitado.
- A máquina precisa ficar ligada para o robô operar.
- O painel web continua funcionando mesmo com o conector offline, mas não executa ações Binance.

## Próxima evolução

Depois de validar local, este mesmo conector pode ser levado para uma VPS com IP fixo.
