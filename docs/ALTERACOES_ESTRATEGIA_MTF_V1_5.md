# INVCRIPTO V1.5 — Estratégia MTF-R para conta real

## Objetivo

Esta versão substitui a decisão baseada apenas no M1/M5 por uma leitura hierárquica:

- H4: regime principal do mercado.
- H1: direção e força da tendência.
- M15: suporte, resistência e zona operacional.
- M5: confirmação da reação no suporte.
- M1: refinamento da execução.

O layout visual foi preservado. As mudanças ficaram no motor da estratégia, radar, funções Netlify e conector local.

## Entrada real

A compra de US$ 10 somente é liberada quando:

1. os cinco timeframes possuem candles reais e fechados;
2. H4/H1 não confirmam baixa forte;
3. M15/H1 definem um suporte estrutural;
4. M5 confirma a reação naquele suporte;
5. M1 confirma a execução;
6. existe espaço estrutural até a resistência para o alvo líquido de 0,5%;
7. o conector repete toda a análise imediatamente antes de enviar a ordem.

A ordem continua sendo LIMIT FOK com preço máximo. Se não houver execução completa dentro da zona, ela é cancelada sem perseguir o preço.

## Perfis

- Conservador: 1 moeda, proteção mínima de 1%, score mínimo 84 e mão seguinte de até 1,20x.
- Moderado: 1 moeda, proteção mínima de 0,5%, score mínimo 80 e mão seguinte de até 1,25x.
- Arrojado: 1 moeda, proteção mínima de 0,3%, score mínimo 76 e mão seguinte de até 1,30x.
- Alavancagem: até 5 moedas, proteção mínima de 0,15%, score mínimo 74 e mão seguinte de até 1,35x.

Os percentuais continuam sendo apenas a distância mínima. A compra é posicionada no próximo suporte estrutural abaixo do gatilho.

## Proteções

- Proteções normais usam principalmente suportes H1/M15.
- A reserva extraordinária usa suportes H4/H1 e exige reação confirmada no M5.
- Em baixa forte confirmada por H4/H1, novas proteções são pausadas e ordens de compra ainda abertas podem ser canceladas.
- A venda da cesta continua posicionada na Binance.
- Uma proteção nunca é movida para cima.
- Toda cesta continua limitada ao orçamento 80% normal e 20% extraordinário.

## Radar

O radar deixou de repetir a análise do ativo selecionado. Ele consulta individualmente os pares permitidos e classifica cada um com sua própria leitura M1/M5/M15/H1/H4.

## Segurança

- Dados sintéticos não liberam operação real.
- A conta real exige confirmação multitemporal tanto na Netlify quanto no conector.
- O conector continua reconciliando saldo, ordens e cestas diretamente com a Binance.
- Quantidade manual do usuário não é incorporada à cesta do robô.
