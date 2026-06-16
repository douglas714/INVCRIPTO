-- INVCRIPTO IA - Correcoes 2026-06-15
-- Execute no SQL Editor do Supabase.

update public.system_settings
set value = jsonb_set(coalesce(value, '{}'::jsonb), '{fee_percent}', '25'::jsonb),
    updated_at = now()
where key = 'inv';

insert into public.system_settings(key, value)
values ('inv', '{"initial_bonus":10,"fee_percent":25,"brl_per_inv":1}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

alter table public.profit_events
alter column fee_percent set default 25;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, email, full_name, role, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'client',
    'active'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    role = case when public.profiles.role = 'admin' then 'admin' else 'client' end,
    status = coalesce(public.profiles.status, 'active');

  insert into public.inv_wallets(user_id, balance_inv)
  values (new.id, 10)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_invcripto on auth.users;
create trigger on_auth_user_created_invcripto
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Garanta manualmente que apenas administradores reais tenham role admin.
-- Exemplo:
-- update public.profiles set role = 'client' where email = 'jeovana@example.com';
-- update public.profiles set role = 'admin' where email = 'douglasnoticias@gmail.com';
