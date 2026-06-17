# INVCRIPTO Connector Local 1.1

O conector mantém o painel no Netlify e executa ordens Spot usando a conexão e o IP do computador do usuário.

## O que esta versão faz

1. Lê comandos pendentes no Supabase.
2. Consulta conta, saldo e filtros do par na Binance.
3. Cria uma cesta persistente identificada por `basket_id`.
4. Envia compra inicial de US$ 10.
5. Posiciona uma venda limite GTC com meta de 0,5% líquido estimado.
6. Posiciona a próxima compra de proteção e uma venda pendente da nova mão por OPO/OTO.
7. Ao reiniciar, consulta as ordens reais, recompõe a cesta, consolida a venda e cria a próxima proteção.

## Proteção de saldo manual

O conector soma somente ordens ligadas ao `basket_id`. Ele nunca usa todo o saldo de BTC, ETH ou outra moeda como se pertencesse ao robô. O saldo livre é usado apenas como teto para a quantidade rastreada, cobrindo comissões debitadas no ativo-base.

## Antes de iniciar

Execute no Supabase:

```text
supabase/12_cestas_offline_binance.sql
```

Configure `.env` a partir de `.env.example` e use:

```bat
INSTALAR_E_EXECUTAR_CONNECTOR.bat
```

O conector usa apenas recursos nativos do Node.js e não precisa instalar dependências externas.

## Segurança

- Não publique o `.env`.
- Mantenha saque desativado na API Binance.
- Valide primeiro em testnet.
- Ordens aceitas pela Binance continuam ativas sem o painel, mas o computador precisa voltar a ficar online para consolidar a cesta e posicionar etapas futuras.

## V1.5 — Confirmação multitemporal

O conector agora revalida M1, M5, M15, H1 e H4 imediatamente antes de cada entrada real. As proteções usam suportes estruturais e podem ser pausadas em baixa forte. Preserve seu `.env` ao substituir o conector.
