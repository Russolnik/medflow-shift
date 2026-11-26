-- Deliver shared-shift changes to connected MedFlow clients through Supabase Realtime.
do $$
begin
  alter publication supabase_realtime add table public.medflow_shifts;
exception
  when duplicate_object then null;
end
$$;
