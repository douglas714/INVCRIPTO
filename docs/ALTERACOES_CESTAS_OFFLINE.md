# INVCRIPTO 1.1 — cestas persistentes e ordens na Binance

Esta versão preserva o layout do painel e altera somente o motor operacional.

## Regras aplicadas

- Entrada inicial real fixa em **US$ 10**.
- Meta de **0,5% líquido por cesta**, acrescentando margem para comissão e slippage.
- Orçamento de cada cesta dividido em **80% para recuperação normal** e **20% para reserva extraordinária**.
- Distância da proteção medida desde a última compra executada:
  - Conservador: 1,00%, uma moeda.
  - Moderado: 0,50%, uma moeda.
  - Arrojado: 0,30%, uma moeda.
  - Alavancagem: 0,15%, até cinco moedas.
- Tamanho da nova mão cresce dinamicamente em 1,35x, limitado pelo orçamento da cesta e pelos mínimos da Binance.
- A reserva extraordinária usa espaçamento três vezes maior e só começa quando a parcela normal não comporta outra ordem mínima.

## Operação offline

Ao abrir uma cesta, o conector envia diretamente para a Binance:

1. compra inicial a mercado;
2. venda limite GTC da cesta;
3. próxima compra limite de proteção;
4. venda limite pendente da nova mão usando lista OPO; se indisponível, tenta OTO com quantidade conservadora.

As ordens já aceitas ficam na Binance. Quando o conector volta, ele consulta ordens e execuções, consolida a quantidade pertencente à cesta em uma nova venda e posiciona a proteção seguinte.

## Separação de saldo

Cada cesta recebe um `basket_id`. O conector calcula a posição usando somente as compras e vendas ligadas a esse identificador. O saldo global da moeda nunca é usado como quantidade da cesta; o saldo livre serve apenas como teto para descontar comissão cobrada no ativo-base.

## Instalação obrigatória

Execute no Supabase SQL Editor:

```text
supabase/12_cestas_offline_binance.sql
```

Depois publique o site atualizado e substitua o conector local pela versão incluída em `public/downloads/ENVCRIPTO_CONNECTOR_LOCAL.zip`.

## Limitação operacional importante

Se a venda principal for executada enquanto o conector estiver totalmente offline, a compra de proteção já posicionada continua na Binance até o conector retornar e conciliá-la. A venda pendente ligada à proteção evita moeda sem ordem de saída caso essa compra também execute durante a indisponibilidade.
