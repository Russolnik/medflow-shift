-- MedFlow collaborative shifts.
-- Apply after 001_medflow_state.sql. Existing personal states remain untouched.

create extension if not exists pgcrypto;

create table if not exists public.medflow_shifts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Рабочая смена',
  payload jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint medflow_shifts_payload_is_object check (jsonb_typeof(payload) = 'object')
);

create table if not exists public.medflow_shift_members (
  shift_id uuid not null references public.medflow_shifts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('owner','orderly','nurse','viewer')),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (shift_id, user_id)
);

create table if not exists public.medflow_shift_invites (
  code text primary key,
  shift_id uuid not null references public.medflow_shifts(id) on delete cascade,
  role text not null check (role in ('orderly','nurse','viewer')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);

create index if not exists medflow_shift_members_user_idx on public.medflow_shift_members(user_id);
create index if not exists medflow_shift_invites_shift_idx on public.medflow_shift_invites(shift_id);

alter table public.medflow_shifts enable row level security;
alter table public.medflow_shifts force row level security;
alter table public.medflow_shift_members enable row level security;
alter table public.medflow_shift_members force row level security;
alter table public.medflow_shift_invites enable row level security;
alter table public.medflow_shift_invites force row level security;

revoke all on public.medflow_shifts, public.medflow_shift_members, public.medflow_shift_invites from anon;
revoke all on public.medflow_shifts, public.medflow_shift_members, public.medflow_shift_invites from authenticated;
grant select, insert, update, delete on public.medflow_shifts to authenticated;
grant select, update, delete on public.medflow_shift_members to authenticated;
grant select on public.medflow_shift_invites to authenticated;

create or replace function public.medflow_is_shift_member(target_shift uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.medflow_shift_members
    where shift_id = target_shift and user_id = auth.uid()
  );
$$;

create or replace function public.medflow_shift_role(target_shift uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.medflow_shift_members
  where shift_id = target_shift and user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.medflow_is_shift_member(uuid) from public;
revoke all on function public.medflow_shift_role(uuid) from public;
grant execute on function public.medflow_is_shift_member(uuid) to authenticated;
grant execute on function public.medflow_shift_role(uuid) to authenticated;

drop policy if exists medflow_shifts_read_members on public.medflow_shifts;
create policy medflow_shifts_read_members on public.medflow_shifts
for select to authenticated using (public.medflow_is_shift_member(id));

drop policy if exists medflow_shifts_create_owner on public.medflow_shifts;
create policy medflow_shifts_create_owner on public.medflow_shifts
for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists medflow_shifts_update_workers on public.medflow_shifts;
create policy medflow_shifts_update_workers on public.medflow_shifts
for update to authenticated
using (public.medflow_shift_role(id) in ('owner','orderly','nurse'))
with check (public.medflow_shift_role(id) in ('owner','orderly','nurse'));

drop policy if exists medflow_shifts_delete_owner on public.medflow_shifts;
create policy medflow_shifts_delete_owner on public.medflow_shifts
for delete to authenticated using (owner_id = auth.uid());

drop policy if exists medflow_members_read_shift on public.medflow_shift_members;
create policy medflow_members_read_shift on public.medflow_shift_members
for select to authenticated using (public.medflow_is_shift_member(shift_id));

drop policy if exists medflow_members_manage_owner on public.medflow_shift_members;
create policy medflow_members_manage_owner on public.medflow_shift_members
for update to authenticated
using (public.medflow_shift_role(shift_id) = 'owner')
with check (public.medflow_shift_role(shift_id) = 'owner');

drop policy if exists medflow_members_remove_owner on public.medflow_shift_members;
create policy medflow_members_remove_owner on public.medflow_shift_members
for delete to authenticated using (public.medflow_shift_role(shift_id) = 'owner' or user_id = auth.uid());

drop policy if exists medflow_invites_read_owner on public.medflow_shift_invites;
create policy medflow_invites_read_owner on public.medflow_shift_invites
for select to authenticated using (public.medflow_shift_role(shift_id) = 'owner' or used_by = auth.uid());

create or replace function public.medflow_create_shift(
  shift_title text,
  member_name text,
  initial_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_shift_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(member_name), '') is null then raise exception 'Display name required'; end if;
  insert into public.medflow_shifts(owner_id, title, payload, client_updated_at)
  values (auth.uid(), coalesce(nullif(trim(shift_title), ''), 'Рабочая смена'), coalesce(initial_payload, '{}'::jsonb), now())
  returning id into new_shift_id;
  insert into public.medflow_shift_members(shift_id, user_id, display_name, role)
  values (new_shift_id, auth.uid(), trim(member_name), 'owner');
  return new_shift_id;
end;
$$;

create or replace function public.medflow_create_shift_invite(target_shift uuid, member_role text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare invite_code text;
begin
  if public.medflow_shift_role(target_shift) <> 'owner' then raise exception 'Owner role required'; end if;
  if member_role not in ('orderly','nurse','viewer') then raise exception 'Unsupported role'; end if;
  loop
    invite_code := upper(substr(gen_random_uuid()::text, 1, 8));
    begin
      insert into public.medflow_shift_invites(code, shift_id, role, created_by)
      values (invite_code, target_shift, member_role, auth.uid());
      return invite_code;
    exception when unique_violation then null;
    end;
  end loop;
end;
$$;

create or replace function public.medflow_join_shift(invite_code text, member_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare invite_row public.medflow_shift_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(member_name), '') is null then raise exception 'Display name required'; end if;
  select * into invite_row from public.medflow_shift_invites
  where code = upper(trim(invite_code)) for update;
  if invite_row.code is null then raise exception 'Invite not found'; end if;
  if invite_row.used_at is not null then raise exception 'Invite already used'; end if;
  if invite_row.expires_at < now() then raise exception 'Invite expired'; end if;
  insert into public.medflow_shift_members(shift_id, user_id, display_name, role)
  values (invite_row.shift_id, auth.uid(), trim(member_name), invite_row.role)
  on conflict (shift_id, user_id) do update
    set display_name = excluded.display_name, role = excluded.role, last_seen_at = now();
  update public.medflow_shift_invites set used_by = auth.uid(), used_at = now()
  where code = invite_row.code;
  return invite_row.shift_id;
end;
$$;

revoke all on function public.medflow_create_shift(text,text,jsonb) from public;
revoke all on function public.medflow_create_shift_invite(uuid,text) from public;
revoke all on function public.medflow_join_shift(text,text) from public;
grant execute on function public.medflow_create_shift(text,text,jsonb) to authenticated;
grant execute on function public.medflow_create_shift_invite(uuid,text) to authenticated;
grant execute on function public.medflow_join_shift(text,text) to authenticated;

drop trigger if exists medflow_shifts_set_updated_at on public.medflow_shifts;
create trigger medflow_shifts_set_updated_at
before update on public.medflow_shifts
for each row execute function public.medflow_set_updated_at();
