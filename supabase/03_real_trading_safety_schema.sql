-- INVCRIPTO IA - segurança para preparação de operação real
-- Execute no Supabase SQL Editor após supabase/schema.sql.

create table if not exists public.real_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  environment text not null default 'testnet' check (environment in ('testnet','live')),
  symbol text not null,
  side text not null check (side in ('BUY','SELL')),
  order_type text not null default 'MARKET',
  status text not null default 'created',
  client_order_id text,
  binance_order_id text,
  quote_order_qty numeric(20,8),
  quantity numeric(20,10),
  price numeric(20,8),
  executed_qty numeric(20,10),
  cummulative_quote_qty numeric(20,8),
  reason text,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_risk_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  live_enabled boolean not null default false,
  max_order_usdt numeric(20,8) not null default 15,
  max_daily_loss_usdt numeric(20,8) not null default 25,
  max_open_positions integer not null default 1,
  allowed_symbols text[] not null default array['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT'],
  require_manual_live_confirm boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.real_orders enable row level security;
alter table public.bot_risk_settings enable row level security;

drop policy if exists real_orders_own_or_admin on public.real_orders;
drop policy if exists risk_settings_own_or_admin on public.bot_risk_settings;

create policy real_orders_own_or_admin on public.real_orders
for all using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

create policy risk_settings_own_or_admin on public.bot_risk_settings
for all using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

create index if not exists idx_real_orders_user_created on public.real_orders(user_id, created_at desc);
create index if not exists idx_real_orders_symbol_status on public.real_orders(symbol, status);

do $$ begin
  create trigger real_orders_touch before update on public.real_orders for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger risk_settings_touch before update on public.bot_risk_settings for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

insert into public.bot_risk_settings(user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

insert into public.system_settings(key, value) values
('real_trading_safety', '{"default_live_enabled":false,"max_order_usdt":15,"max_daily_loss_usdt":25,"require_manual_live_confirm":true,"note":"Operação real deve permanecer bloqueada até validação final em testnet e confirmação manual."}'::jsonb),
('symbols', '{"allowed":["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","AVAXUSDT","DOGEUSDT","LINKUSDT","DOTUSDT","LTCUSDT","TRXUSDT"]}'::jsonb)
on conflict (key) do update set value=excluded.value, updated_at=now();

grant select, insert, update on public.real_orders to authenticated;
grant select, insert, update on public.bot_risk_settings to authenticated;
