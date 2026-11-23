-- Atomic optimistic updates for MedFlow collaborative shifts.
-- Apply after 002_shared_shifts.sql.

create or replace function public.medflow_update_shift(
  target_shift uuid,
  expected_updated_at timestamptz,
  next_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  shift_row public.medflow_shifts%rowtype;
  member_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  member_role := public.medflow_shift_role(target_shift);
  if member_role not in ('owner', 'orderly', 'nurse') then
    raise exception 'Write access required';
  end if;
  if next_payload is null or jsonb_typeof(next_payload) <> 'object' then
    raise exception 'Payload must be an object';
  end if;

  select * into shift_row from public.medflow_shifts
  where id = target_shift for update;
  if shift_row.id is null then raise exception 'Shift not found'; end if;

  if expected_updated_at is null or shift_row.updated_at <> expected_updated_at then
    return jsonb_build_object(
      'ok', false,
      'updated_at', shift_row.updated_at,
      'title', shift_row.title,
      'payload', shift_row.payload
    );
  end if;

  update public.medflow_shifts
  set payload = next_payload,
      client_updated_at = now()
  where id = target_shift
  returning * into shift_row;

  update public.medflow_shift_members
  set last_seen_at = now()
  where shift_id = target_shift and user_id = auth.uid();

  return jsonb_build_object(
    'ok', true,
    'updated_at', shift_row.updated_at,
    'title', shift_row.title
  );
end;
$$;

revoke all on function public.medflow_update_shift(uuid,timestamptz,jsonb) from public;
grant execute on function public.medflow_update_shift(uuid,timestamptz,jsonb) to authenticated;

create table if not exists public.medflow_shift_claims (
  shift_id uuid not null references public.medflow_shifts(id) on delete cascade,
  patient_id text not null,
  claimed_by uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shift_id, patient_id)
);

alter table public.medflow_shift_claims enable row level security;
alter table public.medflow_shift_claims force row level security;
revoke all on public.medflow_shift_claims from anon, authenticated;
grant select on public.medflow_shift_claims to authenticated;

drop policy if exists medflow_claims_read_members on public.medflow_shift_claims;
create policy medflow_claims_read_members on public.medflow_shift_claims
for select to authenticated using (public.medflow_is_shift_member(shift_id));

create or replace function public.medflow_claim_patient(target_shift uuid, target_patient text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare claim_row public.medflow_shift_claims%rowtype;
declare member_row public.medflow_shift_members%rowtype;
begin
  if public.medflow_shift_role(target_shift) not in ('owner', 'orderly') then
    raise exception 'Orderly access required';
  end if;
  insert into public.medflow_shift_claims(shift_id, patient_id, claimed_by)
  values (target_shift, target_patient, auth.uid())
  on conflict (shift_id, patient_id) do nothing;
  select * into claim_row from public.medflow_shift_claims
  where shift_id = target_shift and patient_id = target_patient;
  select * into member_row from public.medflow_shift_members
  where shift_id = target_shift and user_id = claim_row.claimed_by;
  return jsonb_build_object(
    'ok', claim_row.claimed_by = auth.uid(),
    'user_id', claim_row.claimed_by,
    'display_name', member_row.display_name,
    'claimed_at', claim_row.claimed_at
  );
end;
$$;

create or replace function public.medflow_transfer_patient(target_shift uuid, target_patient text, next_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare claim_row public.medflow_shift_claims%rowtype;
declare next_member public.medflow_shift_members%rowtype;
begin
  if public.medflow_shift_role(target_shift) not in ('owner', 'orderly') then
    raise exception 'Orderly access required';
  end if;
  select * into next_member from public.medflow_shift_members
  where shift_id = target_shift and user_id = next_user and role in ('owner', 'orderly');
  if next_member.user_id is null then raise exception 'Target worker not found'; end if;
  select * into claim_row from public.medflow_shift_claims
  where shift_id = target_shift and patient_id = target_patient for update;
  if claim_row.patient_id is null then
    insert into public.medflow_shift_claims(shift_id, patient_id, claimed_by)
    values (target_shift, target_patient, next_user);
  elsif claim_row.claimed_by <> auth.uid() and public.medflow_shift_role(target_shift) <> 'owner' then
    raise exception 'Only current worker or owner can transfer patient';
  else
    update public.medflow_shift_claims set claimed_by = next_user, updated_at = now()
    where shift_id = target_shift and patient_id = target_patient;
  end if;
  return jsonb_build_object('ok', true, 'user_id', next_user, 'display_name', next_member.display_name);
end;
$$;

create or replace function public.medflow_release_patient(target_shift uuid, target_patient text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare current_worker uuid;
begin
  select claimed_by into current_worker from public.medflow_shift_claims
  where shift_id = target_shift and patient_id = target_patient;
  if current_worker is null then return true; end if;
  if current_worker <> auth.uid() and public.medflow_shift_role(target_shift) <> 'owner' then
    raise exception 'Only current worker or owner can release patient';
  end if;
  delete from public.medflow_shift_claims where shift_id = target_shift and patient_id = target_patient;
  return true;
end;
$$;

revoke all on function public.medflow_claim_patient(uuid,text) from public;
revoke all on function public.medflow_transfer_patient(uuid,text,uuid) from public;
revoke all on function public.medflow_release_patient(uuid,text) from public;
grant execute on function public.medflow_claim_patient(uuid,text) to authenticated;
grant execute on function public.medflow_transfer_patient(uuid,text,uuid) to authenticated;
grant execute on function public.medflow_release_patient(uuid,text) to authenticated;
