-- INVCRIPTO IA - Atualização USDT/ENV
-- Execute após o schema.sql se seu banco já estiver criado.
-- Mantém compatibilidade com as tabelas inv_* existentes, mas a regra de negócio passa a ser:
-- 1 ENV = US$ 1,00, robô opera em USDT e pagamentos em BRL convertem pela cotação do dólar/USDT.

alter table if exists public.bot_instances
  add column if not exists binance_usdt_balance numeric(20,8) not null default 0,
  add column if not exists quote_asset text not null default 'USDT';

alter table if exists public.paper_wallets
  add column if not exists balance_usd numeric(14,2),
  add column if not exists realized_profit_usd numeric(14,2) not null default 0;

update public.paper_wallets
set balance_usd = coalesce(balance_usd, balance_brl)
where balance_usd is null;

alter table if exists public.profit_events
  add column if not exists profit_usd numeric(14,2),
  add column if not exists fee_env numeric(14,2),
  add column if not exists usdt_brl_rate numeric(14,6);

update public.profit_events
set profit_usd = coalesce(profit_usd, profit_brl),
    fee_env = coalesce(fee_env, fee_inv)
where profit_usd is null or fee_env is null;

alter table if exists public.payments
  add column if not exists amount_usd numeric(14,2),
  add column if not exists env_amount numeric(14,2),
  add column if not exists usdt_brl_rate numeric(14,6),
  add column if not exists quote_asset text not null default 'USDT';

create or replace function public.debit_env_fee(p_user_id uuid, p_amount numeric, p_description text default null)
returns numeric language plpgsql security definer set search_path=public as $$
declare v_before numeric; v_after numeric;
begin
  if p_amount <= 0 then raise exception 'Valor ENV precisa ser maior que zero'; end if;
  insert into public.inv_wallets(user_id, balance_inv) values (p_user_id, 0) on conflict (user_id) do nothing;
  select balance_inv into v_before from public.inv_wallets where user_id = p_user_id for update;
  if v_before < p_amount then
    update public.bot_instances set status='no_credit', active=false where user_id=p_user_id;
    raise exception 'Saldo ENV insuficiente';
  end if;
  v_after := v_before - p_amount;
  update public.inv_wallets set balance_inv = v_after where user_id = p_user_id;
  insert into public.inv_transactions(user_id, tx_type, amount_inv, balance_before, balance_after, description, created_by)
  values (p_user_id, 'profit_fee', -p_amount, v_before, v_after, coalesce(p_description,'Taxa ENV sobre lucro em USDT'), null);
  return v_after;
end $$;

grant execute on function public.debit_env_fee(uuid,numeric,text) to authenticated;

insert into public.system_settings(key, value) values
('env_credit', '{"initial_bonus":10,"fee_percent":10,"usd_per_env":1,"quote_asset":"USDT","payment_currency":"BRL","payment_conversion":"BRL_TO_USD_AT_PAYMENT_TIME"}'::jsonb),
('bot_quote', '{"quote_asset":"USDT","allowed_symbols":["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","AVAXUSDT","DOGEUSDT","LINKUSDT","DOTUSDT","LTCUSDT","TRXUSDT"]}'::jsonb)
on conflict (key) do update set value=excluded.value;
