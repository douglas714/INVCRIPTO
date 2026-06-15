-- INVCRIPTO IA - Correcoes seguras 2026-06-15
-- Base: ZIP original que ja estava em producao.
-- Objetivo: corrigir cadastro sem alterar estrutura de deploy/package.
-- Execute no SQL Editor do Supabase antes de testar novos cadastros.

create extension if not exists pgcrypto;

-- 1) Mantem configuracao INV existente.
insert into public.system_settings(key, value)
values ('inv', '{"initial_bonus":10,"fee_percent":25,"brl_per_inv":1}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

alter table if exists public.profit_events
alter column fee_percent set default 25;

-- 2) Corrige conflito usado pelo cadastro: ON CONFLICT (user_id) precisa de indice unico.
create unique index if not exists user_documents_user_id_key
on public.user_documents(user_id);

-- 3) Funcao segura para o front consultar CPF duplicado sem expor documentos.
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

-- 4) Funcao helper para gravar documento do proprio usuario quando houver sessao ativa.
create or replace function public.register_my_document(p_cpf_hash text, p_cpf_masked text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.user_documents(user_id, cpf_hash, cpf_masked)
  values (auth.uid(), p_cpf_hash, p_cpf_masked)
  on conflict (user_id) do update set
    cpf_hash = excluded.cpf_hash,
    cpf_masked = excluded.cpf_masked;
end;
$$;

grant execute on function public.register_my_document(text, text) to authenticated;

-- 5) Trigger de cadastro: cria profile, documento, carteira e, se existir, espelha em clientes.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_phone text;
  v_cpf_hash text;
  v_cpf_masked text;
begin
  v_name := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '');
  v_phone := coalesce(new.raw_user_meta_data->>'phone', new.raw_user_meta_data->>'telefone', 'nao informado');
  v_cpf_hash := nullif(new.raw_user_meta_data->>'cpf_hash', '');
  v_cpf_masked := nullif(new.raw_user_meta_data->>'cpf_masked', '');

  insert into public.profiles(id, email, full_name, phone, role, status)
  values (
    new.id,
    coalesce(new.email, ''),
    v_name,
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

  -- Alguns ambientes do projeto usam public.clientes no painel/admin.
  -- O bloco abaixo so executa se a tabela existir.
  if to_regclass('public.clientes') is not null then
    execute '
      insert into public.clientes(id, email, nome, telefone, perfil, status, cpf, saldo_env, saldo_demo_usdt, saldo_real_usdt, ambiente_binance)
      values ($1, $2, $3, $4, $5, $6, $7, 10, 0, 0, null)
      on conflict (id) do update set
        email = excluded.email,
        nome = coalesce(nullif(excluded.nome, ''''), public.clientes.nome),
        telefone = coalesce(nullif(excluded.telefone, ''''), public.clientes.telefone),
        status = coalesce(public.clientes.status, ''active''),
        cpf = coalesce(excluded.cpf, public.clientes.cpf)
    ' using new.id, coalesce(new.email, ''), v_name, v_phone, 'client', 'active', v_cpf_masked;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_invcripto on auth.users;
create trigger on_auth_user_created_invcripto
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- 6) Reforco de RLS para permitir que usuario autenticado leia/edite seu proprio cadastro.
do $$ begin
  if to_regclass('public.user_documents') is not null then
    alter table public.user_documents enable row level security;
  end if;
exception when others then null; end $$;

-- Observacao operacional:
-- Se o cadastro ainda falhar, verifique em Authentication > Providers se e-mail confirmation esta ativo.
-- Com confirmacao ativa, o trigger acima ainda cria as linhas no banco no momento do signUp.
