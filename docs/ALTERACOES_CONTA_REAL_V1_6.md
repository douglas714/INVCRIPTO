# INVCRIPTO V1.6 — Conta real resiliente

## Falso alerta de saque

O campo `canWithdraw` retornado por `/api/v3/account` não é mais usado como permissão da chave API. A liberação operacional considera autenticação, conta Spot e `canTrade`. A conferência de saque continua sendo uma etapa manual de segurança no painel da Binance.

## Resiliência

- timeout e novas tentativas em leituras;
- backoff exponencial em indisponibilidade;
- sincronização de horário da Binance;
- reconciliação por `clientOrderId` após resposta incerta;
- ciclo somente marcado como completo quando sincronização de credencial, cestas e vendas termina;
- log local persistente;
- versão e diretório exibidos no console.

## Conta real

O robô permanece pausado ao abrir. Quando o usuário ativa o Auto Trading, o fluxo real só cria comando se a credencial estiver ativa, o conector V1.6 estiver online e a sincronização for recente.
