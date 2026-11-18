# MedFlow + Supabase

## Architecture

- Authentication: Supabase Auth, email + password.
- Browser credential: only the `sb_publishable_...` key.
- Database: one `public.medflow_states` JSONB row per authenticated user.
- Authorization: PostgreSQL Row Level Security checks `auth.uid() = user_id` for every operation.
- Offline mode: `localStorage` remains the immediate cache; Supabase synchronizes it when online.

Never place an `sb_secret_...`, legacy `service_role`, database password, or JWT signing secret in `dist/`, Git, browser storage, or Sites configuration exposed to client code.

## Apply

Run `migrations/001_medflow_state.sql` in the selected Supabase project. Then verify:

1. RLS is enabled on `public.medflow_states`.
2. `anon` has no table grants.
3. `authenticated` has only select/insert/update/delete.
4. A signed-in user can upsert only the row whose `user_id` equals their Auth user id.
5. The same user cannot select, update, or delete another user's row.

## Client configuration

The client needs only:

- project URL, such as `https://example.supabase.co`;
- publishable key beginning with `sb_publishable_`.

These identify the public application and are not treated as secrets. Data security comes from Auth sessions, grants, and RLS policies.

