-- Exemplo para definir/redefinir senha de um cliente manual ja existente.
-- Rode antes: supabase/06_permitir_clientes_manuais.sql
-- Troque e-mail e senha antes de executar.

insert into public.manual_login_credentials(user_id, email, password_hash)
select
  p.id,
  lower(p.email),
  crypt('nova-senha-aqui', gen_salt('bf'))
from public.profiles p
where lower(p.email) = lower('cliente@email.com')
on conflict (user_id) do update set
  email = excluded.email,
  password_hash = excluded.password_hash,
  updated_at = now();
