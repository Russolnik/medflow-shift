-- Explicit emergency takeover for a shared shift.
-- The client always asks for confirmation and records the previous worker in patient history.
create or replace function public.medflow_takeover_patient(target_shift uuid, target_patient text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_row public.medflow_shift_claims%rowtype;
  previous_member public.medflow_shift_members%rowtype;
  current_member public.medflow_shift_members%rowtype;
begin
  if public.medflow_shift_role(target_shift) not in ('owner', 'orderly') then
    raise exception 'Orderly access required';
  end if;

  select * into current_member
  from public.medflow_shift_members
  where shift_id = target_shift and user_id = auth.uid() and role in ('owner', 'orderly');
  if current_member.user_id is null then raise exception 'Current worker not found'; end if;

  select * into claim_row
  from public.medflow_shift_claims
  where shift_id = target_shift and patient_id = target_patient
  for update;

  if claim_row.patient_id is null then
    insert into public.medflow_shift_claims(shift_id, patient_id, claimed_by)
    values (target_shift, target_patient, auth.uid());
  else
    select * into previous_member
    from public.medflow_shift_members
    where shift_id = target_shift and user_id = claim_row.claimed_by;

    update public.medflow_shift_claims
    set claimed_by = auth.uid(), updated_at = now()
    where shift_id = target_shift and patient_id = target_patient;
  end if;

  return jsonb_build_object(
    'ok', true,
    'user_id', auth.uid(),
    'display_name', current_member.display_name,
    'previous_user_id', claim_row.claimed_by,
    'previous_display_name', previous_member.display_name
  );
end;
$$;

revoke all on function public.medflow_takeover_patient(uuid,text) from public;
grant execute on function public.medflow_takeover_patient(uuid,text) to authenticated;
notify pgrst, 'reload schema';
