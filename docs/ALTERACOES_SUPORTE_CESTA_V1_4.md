# INVCRIPTO V1.4 — suporte em toda a cesta

## Entrada inicial

A ordem inicial de US$ 10 deixou de perseguir o preço por `MARKET`. O conector revalida candles fechados, suporte, reação, resistência e preço atual. A compra é enviada como `LIMIT FOK` limitada ao teto da zona de suporte. Se não houver execução completa dentro desse teto, a ordem é encerrada sem abrir a cesta.

## Proteções

Os intervalos de 1%, 0,5%, 0,3% e 0,15% são gatilhos mínimos. O preço definitivo da proteção é o próximo suporte estrutural abaixo do gatilho. O conector usa pivôs, rejeições recentes, ATR, volume e recência para formar zonas de suporte.

Uma ordem aberta pode ser reposicionada somente para baixo quando surgir suporte inferior. Ordens parcialmente executadas nunca são reposicionadas.

## Resistência

A entrada é bloqueada quando não existe espaço para o alvo líquido de 0,5%, taxas e margem de volatilidade antes da resistência.

## Gráfico

O gráfico e a estratégia usam o mesmo nível calculado. Ordens abertas continuam como linhas; compras preenchidas são mostradas como marcadores no candle correspondente, reduzindo a impressão de que compras antigas ainda estão posicionadas.
