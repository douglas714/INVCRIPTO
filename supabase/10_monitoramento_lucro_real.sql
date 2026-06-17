-- INVCRIPTO IA - monitoramento de lucro real
-- Execute no Supabase SQL Editor depois do 09_ordem_real_protegida.sql.

alter table public.real_orders
  add column if not exists linked_order_id uuid references public.real_orders(id) on delete set null;

alter table public.real_orders
  add column if not exists protection_role text
  check (protection_role is null or protection_role in ('entry','take_profit','recovery_take_profit','stop'));

alter table public.real_orders
  add column if not exists timeframe text;

create index if not exists idx_real_orders_linked_order on public.real_orders(linked_order_id);
create index if not exists idx_real_orders_monitor_sells
  on public.real_orders(user_id, environment, symbol, status, created_at desc)
  where side = 'SELL';

insert into public.system_settings(key, value) values
(
  'real_profit_monitor',
  '{
    "enabled": true,
    "connector": "local",
    "flow": "Auto Trading cria comando; conector compra Spot, cria venda LIMIT GTC e monitora a venda para registrar lucro.",
    "score_minimo_real": 78,
    "fee_env": "10% somente sobre lucro realizado"
  }'::jsonb
)
on conflict (key) do update set value=excluded.value, updated_at=now();

notify pgrst, 'reload schema';
