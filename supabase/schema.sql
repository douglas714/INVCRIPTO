-- INV CRIPTO IA - Supabase Schema
-- Execute no SQL Editor do Supabase.

create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('client','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bot_mode as enum ('paper','testnet','live');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bot_status as enum ('inactive','active','paused','no_credits','error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.inv_tx_type as enum ('initial_bonus','recharge','profit_fee','admin_adjustment','refund','system');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  role public.user_role not null default 'client',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  cpf_hash text not null unique,
  cpf_masked text,
  document_status text not null default 'verified_basic',
  created_at timestamptz not null default now()
);

create table if not exists public.inv_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_inv numeric(14,2) not null default 0,
  blocked_inv numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  constraint inv_non_negative check (balance_inv >= 0 and blocked_inv >= 0)
);

create table if not exists public.inv_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tx_type public.inv_tx_type not null,
  amount_inv numeric(14,2) not null,
  balance_before numeric(14,2) not null,
  balance_after numeric(14,2) not null,
  reference_table text,
  reference_id uuid,
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.binance_api_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Principal',
  api_key_masked text,
  api_key_encrypted text,
  api_secret_encrypted text,
  can_read boolean not null default false,
  can_trade boolean not null default false,
  can_withdraw boolean not null default false,
  environment text not null default 'paper',
  status text not null default 'pending',
  last_test_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode public.bot_mode not null default 'paper',
  status public.bot_status not null default 'inactive',
  symbols text[] not null default array['BTCUSDT','ETHUSDT'],
  active_symbol text not null default 'BTCUSDT',
  profile_name text not null default 'conservador',
  paper_balance_brl numeric(14,2) not null default 1000,
  stop_win_pct numeric(8,4) not null default 1,
  stop_loss_pct numeric(8,4) not null default 5,
  max_basket_pct numeric(8,4) not null default 5,
  config jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.paper_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bot_id uuid references public.bot_instances(id) on delete cascade,
  balance_brl numeric(14,2) not null default 1000,
  balance_usdt numeric(14,2) not null default 200,
  btc_qty numeric(20,10) not null default 0,
  eth_qty numeric(20,10) not null default 0,
  realized_profit_brl numeric(14,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.paper_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bot_id uuid references public.bot_instances(id) on delete set null,
  symbol text not null check (symbol in ('BTCUSDT','ETHUSDT')),
  side text not null check (side in ('BUY','SELL')),
  order_type text not null default 'MARKET',
  quantity numeric(20,10) not null,
  price_usdt numeric(20,8) not null,
  value_usdt numeric(20,8) not null,
  status text not null default 'filled',
  source text not null default 'paper',
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.paper_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bot_id uuid references public.bot_instances(id) on delete set null,
  symbol text not null check (symbol in ('BTCUSDT','ETHUSDT')),
  status text not null default 'open',
  total_qty numeric(20,10) not null default 0,
  avg_price_usdt numeric(20,8) not null default 0,
  invested_usdt numeric(20,8) not null default 0,
  realized_profit_usdt numeric(20,8) not null default 0,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.bot_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bot_id uuid references public.bot_instances(id) on delete set null,
  symbol text not null,
  mode public.bot_mode not null default 'paper',
  state text not null,
  trend text,
  action text,
  score numeric(8,2),
  price_usdt numeric(20,8),
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.profit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bot_id uuid references public.bot_instances(id) on delete set null,
  symbol text not null,
  profit_usdt numeric(20,8) not null,
  profit_brl numeric(14,2) not null,
  fee_percent numeric(8,4) not null default 10,
  fee_inv numeric(14,2) not null,
  inv_charged boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  provider text not null default 'manual',
  payment_method text not null default 'pix',
  amount_brl numeric(14,2) not null,
  inv_amount numeric(14,2) not null,
  status text not null default 'pending',
  provider_reference text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.profiles(id),
  target_user_id uuid references public.profiles(id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

do $$ begin
  create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger inv_wallets_touch before update on public.inv_wallets for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger bot_instances_touch before update on public.bot_instances for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

create or replace function public.credit_inv(p_user_id uuid, p_amount numeric, p_type public.inv_tx_type, p_description text default null)
returns void language plpgsql security definer as $$
declare
  v_before numeric;
  v_after numeric;
begin
  insert into public.inv_wallets(user_id, balance_inv) values (p_user_id, 0) on conflict (user_id) do nothing;
  select balance_inv into v_before from public.inv_wallets where user_id = p_user_id for update;
  v_after := v_before + p_amount;
  update public.inv_wallets set balance_inv = v_after where user_id = p_user_id;
  insert into public.inv_transactions(user_id, tx_type, amount_inv, balance_before, balance_after, description, created_by)
  values (p_user_id, p_type, p_amount, v_before, v_after, p_description, auth.uid());
end; $$;

create or replace function public.debit_inv_fee(p_user_id uuid, p_amount numeric, p_description text default null)
returns boolean language plpgsql security definer as $$
declare
  v_before numeric;
  v_after numeric;
begin
  insert into public.inv_wallets(user_id, balance_inv) values (p_user_id, 0) on conflict (user_id) do nothing;
  select balance_inv into v_before from public.inv_wallets where user_id = p_user_id for update;
  if v_before < p_amount then
    update public.bot_instances set status = 'no_credits', paused_at = now() where user_id = p_user_id;
    return false;
  end if;
  v_after := v_before - p_amount;
  update public.inv_wallets set balance_inv = v_after where user_id = p_user_id;
  insert into public.inv_transactions(user_id, tx_type, amount_inv, balance_before, balance_after, description, created_by)
  values (p_user_id, 'profit_fee', -p_amount, v_before, v_after, p_description, auth.uid());
  if v_after <= 0 then
    update public.bot_instances set status = 'no_credits', paused_at = now() where user_id = p_user_id;
  end if;
  return true;
end; $$;

alter table public.profiles enable row level security;
alter table public.user_documents enable row level security;
alter table public.inv_wallets enable row level security;
alter table public.inv_transactions enable row level security;
alter table public.binance_api_credentials enable row level security;
alter table public.bot_instances enable row level security;
alter table public.paper_wallets enable row level security;
alter table public.paper_orders enable row level security;
alter table public.paper_positions enable row level security;
alter table public.bot_decisions enable row level security;
alter table public.profit_events enable row level security;
alter table public.payments enable row level security;
alter table public.admin_actions enable row level security;

-- Helper policies. Re-running may fail if policy exists, so drop first.
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname='public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "profiles_select_own_or_admin" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles_update_own_or_admin" on public.profiles for update using (id = auth.uid() or public.is_admin());
create policy "profiles_insert_self" on public.profiles for insert with check (id = auth.uid());

create policy "documents_own_or_admin" on public.user_documents for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "wallet_own_or_admin" on public.inv_wallets for select using (user_id = auth.uid() or public.is_admin());
create policy "wallet_admin_modify" on public.inv_wallets for all using (public.is_admin()) with check (public.is_admin());
create policy "inv_tx_own_or_admin" on public.inv_transactions for select using (user_id = auth.uid() or public.is_admin());
create policy "inv_tx_admin_insert" on public.inv_transactions for insert with check (public.is_admin());

create policy "binance_creds_own_or_admin" on public.binance_api_credentials for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "bots_own_or_admin" on public.bot_instances for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "paper_wallets_own_or_admin" on public.paper_wallets for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "paper_orders_own_or_admin" on public.paper_orders for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "paper_positions_own_or_admin" on public.paper_positions for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "decisions_own_or_admin" on public.bot_decisions for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "profit_own_or_admin" on public.profit_events for select using (user_id = auth.uid() or public.is_admin());
create policy "payments_own_or_admin" on public.payments for select using (user_id = auth.uid() or public.is_admin());
create policy "payments_admin_all" on public.payments for all using (public.is_admin()) with check (public.is_admin());
create policy "admin_actions_admin" on public.admin_actions for all using (public.is_admin()) with check (public.is_admin());

insert into public.system_settings(key, value) values
('inv', '{"initial_bonus":10,"fee_percent":10,"brl_per_inv":1}'::jsonb),
('symbols', '{"allowed":["BTCUSDT","ETHUSDT"]}'::jsonb)
on conflict (key) do nothing;
