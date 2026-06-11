-- Rode este arquivo no SQL Editor do Supabase para permitir clientes cadastrados direto nas tabelas.
-- Observacao: clientes manuais aparecem no painel/admin, mas login por senha no site continua sendo do Supabase Auth.

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

create unique index if not exists profiles_email_lower_uidx
  on public.profiles (lower(email));

create or replace function public.cadastrar_cliente_manual(
  p_email text,
  p_full_name text,
  p_phone text,
  p_cpf_hash text,
  p_cpf_masked text,
  p_env numeric default 10,
  p_demo_usdt numeric default 200
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_bot_id uuid;
begin
  select id into v_user_id
  from public.profiles
  where lower(email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    v_user_id := gen_random_uuid();
  end if;

  insert into public.profiles(id, email, full_name, phone, role, status)
  values (
    v_user_id,
    lower(trim(p_email)),
    trim(p_full_name),
    trim(p_phone),
    'client'::public.user_role,
    'active'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    phone = excluded.phone,
    role = excluded.role,
    status = excluded.status,
    updated_at = now();

  insert into public.user_documents(user_id, cpf_hash, cpf_masked, document_status)
  values (v_user_id, p_cpf_hash, p_cpf_masked, 'verified_basic')
  on conflict (cpf_hash) do update set
    user_id = excluded.user_id,
    cpf_masked = excluded.cpf_masked,
    document_status = excluded.document_status;

  insert into public.inv_wallets(user_id, balance_inv)
  values (v_user_id, p_env)
  on conflict (user_id) do update set
    balance_inv = excluded.balance_inv,
    updated_at = now();

  select id into v_bot_id
  from public.bot_instances
  where user_id = v_user_id
  order by created_at desc
  limit 1;

  if v_bot_id is null then
    insert into public.bot_instances(user_id, mode, status, active_symbol, profile_name)
    values (v_user_id, 'paper'::public.bot_mode, 'inactive'::public.bot_status, 'BTCUSDT', 'conservador')
    returning id into v_bot_id;
  end if;

  insert into public.paper_wallets(user_id, bot_id, balance_usdt)
  select v_user_id, v_bot_id, p_demo_usdt
  where not exists (
    select 1 from public.paper_wallets pw where pw.user_id = v_user_id
  );

  return v_user_id;
end;
$$;

grant execute on function public.cadastrar_cliente_manual(text,text,text,text,text,numeric,numeric) to authenticated;

create or replace function public.cadastrar_cliente_site(
  p_email text,
  p_full_name text,
  p_phone text,
  p_cpf_hash text,
  p_cpf_masked text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_email is null or position('@' in p_email) <= 1 then
    raise exception 'E-mail invalido';
  end if;

  if p_full_name is null or length(trim(p_full_name)) < 3 then
    raise exception 'Nome invalido';
  end if;

  if p_phone is null or length(regexp_replace(p_phone, '\D', '', 'g')) < 10 then
    raise exception 'Telefone invalido';
  end if;

  if p_cpf_hash is null or length(trim(p_cpf_hash)) < 32 then
    raise exception 'CPF invalido';
  end if;

  return public.cadastrar_cliente_manual(
    p_email,
    p_full_name,
    p_phone,
    p_cpf_hash,
    p_cpf_masked,
    10,
    200
  );
end;
$$;

grant execute on function public.cadastrar_cliente_site(text,text,text,text,text) to anon, authenticated;
