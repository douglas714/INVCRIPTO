-- Exemplo de cadastro direto pelas tabelas.
-- Rode antes: supabase/06_permitir_clientes_manuais.sql
-- Gere o CPF hash com SHA-256 apenas dos numeros do CPF.

select public.cadastrar_cliente_manual(
  'cliente@email.com',
  'Nome do Cliente',
  '22999999999',
  'sha256-do-cpf-somente-numeros',
  '000.000.000-00',
  10,
  200
) as user_id_cadastrado;

select *
from public.clientes
where lower(email) = lower('cliente@email.com');
