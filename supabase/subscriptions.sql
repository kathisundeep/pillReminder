-- PillReminder — Phase 3 subscriptions + multi-guardian tiers.
-- Run in the Supabase SQL Editor AFTER schema.sql and pairing.sql. Re-runnable.

-- Seed the plan catalog (free already inserted by schema.sql).
insert into public.plans (id, name, price_cents, currency, interval, max_guardians, features) values
  ('plus',   'Plus',   9900,  'INR', 'month', 3, '{"trackers":true,"historyYears":2}'::jsonb),
  ('family', 'Family', 19900, 'INR', 'month', 5, '{"trackers":true,"historyYears":2}'::jsonb)
on conflict (id) do update
  set name = excluded.name,
      price_cents = excluded.price_cents,
      max_guardians = excluded.max_guardians,
      features = excluded.features;

-- Multi-guardian: drop the strict single-active-guardian index; the pairing RPC
-- now enforces the per-plan limit instead.
drop index if exists public.one_active_guardian_per_user;

-- Helper: how many guardians is this user allowed (by their active plan)?
create or replace function public.guardian_limit(target_user uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select p.max_guardians
       from public.subscriptions s
       join public.plans p on p.id = s.plan_id
      where s.user_id = target_user and s.status = 'active'
      order by p.max_guardians desc
      limit 1),
    1);  -- default: free plan = 1 guardian
$$;

-- Replace pair_with_code to honour the plan limit.
--  * limit == 1  → new guardian REPLACES the old (change-guardian flow)
--  * limit  > 1  → add up to the limit, then reject with a clear message
create or replace function public.pair_with_code(target_username text, code text)
returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  target_id uuid;
  pc        record;
  gid       uuid := auth.uid();
  lim       int;
  active_ct int;
begin
  if gid is null then raise exception 'not authenticated'; end if;

  select id into target_id from public.profiles
    where lower(username) = lower(target_username);
  if target_id is null then raise exception 'user not found'; end if;
  if target_id = gid then raise exception 'cannot pair with yourself'; end if;

  select * into pc from public.pairing_codes
    where user_id = target_id and status = 'active'
      and code_hash = encode(digest(code, 'sha256'), 'hex')
      and expires_at > now()
    order by created_at desc limit 1;
  if pc is null then raise exception 'invalid or expired code'; end if;

  lim := public.guardian_limit(target_id);
  select count(*) into active_ct from public.guardian_links
    where user_id = target_id and status = 'active' and guardian_id <> gid;

  if active_ct >= lim then
    if lim = 1 then
      update public.guardian_links set status = 'deactivated'
        where user_id = target_id and status = 'active';   -- replace
    else
      raise exception 'guardian limit reached (%). Ask them to remove one or upgrade.', lim;
    end if;
  end if;

  update public.pairing_codes set status = 'consumed' where id = pc.id;

  insert into public.guardian_links (user_id, guardian_id, status)
    values (target_id, gid, 'active')
    on conflict (user_id, guardian_id) do update set status = 'active';

  return json_build_object('user_id', target_id, 'username', target_username);
end;
$$;

grant execute on function public.guardian_limit(uuid) to authenticated;
grant execute on function public.pair_with_code(text, text) to authenticated;
