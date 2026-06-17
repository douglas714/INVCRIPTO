# INVCRIPTO IA 1.1 — checklist de produção

## 1. Banco de dados

Em um projeto já configurado, execute obrigatoriamente no Supabase SQL Editor:

```text
supabase/12_cestas_offline_binance.sql
```

O script cria `real_baskets`, liga ordens a `basket_id` e amplia os tipos de proteção. Sem essa migração, o conector bloqueia a criação segura de cestas.

## 2. Netlify

Configure as variáveis do `.env.example`, incluindo URL/chaves Supabase e `APP_ENCRYPTION_KEY` forte. Nunca coloque a Service Role no frontend.

## 3. Conector local

- Substitua o pacote antigo pelo `ENVCRIPTO_CONNECTOR_LOCAL.zip` desta versão.
- Mantenha a mesma `APP_ENCRYPTION_KEY` usada para criptografar as APIs.
- Confirme no painel do conector que leitura e Spot Trading estão habilitados e saque está desativado.

## 4. Validação obrigatória

1. Publicar o painel e executar a migração 12.
2. Instalar o novo conector.
3. Validar API em testnet.
4. Abrir uma cesta de US$ 10.
5. Conferir na Binance a compra, a venda GTC e a lista OPO/OTO de proteção.
6. Encerrar o painel e confirmar que as ordens permanecem na Binance.
7. Reiniciar o conector e conferir a reconciliação no Supabase.
8. Verificar que moedas compradas manualmente não foram incluídas na venda da cesta.
9. Somente depois repetir com valor mínimo em ambiente real.

## 5. Regras implantadas

- 0,5% líquido estimado por cesta.
- 80% recuperação normal e 20% reserva extraordinária.
- Conservador 1,00%; Moderado 0,50%; Arrojado 0,30%; Alavancagem 0,15%.
- Conservador, Moderado e Arrojado: uma moeda.
- Alavancagem: até cinco moedas, com capital dividido por cinco reservas de cesta.
- Inicialização sempre pausada.
