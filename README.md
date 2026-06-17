# INVCRIPTO IA 1.1

Plataforma web para operação Spot em cestas, com painel cliente/administrador, Supabase, conector local e execução direta na Binance. O layout visual desta versão foi preservado.

## Motor operacional desta versão

- Entrada inicial real fixa em **US$ 10**.
- Meta de **0,5% líquido por cesta**.
- Capital da cesta dividido em **80% recuperação normal / 20% reserva extraordinária**.
- Conservador: 1 moeda, proteção a cada 1,00%.
- Moderado: 1 moeda, proteção a cada 0,50%.
- Arrojado: 1 moeda, proteção a cada 0,30%.
- Alavancagem: até 5 moedas, proteção a cada 0,15%.
- Compra, venda GTC e próxima proteção são enviadas diretamente para a Binance.
- Reconciliação automática de saldo, ordens e cestas ao religar o conector.
- Controle por `basket_id`, sem vender saldo manual do usuário.
- Robô abre pausado; candles sintéticos não podem gerar ordem real.

Detalhes: `docs/ALTERACOES_CESTAS_OFFLINE.md`.

## Instalação

```bash
npm install
npm run dev
```

## Build Netlify

```text
Build command: npm run build
Publish directory: dist
```

## Supabase

Em uma instalação já existente, execute obrigatoriamente:

```text
supabase/12_cestas_offline_binance.sql
```

Em uma instalação nova, execute primeiro o schema e os scripts anteriores em ordem numérica, finalizando com o script 12.

## Variáveis de ambiente

Use `.env.example` apenas como modelo. Não publique chaves reais no GitHub. Cadastre os segredos no Netlify e no `.env` local do conector.
