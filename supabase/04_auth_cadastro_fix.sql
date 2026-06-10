-- INVCRIPTO IA - Correção de cadastro/login Supabase
-- Execute este arquivo no SQL Editor caso já tenha rodado o schema anterior.
-- Ele cria o perfil, CPF, carteira ENV e bot automaticamente no momento do cadastro.

create extension if not exists pgcrypto;

create or replace function public.handle_new_invcripto_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_phone text;
  v_cpf_hash text;
  v_cpf_masked text;
begin
  v_full_name := coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1), 'Cliente INVCRIPTO');
  v_phone := coalesce(nullif(new.raw_user_meta_data->>'phone',''), 'não informado');
  v_cpf_hash := nullif(new.raw_user_meta_data->>'cpf_hash','');
  v_cpf_masked := coalesce(nullif(new.raw_user_meta_data->>'cpf_masked',''), '***.***.***-**');

  if v_cpf_hash is null then
    -- Fallback técnico para não quebrar usuários antigos. O cadastro novo sempre envia CPF.
    v_cpf_hash := encode(digest(coalesce(new.email,new.id::text),'sha256'),'hex');
  end if;

  insert into public.profiles(id,email,full_name,phone,role,status)
  values (new.id, new.email, v_full_name, v_phone, 'client', 'active')
  on conflict (id) do update set
    email=excluded.email,
    full_name=excluded.full_name,
    phone=excluded.phone,
    updated_at=now();

  insert into public.user_documents(user_id,cpf_hash,cpf_masked,document_status)
  values (new.id, v_cpf_hash, v_cpf_masked, 'verified_basic')
  on conflict (cpf_hash) do nothing;

  if not exists (select 1 from public.user_documents where user_id = new.id) then
    raise exception 'CPF já cadastrado em outra conta';
  end if;

  insert into public.inv_wallets(user_id,balance_inv,blocked_inv)
  values (new.id, 10, 0)
  on conflict (user_id) do nothing;

  insert into public.inv_transactions(user_id, tx_type, amount_inv, balance_before, balance_after, description)
  select new.id, 'initial_bonus', 10, 0, 10, 'Bônus inicial de cadastro'
  where not exists (
    select 1 from public.inv_transactions
    where user_id = new.id and tx_type = 'initial_bonus'
  );

  insert into public.bot_instances(user_id, mode, status, symbols, active_symbol, profile_name, config)
  values (
    new.id,
    'paper',
    'inactive',
    array['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','DOTUSDT','LTCUSDT','TRXUSDT'],
    'BTCUSDT',
    'conservador',
    '{"base_currency":"USDT","credit_unit":"ENV","env_usd":1,"fee_percent":10}'::jsonb
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_invcripto on auth.users;
create trigger on_auth_user_created_invcripto
after insert on auth.users
for each row execute function public.handle_new_invcripto_user();

grant execute on function public.handle_new_invcripto_user() to service_role;
