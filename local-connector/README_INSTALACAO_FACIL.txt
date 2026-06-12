INVCRIPTO CONNECTOR LOCAL - INSTALACAO FACIL

Para que serve:
Este conector roda no seu Windows e consulta/opera na Binance usando o IP da sua maquina.
Ele resolve o bloqueio da Binance contra o IP da Netlify.

Caminho mais simples:

1. Clique em:
   INSTALAR_E_EXECUTAR_CONNECTOR.bat

2. Na primeira vez, ele cria ou verifica o .env.

3. Ele NAO baixa dependencias pelo npm.
   Isso evita o erro SELF_SIGNED_CERT_IN_CHAIN.

4. Deixe a janela aberta.

Se aparecer "Dependencias nao encontradas":
- Use o zip completo do projeto, porque ele ja tem o node_modules do projeto principal.
- Ou rode npm install apenas na pasta principal do projeto quando sua rede permitir.

Como testar:
- Entre no painel do site.
- Aba API Binance.
- Clique em "Atualizar saldo na Binance".
- O conector deve ler a ordem no Supabase, consultar a Binance e atualizar o saldo real.

Operacao real protegida:
- Quando o painel enviar uma compra protegida real, o conector compra Spot e cria uma venda LIMIT GTC na Binance logo depois.
- Essa venda fica salva na Binance mesmo se o computador ou internet cair depois da criacao da ordem.

Seguranca:
- Nao envie o arquivo .env para ninguem.
- Nao habilite saque na API da Binance.
- Para operar 24h, deixe este conector rodando numa maquina ligada ou VPS.
