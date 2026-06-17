# INVCRIPTO V1.3 — Prioridade de suporte e bloqueio de resistência

## Objetivo

Corrigir entradas compradas que aconteciam próximas da resistência e reconhecer varreduras fortes de queda que tocam o suporte e reagem.

## Alterações

- O suporte e a resistência são calculados sem os dois candles usados para confirmar o sinal, evitando que a própria vela esticada mova o nível que está sendo testado.
- Novo setup `SUPPORT_BOUNCE` para:
  - rejeição no próprio candle com pavio inferior;
  - candle de queda esticado que toca o suporte seguido de candle comprador de recuperação;
  - recuperação de RSI, volume ou expansão de volume no toque.
- O sinal só é aceito quando a estrutura maior não está em tendência forte de baixa.
- A compra perto da resistência é bloqueada quando não existe espaço para o alvo líquido de 0,5%, taxas, slippage e margem de volatilidade.
- Pullbacks só são aceitos na metade inferior da faixa entre suporte e resistência.
- Rompimentos não são mais comprados na primeira esticada; exigem rompimento e reteste confirmado.
- O gráfico mostra a linha `ENTRADA SUPORTE` quando um setup de suporte for confirmado.
- Layout, cores, menus e organização do painel foram preservados.

## Testes incluídos

Execute:

```bash
npm run test:strategy
```

Os testes validam:

1. queda esticada no suporte + recuperação;
2. rejeição com pavio no suporte;
3. bloqueio durante tendência forte de baixa;
4. bloqueio de entrada próxima da resistência.
