-- Purge accounts left behind by the live test suite.
--
-- The live suite (__tests__/live/) deletes its own data rows on teardown, but
-- the anon key cannot delete auth.users. Run this in the Supabase SQL Editor
-- (Dashboard -> SQL -> New query) occasionally to remove the leftover accounts.
--
-- Every QA account is named qa_<runid>_<role>. Nothing else is touched.

-- 1. Preview what will go. ALWAYS run this first.
select id, email, created_at
from auth.users
where email like 'qa\_%@pillreminder.app'
order by created_at desc;

-- 2. Delete them. public.profiles (and everything referencing it) cascades
--    from auth.users via `on delete cascade`.
-- delete from auth.users
-- where email like 'qa\_%@pillreminder.app';

-- 3. Verify nothing QA-shaped is left.
-- select count(*) as leftover_profiles
-- from public.profiles
-- where username like 'qa\_%';
