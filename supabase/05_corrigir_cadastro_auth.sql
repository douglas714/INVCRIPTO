-- Rode este arquivo inteiro no SQL Editor do Supabase.
-- Corrige o erro "Database error saving new user" no cadastro e sincroniza Auth -> profiles/clientes.

alter table public.binance_api_credentials
  add column if not exists real_usdt_free numeric(20,8) not null default 0;

alter table public.binance_api_credentials
  add column if not exists real_usdt_locked numeric(20,8) not null default 0;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, full_name, phone, role, status)
  values (
    new.id,
    coalesce(nullif(new.email, ''), 'sem-email-' || new.id::text || '@invcripto.local'),
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(coalesce(nullif(new.email, ''), 'Usuario'), '@', 1), 'Usuario'),
    coalesce(nullif(new.raw_user_meta_data->>'phone', ''), 'nao informado'),
    'client'::public.user_role,
    'active'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
    phone = coalesce(nullif(public.profiles.phone, ''), excluded.phone),
    status = coalesce(nullif(public.profiles.status, ''), excluded.status);

  insert into public.inv_wallets(user_id, balance_inv)
  values (new.id, 0)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

insert into public.profiles(id, email, full_name, phone, role, status)
select
  u.id,
  coalesce(nullif(u.email, ''), 'sem-email-' || u.id::text || '@invcripto.local'),
  coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(coalesce(nullif(u.email, ''), 'Usuario'), '@', 1), 'Usuario'),
  coalesce(nullif(u.raw_user_meta_data->>'phone', ''), 'nao informado'),
  'client'::public.user_role,
  'active'
from auth.users u
on conflict (id) do update set
  email = excluded.email,
  full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
  phone = coalesce(nullif(public.profiles.phone, ''), excluded.phone);

insert into public.inv_wallets(user_id, balance_inv)
select p.id, 0
from public.profiles p
on conflict (user_id) do nothing;

create or replace view public.clientes
with (security_invoker = true) as
select
  p.id,
  p.email,
  p.full_name as nome,
  p.phone as telefone,
  p.role as perfil,
  p.status,
  p.created_at as criado_em,
  d.cpf_masked as cpf,
  coalesce(w.balance_inv,0) as saldo_env,
  coalesce(pw.balance_usdt,0) as saldo_demo_usdt,
  coalesce(c.real_usdt_free,0) as saldo_real_usdt,
  c.environment as ambiente_binance,
  c.api_key_masked as api_binance,
  coalesce(c.can_trade,false) as pode_operar,
  coalesce(c.can_withdraw,false) as saque_habilitado,
  coalesce(b.mode,'paper') as modo_robo,
  coalesce(b.status,'inactive') as status_robo
from public.profiles p
left join public.user_documents d on d.user_id=p.id
left join public.inv_wallets w on w.user_id=p.id
left join lateral (
  select balance_usdt from public.paper_wallets pw where pw.user_id=p.id order by pw.updated_at desc limit 1
) pw on true
left join lateral (
  select real_usdt_free, environment, api_key_masked, can_trade, can_withdraw
  from public.binance_api_credentials c
  where c.user_id=p.id
  order by c.updated_at desc
  limit 1
) c on true
left join lateral (
  select mode,status from public.bot_instances b where b.user_id=p.id order by b.created_at desc limit 1
) b on true;

grant select on public.clientes to authenticated;

select count(*) as total_clientes_sincronizados from public.clientes;
