# INVCRIPTO IA - Alteracoes 2026-06-15

## Atenção operacional

O código do ZIP foi preparado com foco em segurança operacional porque o projeto já está sendo usado com conta real. Mesmo assim, este pacote não adiciona envio de ordens reais se o projeto atual ainda não tiver um executor Binance real no backend. A parte alterada atua no motor de estratégia, cesta, setup de risco, cadastro e segurança de crédito INV.

Antes de subir em produção:

1. Execute `supabase/correcoes_2026_06_15.sql` no SQL Editor do Supabase.
2. Faça deploy do ZIP no Netlify/GitHub.
3. Teste cadastro com um CPF novo.
4. Teste cadastro com CPF repetido.
5. Teste login do admin Douglas.
6. Teste o robô primeiro pausado/paper antes de liberar modo real.

## Arquivos alterados

- `src/lib/riskProfiles.js`
- `src/lib/strategy.js`
- `src/lib/paperBot.js`
- `src/lib/cpf.js`
- `src/App.jsx`
- `src/components/ClientPanel.jsx`
- `src/styles.css`
- `netlify/functions/admin-credit-inv.js`
- `supabase/correcoes_2026_06_15.sql`
- `supabase/schema.sql`
- `package.json`

## Estratégia operacional adicionada

Foi criada a estratégia de perfis com cesta inteligente:

### Conservador

- Spot puro.
- Alavancagem operacional 1x.
- Entrada inicial 10%.
- Máximo da cesta 50%.
- Reserva obrigatória 50%.
- Máximo 2 proteções.
- Score mínimo de entrada 82.
- Score mínimo de proteção 78.
- Stop diário 1,5%.

### Moderado

- Perfil padrão.
- Spot puro.
- Alavancagem operacional 1,5x.
- Entrada inicial 10%.
- Máximo da cesta 70%.
- Reserva obrigatória 30%.
- Máximo 3 proteções.
- Score mínimo de entrada 75.
- Score mínimo de proteção 72.
- Stop diário 3%.

### Agressivo

- Spot puro com maior exposição.
- Alavancagem operacional 2x.
- Entrada inicial 15%.
- Máximo da cesta 85%.
- Reserva obrigatória 15%.
- Máximo 4 proteções.
- Score mínimo de entrada 68.
- Score mínimo de proteção 68.
- Stop diário 5%.

## Regras de proteção da cesta

A cesta agora não compra proteção de forma cega. Ela valida:

- queda mínima planejada;
- proximidade de suporte;
- RSI;
- rejeição ou pullback;
- ausência de baixa forte;
- volume sem explosão vendedora;
- limite máximo de proteções;
- limite máximo de exposição por perfil;
- reserva obrigatória.

## Regra de resistência

O robô bloqueia entrada perto de resistência se não existir ciclo de alta ou rompimento/reteste. Isso evita comprar topo sem espaço para micro lucro.

## Saída da cesta

O fechamento passa a considerar lucro líquido da cesta inteira:

- preço médio da cesta;
- taxa estimada Binance;
- slippage estimado;
- taxa INV;
- alvo mínimo de lucro líquido.

A venda ocorre quando a cesta total fica positiva após custos.

## Cadastro corrigido

Correções aplicadas:

- CPF inválido agora é bloqueado corretamente.
- CPF repetido é checado por RPC segura `cpf_hash_exists`.
- Cadastro envia `full_name`, `phone`, `cpf_hash` e `cpf_masked` para o metadata do Supabase Auth.
- Trigger `handle_new_auth_user` cria `profiles`, `user_documents` e `inv_wallets` automaticamente.
- Foi criado índice único em `user_documents(user_id)` porque o cadastro usava `ON CONFLICT (user_id)` sem constraint, o que podia quebrar novos cadastros.
- Compatibilidade opcional com tabela `clientes`, caso ela exista no banco.

## Segurança de crédito INV

A função `admin-credit-inv` agora:

- exige token Bearer do usuário logado;
- valida se o usuário é admin ativo;
- usa RPC service segura `admin_credit_inv_service`;
- registra ação em `admin_actions`;
- bloqueia crédito INV público sem validação.

## Build testado

Comando executado:

```bash
npm run build
```

Resultado: build concluído com sucesso.

Aviso restante: chunk JS acima de 500 kB. Não quebra o deploy, mas pode ser otimizado depois com code splitting.
