-- INVCRIPTO - cestas persistentes, protecao offline na Binance e reconciliacao de saldo
-- Execute no Supabase SQL Editor depois dos scripts anteriores.

create table if not exists public.real_baskets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  environment text not null default 'live' check (environment in ('testnet','live')),
  symbol text not null,
  profile_name text not null default 'conservador'
    check (profile_name in ('conservador','moderado','arrojado','alavancagem')),
  status text not null default 'active'
    check (status in ('active','paused','closed','error')),
  initial_order_usdt numeric(20,8) not null default 10,
  target_net_pct numeric(8,4) not null default 0.5,
  protection_gap_pct numeric(8,4) not null,
  max_concurrent_baskets integer not null default 1,
  normal_budget_usdt numeric(20,8) not null default 0,
  emergency_budget_usdt numeric(20,8) not null default 0,
  normal_used_usdt numeric(20,8) not null default 0,
  emergency_used_usdt numeric(20,8) not null default 0,
  total_buy_quote numeric(20,8) not null default 0,
  total_sell_quote numeric(20,8) not null default 0,
  total_bought_qty numeric(24,12) not null default 0,
  total_sold_qty numeric(24,12) not null default 0,
  open_qty numeric(24,12) not null default 0,
  avg_price numeric(24,12) not null default 0,
  last_buy_price numeric(24,12) not null default 0,
  last_buy_quote numeric(20,8) not null default 10,
  recovery_level integer not null default 0,
  current_take_profit_price numeric(24,12),
  next_protection_price numeric(24,12),
  next_protection_quote numeric(20,8),
  next_protection_bucket text check (next_protection_bucket is null or next_protection_bucket in ('normal','emergency')),
  profit_recorded boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.real_orders
  add column if not exists basket_id uuid references public.real_baskets(id) on delete set null;
alter table public.real_orders
  add column if not exists order_list_id text;
alter table public.real_orders
  add column if not exists commission_quote numeric(20,8) not null default 0;
alter table public.real_orders
  add column if not exists profile_name text;

alter table public.real_orders drop constraint if exists real_orders_protection_role_check;
alter table public.real_orders add constraint real_orders_protection_role_check
  check (protection_role is null or protection_role in (
    'entry',
    'take_profit',
    'recovery_take_profit',
    'protection_buy',
    'protection_hand_take_profit',
    'stop'
  ));

create unique index if not exists real_baskets_one_active_symbol
  on public.real_baskets(user_id, environment, symbol)
  where status = 'active';
create index if not exists idx_real_baskets_user_status
  on public.real_baskets(user_id, environment, status, opened_at desc);
create index if not exists idx_real_orders_basket
  on public.real_orders(basket_id, created_at asc);
create index if not exists idx_real_orders_client_order
  on public.real_orders(user_id, environment, client_order_id);

alter table public.real_baskets enable row level security;
drop policy if exists real_baskets_own_or_admin on public.real_baskets;
create policy real_baskets_own_or_admin on public.real_baskets
for all using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

do $$ begin
  create trigger real_baskets_touch before update on public.real_baskets
  for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

grant select, insert, update on public.real_baskets to authenticated;

insert into public.system_settings(key, value) values
('basket_execution_v2', '{
  "initial_entry_usdt": 10,
  "target_net_pct": 0.5,
  "normal_reserve_pct": 80,
  "emergency_reserve_pct": 20,
  "profiles": {
    "conservador": {"protection_gap_pct": 1.0, "max_concurrent_baskets": 1},
    "moderado": {"protection_gap_pct": 0.5, "max_concurrent_baskets": 1},
    "arrojado": {"protection_gap_pct": 0.3, "max_concurrent_baskets": 1},
    "alavancagem": {"protection_gap_pct": 0.15, "max_concurrent_baskets": 5}
  },
  "offline_protection": "Binance OPO: compra LIMIT no proximo suporte abaixo do intervalo minimo + venda LIMIT automatica da nova mao",
  "support_aware_entry": true,
  "reprice_protection_only_down": true
}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
