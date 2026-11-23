-- gen_random_bytes() is not available in every Supabase Postgres setup.
-- UUID generation is already used by the MedFlow schema and gives us a
-- sufficiently random, user-friendly eight-character one-time invite code.
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

revoke all on function public.medflow_create_shift_invite(uuid,text) from public;
grant execute on function public.medflow_create_shift_invite(uuid,text) to authenticated;
notify pgrst, 'reload schema';
