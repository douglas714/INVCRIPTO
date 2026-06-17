-- INVCRIPTO IA - ordem real protegida
-- Execute no Supabase SQL Editor depois dos scripts anteriores.
-- A compra real e a venda limite ficam auditadas em real_orders.

alter table public.real_orders
  add column if not exists linked_order_id uuid references public.real_orders(id) on delete set null;

alter table public.real_orders
  add column if not exists protection_role text
  check (protection_role is null or protection_role in ('entry','take_profit','recovery_take_profit','stop'));

alter table public.real_orders
  add column if not exists timeframe text;

create index if not exists idx_real_orders_linked_order on public.real_orders(linked_order_id);
create index if not exists idx_real_orders_protection_role on public.real_orders(protection_role);

insert into public.system_settings(key, value) values
(
  'protected_real_order',
  '{
    "enabled": true,
    "connector_command": "EXECUTE_PROTECTED_SPOT_BUY",
    "entry": "MARKET BUY by quoteOrderQty",
    "exit": "LIMIT SELL GTC immediately after filled buy",
    "minimums": "Connector reads Binance exchangeInfo filters: LOT_SIZE, PRICE_FILTER, MIN_NOTIONAL/NOTIONAL",
    "note": "Spot Binance nao permite vender antes de possuir o ativo; por isso o conector compra primeiro e cria a venda limite imediatamente apos a execucao."
  }'::jsonb
)
on conflict (key) do update set value=excluded.value, updated_at=now();

notify pgrst, 'reload schema';
