-- INVCRIPTO IA - Correcoes detalhadas 2026-06-15
-- Execute no SQL Editor do Supabase antes do novo deploy.
-- Objetivos:
-- 1) Corrigir cadastro de novos usuarios via Auth trigger.
-- 2) Gravar CPF/telefone enviados no metadata do cadastro.
-- 3) Criar RPC segura para checar CPF duplicado.
-- 4) Bloquear credito INV indevido por chamada publica.
-- 5) Adicionar setup operacional conservador/moderado/agressivo.

create extension if not exists pgcrypto;

alter table if exists public.profiles add column if not exists phone text;
alter table if exists public.bot_instances add column if not exists leverage numeric(8,2) not null default 1;
alter table if exists public.bot_instances add column if not exists leverage_mode text not null default 'operational';
alter table if exists public.bot_instances add column if not exists real_leverage_enabled boolean not null default false;

-- Necessario porque o cadastro usa ON CONFLICT (user_id) em user_documents.
create unique index if not exists user_documents_user_id_key on public.user_documents(user_id);
create index if not exists profiles_email_lower_idx on public.profiles(lower(email));


insert into public.system_settings(key, value)
values (
  'inv',
  '{"initial_bonus":10,"fee_percent":25,"brl_per_inv":1}'::jsonb
)
on conflict (key) do update set value = excluded.value, updated_at = now();

insert into public.system_settings(key, value)
values (
  'risk_profiles',
  '{
    "conservative": {
      "label":"Conservador",
      "mode":"SPOT",
      "leverageMode":"operational",
      "leverage":1,
      "realLeverageEnabled":false,
      "initialEntryPct":0.10,
      "maxBasketExposurePct":0.50,
      "requiredReservePct":0.50,
      "protectionLevels":[0.15,0.20],
      "protectionDropPct":[0.006,0.014],
      "maxProtections":2,
      "maxOpenBaskets":1,
      "minEntryScore":82,
      "minBreakoutScore":90,
      "minProtectionScore":78,
      "microTakeProfitPct":0.0035,
      "basketTakeProfitPct":0.0025,
      "dailyStopLossPct":0.015,
      "dailyStopWinPct":0.015,
      "cooldownAfterLossMinutes":45,
      "allowedSymbols":["BTCUSDT","ETHUSDT"]
    },
    "moderate": {
      "label":"Moderado",
      "mode":"SPOT",
      "leverageMode":"operational",
      "leverage":1.5,
      "realLeverageEnabled":false,
      "initialEntryPct":0.10,
      "maxBasketExposurePct":0.70,
      "requiredReservePct":0.30,
      "protectionLevels":[0.15,0.20,0.25],
      "protectionDropPct":[0.005,0.012,0.022],
      "maxProtections":3,
      "maxOpenBaskets":2,
      "minEntryScore":75,
      "minBreakoutScore":85,
      "minProtectionScore":72,
      "microTakeProfitPct":0.005,
      "basketTakeProfitPct":0.0035,
      "dailyStopLossPct":0.03,
      "dailyStopWinPct":0.03,
      "cooldownAfterLossMinutes":20,
      "allowedSymbols":["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT"]
    },
    "aggressive": {
      "label":"Agressivo",
      "mode":"SPOT",
      "leverageMode":"operational",
      "leverage":2,
      "realLeverageEnabled":false,
      "initialEntryPct":0.15,
      "maxBasketExposurePct":0.85,
      "requiredReservePct":0.15,
      "protectionLevels":[0.15,0.20,0.25,0.10],
      "protectionDropPct":[0.004,0.010,0.018,0.030],
      "maxProtections":4,
      "maxOpenBaskets":3,
      "minEntryScore":68,
      "minBreakoutScore":82,
      "minProtectionScore":68,
      "microTakeProfitPct":0.004,
      "basketTakeProfitPct":0.003,
      "dailyStopLossPct":0.05,
      "dailyStopWinPct":0.05,
      "cooldownAfterLossMinutes":10,
      "allowedSymbols":["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","LINKUSDT","AVAXUSDT"]
    }
  }'::jsonb
)
on conflict (key) do update set value = excluded.value, updated_at = now();

