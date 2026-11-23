-- Ask Supabase PostgREST to discover the shared-shift RPC functions created
-- by the previous migrations. This is safe to run repeatedly.
notify pgrst, 'reload schema';
