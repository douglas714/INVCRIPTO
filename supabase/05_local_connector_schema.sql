-- INVCRIPTO IA - estrutura do conector local
-- Execute no Supabase SQL Editor após os scripts anteriores.

create table if not exists public.connector_nodes (
  id uuid primary key default gen_random_uuid(),
  node_key text not null unique,
  name text not null default 'INVCRIPTO Connector',
  status text not null default 'offline' check (status in ('online','offline','error')),
  public_ip text,
  app_version text,
  last_seen_at timestamptz,
  started_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.connector_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  command_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','done','error','cancelled')),
  attempts integer not null default 0,
  locked_by text,
  locked_at timestamptz,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.connector_logs (
  id uuid primary key default gen_random_uuid(),
  node_key text,
  user_id uuid references public.profiles(id) on delete set null,
  command_id uuid references public.connector_commands(id) on delete set null,
  level text not null default 'info' check (level in ('debug','info','warn','error')),
  event text not null,
  message text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.connector_nodes enable row level security;
alter table public.connector_commands enable row level security;
alter table public.connector_logs enable row level security;

drop policy if exists connector_nodes_read_admin on public.connector_nodes;
drop policy if exists connector_commands_own_or_admin on public.connector_commands;
drop policy if exists connector_logs_own_or_admin on public.connector_logs;

create policy connector_nodes_read_admin on public.connector_nodes
for select using (public.is_admin());

create policy connector_commands_own_or_admin on public.connector_commands
for all using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

create policy connector_logs_own_or_admin on public.connector_logs
for select using (user_id = auth.uid() or public.is_admin());

create index if not exists idx_connector_nodes_seen on public.connector_nodes(last_seen_at desc);
create index if not exists idx_connector_commands_pending on public.connector_commands(status, created_at);
create index if not exists idx_connector_commands_user_created on public.connector_commands(user_id, created_at desc);
create index if not exists idx_connector_logs_created on public.connector_logs(created_at desc);

do $$ begin
  create trigger connector_nodes_touch before update on public.connector_nodes for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger connector_commands_touch before update on public.connector_commands for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

create or replace function public.enqueue_connector_command(
  p_command_type text,
  p_payload jsonb default '{}'::jsonb,
  p_user_id uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_command_type is null or trim(p_command_type) = '' then
    raise exception 'Tipo de comando obrigatório.';
  end if;

  if p_user_id is null and not public.is_admin() then
    raise exception 'Usuário não identificado.';
  end if;

  if p_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Sem permissão para criar comando para outro usuário.';
  end if;

  insert into public.connector_commands(user_id, command_type, payload)
  values (p_user_id, upper(trim(p_command_type)), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

grant select on public.connector_nodes to authenticated;
grant select, insert, update on public.connector_commands to authenticated;
grant select on public.connector_logs to authenticated;
grant execute on function public.enqueue_connector_command(text, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
