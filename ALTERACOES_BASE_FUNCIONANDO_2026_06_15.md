# INVCRIPTO IA - Alterações sobre o ZIP que estava funcionando

Este pacote foi refe自ito usando como base o arquivo original enviado:

`INV_CRIPTO_IA_CORRIGIDO_2026-06-15.zip`

## O que foi preservado

- `package.json` original preservado.
- `netlify.toml` original preservado.
- Estrutura de pastas original preservada.
- Build Vite original preservado.
- Gráfico com `lightweight-charts` mantido compatível com a versão usada pelo deploy original.
- Não foi incluído `package-lock.json` novo.
- Não foi incluído `node_modules`.
- Não foi incluído `dist`.

## Alterações aplicadas

### Cadastro

- Corrigida validação de CPF no front.
- Adicionado telefone no cadastro.
- Cadastro agora envia `full_name`, `phone`, `cpf_hash` e `cpf_masked` no metadata do Supabase Auth.
- O front não depende mais de inserir `profiles` e `user_documents` manualmente logo após o signUp, pois isso pode falhar quando a confirmação de e-mail está ativa ou quando o usuário ainda não tem sessão.
- Criada migration para o trigger `handle_new_auth_user()` gravar:
  - `profiles`
  - `user_documents`
  - `inv_wallets`
  - `clientes`, se a tabela existir no Supabase

### Perfis de operação

Adicionado `src/lib/riskProfiles.js` com:

- Conservador
- Moderado
- Agressivo

A alavancagem real continua bloqueada. O campo exibido é alavancagem operacional Spot, controlando exposição da cesta.

### Estratégia / cesta

- Robô mede mais informações de mercado.
- Adiciona controle de resistência.
- Adiciona ciclo de alta.
- Adiciona entrada por perfil.
- Adiciona cesta com proteções limitadas.
- Calcula preço médio da cesta.
- Fecha a cesta quando resultado líquido bate o alvo.
- Bloqueia proteção em queda forte.

## Build testado

Executado em ambiente local:

```bash
npm run build
```

Resultado:

```text
✓ built
```

O aviso de chunk acima de 500 kB é apenas aviso do Vite, não quebra deploy.

## Obrigatório antes de testar novos cadastros

Executar no SQL Editor do Supabase:

`supabase/correcoes_2026_06_15.sql`

