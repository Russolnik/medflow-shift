-- MedFlow MVP: one offline-first application state per authenticated user.
-- The browser uses only a Supabase publishable key. Access is enforced here.

create table if not exists public.medflow_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint medflow_states_payload_is_object
    check (jsonb_typeof(payload) = 'object')
);

alter table public.medflow_states enable row level security;
alter table public.medflow_states force row level security;

revoke all on table public.medflow_states from anon;
revoke all on table public.medflow_states from authenticated;
grant select, insert, update, delete on table public.medflow_states to authenticated;

drop policy if exists "medflow_select_own_state" on public.medflow_states;
create policy "medflow_select_own_state"
on public.medflow_states
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "medflow_insert_own_state" on public.medflow_states;
create policy "medflow_insert_own_state"
on public.medflow_states
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "medflow_update_own_state" on public.medflow_states;
create policy "medflow_update_own_state"
on public.medflow_states
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "medflow_delete_own_state" on public.medflow_states;
create policy "medflow_delete_own_state"
on public.medflow_states
for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.medflow_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.medflow_set_updated_at() from public;

drop trigger if exists medflow_states_set_updated_at on public.medflow_states;
create trigger medflow_states_set_updated_at
before update on public.medflow_states
for each row execute function public.medflow_set_updated_at();

