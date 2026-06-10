-- INVCRIPTO IA - Supabase schema
-- Execute no SQL Editor do Supabase Project ID: pxczyddzqagzijsipche
-- IMPORTANTE: nunca coloque service_role/secret key no frontend.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  cpf text unique,
  phone text,
  env_balance numeric(14,2) not null default 10 check (env_balance >= 0),
  is_admin boolean not null default false,
  is_blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.env_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('initial_credit', 'admin_credit', 'profit_fee', 'recharge', 'manual_adjustment')),
  amount_env numeric(14,2) not null,
  amount_usd numeric(14,2),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.env_recharge_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_env numeric(14,2) not null check (amount_env > 0),
  amount_usd numeric(14,2) not null check (amount_usd > 0),
  amount_brl numeric(14,2),
  usdt_brl_rate numeric(14,6),
  payment_provider text default 'pix_pending',
  payment_reference text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists env_recharge_requests_set_updated_at on public.env_recharge_requests;
create trigger env_recharge_requests_set_updated_at
before update on public.env_recharge_requests
for each row execute function public.set_updated_at();

create or replace function public.is_current_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_admin = true
      and p.is_blocked = false
  );
$$;

create or replace function public.cpf_exists(check_cpf text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.cpf = regexp_replace(coalesce(check_cpf, ''), '\D', '', 'g')
  );
$$;

grant execute on function public.cpf_exists(text) to anon, authenticated;
grant execute on function public.is_current_admin() to authenticated;

create or replace function public.admin_add_env(
  target_user_id uuid,
  amount_env numeric,
  note_text text default 'Ajuste manual admin'
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_profile public.profiles;
begin
  if not public.is_current_admin() then
    raise exception 'Apenas administrador pode adicionar ENV manualmente.';
  end if;

  if amount_env is null or amount_env <= 0 then
    raise exception 'amount_env precisa ser maior que zero.';
  end if;

  update public.profiles
  set env_balance = env_balance + amount_env,
      updated_at = now()
  where id = target_user_id
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'Usuário não encontrado.';
  end if;

  insert into public.env_transactions (user_id, type, amount_env, amount_usd, note, created_by)
  values (target_user_id, 'admin_credit', amount_env, amount_env, note_text, auth.uid());

  return updated_profile;
end;
$$;

grant execute on function public.admin_add_env(uuid, numeric, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.env_transactions enable row level security;
alter table public.env_recharge_requests enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_current_admin());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
on public.profiles for update
to authenticated
using (id = auth.uid() or public.is_current_admin())
with check (id = auth.uid() or public.is_current_admin());

drop policy if exists "env_transactions_select_own_or_admin" on public.env_transactions;
create policy "env_transactions_select_own_or_admin"
on public.env_transactions for select
to authenticated
using (user_id = auth.uid() or public.is_current_admin());

drop policy if exists "env_transactions_insert_admin" on public.env_transactions;
create policy "env_transactions_insert_admin"
on public.env_transactions for insert
to authenticated
with check (public.is_current_admin());

drop policy if exists "recharge_select_own_or_admin" on public.env_recharge_requests;
create policy "recharge_select_own_or_admin"
on public.env_recharge_requests for select
to authenticated
using (user_id = auth.uid() or public.is_current_admin());

drop policy if exists "recharge_insert_own" on public.env_recharge_requests;
create policy "recharge_insert_own"
on public.env_recharge_requests for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "recharge_update_admin" on public.env_recharge_requests;
create policy "recharge_update_admin"
on public.env_recharge_requests for update
to authenticated
using (public.is_current_admin())
with check (public.is_current_admin());

-- Para transformar um usuário em administrador, substitua pelo ID do usuário após cadastro:
-- update public.profiles set is_admin = true where email = 'seu-admin@email.com';
