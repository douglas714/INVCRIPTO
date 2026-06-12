INVCRIPTO CONNECTOR LOCAL - INSTALACAO FACIL

Para que serve:
Este conector roda no seu Windows e consulta a Binance usando o IP da sua maquina.
Ele resolve o bloqueio da Binance contra o IP da Netlify.

Caminho mais simples:

1. Clique em:
   INSTALAR_E_EXECUTAR_CONNECTOR.bat

2. Na primeira vez, ele pede:
   SUPABASE_SERVICE_ROLE_KEY
   APP_ENCRYPTION_KEY

3. Depois ele salva tudo no .env, instala dependencias e inicia sozinho.

4. Nas proximas vezes, basta clicar no mesmo arquivo:
   INSTALAR_E_EXECUTAR_CONNECTOR.bat

Ordem manual:

1. No Supabase SQL Editor, rode:
   supabase/05_local_connector_schema.sql

2. Abra a pasta local-connector.

3. Clique em:
   CONFIGURAR_CONNECTOR.bat

4. Preencha:
   SUPABASE_SERVICE_ROLE_KEY
   APP_ENCRYPTION_KEY

   SUPABASE_URL ja fica preenchido:
   https://pxczyddzqagzijsipche.supabase.co

   Importante: APP_ENCRYPTION_KEY deve ser exatamente a mesma usada no Netlify.
   O conector nao pede API da Binance. As APIs da Binance sao salvas pelo painel do site.

5. Clique em:
   INSTALAR_WINDOWS.bat

6. Clique em:
   INICIAR_CONNECTOR.bat

7. Deixe a janela aberta.

Como testar:
- Entre no painel do site.
- Aba API Binance.
- Clique em "Atualizar saldo na Binance".
- O conector deve ler a ordem no Supabase, consultar a Binance e atualizar o saldo real.

Seguranca:
- Nao envie o arquivo .env para ninguem.
- Nao habilite saque na API da Binance.
- Para operar 24h, deixe este conector rodando numa maquina ligada ou VPS.