insert into public.system_settings(key, value)
values ('symbols', '{"allowed":["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","LINKUSDT","AVAXUSDT"]}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

alter table if exists public.profit_events alter column fee_percent set default 25;

create or replace function public.cpf_hash_exists(p_cpf_hash text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.user_documents where cpf_hash = p_cpf_hash);
$$;

grant execute on function public.cpf_hash_exists(text) to anon, authenticated;

create or replace function public.register_my_document(p_cpf_hash text, p_cpf_masked text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuario nao autenticado';
  end if;

  insert into public.user_documents(user_id, cpf_hash, cpf_masked)
  values (auth.uid(), p_cpf_hash, p_cpf_masked)
  on conflict (user_id) do update set
    cpf_hash = excluded.cpf_hash,
    cpf_masked = excluded.cpf_masked;
end;
$$;

grant execute on function public.register_my_document(text, text) to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_phone text := coalesce(new.raw_user_meta_data->>'phone', 'nao informado');
  v_cpf_hash text := nullif(new.raw_user_meta_data->>'cpf_hash', '');
  v_cpf_masked text := nullif(new.raw_user_meta_data->>'cpf_masked', '');
  v_has_clientes boolean;
begin
  insert into public.profiles(id, email, full_name, phone, role, status)
  values (
    new.id,
    coalesce(new.email, ''),
    v_full_name,
    v_phone,
    'client',
    'active'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    phone = coalesce(nullif(excluded.phone, ''), public.profiles.phone),
    role = case when public.profiles.role = 'admin' then 'admin' else 'client' end,
    status = coalesce(public.profiles.status, 'active');

  if v_cpf_hash is not null then
    insert into public.user_documents(user_id, cpf_hash, cpf_masked)
    values (new.id, v_cpf_hash, v_cpf_masked)
    on conflict (user_id) do update set
      cpf_hash = excluded.cpf_hash,
      cpf_masked = excluded.cpf_masked;
  end if;

  insert into public.inv_wallets(user_id, balance_inv)
  values (new.id, 10)
  on conflict (user_id) do nothing;

  -- Compatibilidade com projetos que ja usam a tabela public.clientes no painel/admin.
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'clientes'
  ) into v_has_clientes;

  if v_has_clientes then
    begin
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clientes' and column_name='saldo_inv') then
        execute '
          insert into public.clientes(id,email,nome,telefone,perfil,status,cpf,saldo_inv,saldo_demo_usdt,saldo_real_usdt,ambiente_binance)
          values ($1,$2,$3,$4,$5,$6,$7,10,200,0,''paper'')
          on conflict (id) do update set
            email = excluded.email,
            nome = excluded.nome,
            telefone = excluded.telefone,
            cpf = excluded.cpf,
            status = excluded.status
        ' using new.id, coalesce(new.email,''), v_full_name, v_phone, 'client', 'active', v_cpf_masked;
      elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='clientes' and column_name='saldo_env') then
        execute '
          insert into public.clientes(id,email,nome,telefone,perfil,status,cpf,saldo_env,saldo_demo_usdt,saldo_real_usdt,ambiente_binance)
          values ($1,$2,$3,$4,$5,$6,$7,10,200,0,''paper'')
          on conflict (id) do update set
            email = excluded.email,
            nome = excluded.nome,
            telefone = excluded.telefone,
            cpf = excluded.cpf,
            status = excluded.status
        ' using new.id, coalesce(new.email,''), v_full_name, v_phone, 'client', 'active', v_cpf_masked;
      end if;
    exception when others then
      raise notice 'Compat clientes ignorada: %', SQLERRM;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_invcripto on auth.users;
create trigger on_auth_user_created_invcripto
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.credit_inv(p_user_id uuid, p_amount numeric, p_type public.inv_tx_type, p_description text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric;
  v_after numeric;
  v_bonus_exists boolean;
begin
  if p_amount <= 0 then
    raise exception 'Valor INV precisa ser positivo';
  end if;

  if p_type = 'initial_bonus' then
    if auth.uid() is not null and auth.uid() <> p_user_id then
      raise exception 'Bonus inicial somente para o proprio usuario';
    end if;
    select exists(select 1 from public.inv_transactions where user_id = p_user_id and tx_type = 'initial_bonus') into v_bonus_exists;
    if v_bonus_exists then
      return;
    end if;
  elsif not public.is_admin() then
    raise exception 'Somente administrador pode creditar INV';
  end if;

  insert into public.inv_wallets(user_id, balance_inv) values (p_user_id, 0) on conflict (user_id) do nothing;
  select balance_inv into v_before from public.inv_wallets where user_id = p_user_id for update;
  v_after := v_before + p_amount;
  update public.inv_wallets set balance_inv = v_after where user_id = p_user_id;
  insert into public.inv_transactions(user_id, tx_type, amount_inv, balance_before, balance_after, description, created_by)
  values (p_user_id, p_type, p_amount, v_before, v_after, p_description, auth.uid());
end;
$$;

grant execute on function public.credit_inv(uuid, numeric, public.inv_tx_type, text) to authenticated;

create or replace function public.admin_credit_inv_service(p_admin_user_id uuid, p_user_id uuid, p_amount numeric, p_description text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric;
  v_after numeric;
begin
  if p_amount <= 0 then
    raise exception 'Valor INV precisa ser positivo';
  end if;

  if not exists(select 1 from public.profiles where id = p_admin_user_id and role = 'admin' and status = 'active') then
    raise exception 'Administrador invalido';
  end if;

  insert into public.inv_wallets(user_id, balance_inv) values (p_user_id, 0) on conflict (user_id) do nothing;
  select balance_inv into v_before from public.inv_wallets where user_id = p_user_id for update;
  v_after := v_before + p_amount;
  update public.inv_wallets set balance_inv = v_after where user_id = p_user_id;
  insert into public.inv_transactions(user_id, tx_type, amount_inv, balance_before, balance_after, description, created_by)
  values (p_user_id, 'admin_adjustment', p_amount, v_before, v_after, p_description, p_admin_user_id);
  insert into public.admin_actions(admin_user_id, target_user_id, action, details)
  values (p_admin_user_id, p_user_id, 'credit_inv', jsonb_build_object('amount_inv', p_amount, 'description', p_description));
end;
$$;

revoke all on function public.admin_credit_inv_service(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_credit_inv_service(uuid, uuid, numeric, text) to service_role;

-- Garanta manualmente que apenas administradores reais tenham role admin.
-- update public.profiles set role = 'admin' where email = 'douglasnoticias@gmail.com';
