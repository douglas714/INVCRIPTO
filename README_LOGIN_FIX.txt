INVCRIPTO IA - Correção Login/Cadastro

Correção aplicada:
- Cadastro envia CPF e telefone para o Supabase Auth como metadata.
- Trigger SQL cria automaticamente profile, CPF, carteira ENV com 10 ENV e bot paper.
- Login mostra mensagem amigável para "Email not confirmed".
- Botão para reenviar confirmação de e-mail.

IMPORTANTE PARA TESTES:
Se quiser entrar logo sem confirmar e-mail, no Supabase abra:
Authentication > Providers > Email > Confirm email = OFF
Depois salve.

SQL necessário:
- Para banco novo: execute supabase/schema.sql
- Para banco já criado: execute supabase/04_auth_cadastro_fix.sql
