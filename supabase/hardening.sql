-- PillReminder — security hardening.
-- Run in the Supabase SQL Editor AFTER schema.sql, pairing.sql and
-- subscriptions.sql. Safe to re-run.
--
-- Closes SEC-01 through SEC-04, DB-01 and DB-02 from docs/audit-report.md.
-- The premise throughout: the client is untrusted. The anon key ships inside a
-- decompilable APK, so anything the client is allowed to write, an attacker is
-- allowed to write.

-- ===========================================================================
-- SEC-01 — subscriptions must not be client-writable
--
-- Previously `subscriptions_owner ... for all` let any signed-in user insert an
-- active row for the 'family' plan and get the paid tier (and its raised
-- guardian limit) for free. Reads stay; writes move to the service role, which
-- is only reachable from an Edge Function invoked by a verified payment webhook.
-- ===========================================================================
drop policy if exists subscriptions_owner on public.subscriptions;

drop policy if exists subscriptions_read_own on public.subscriptions;
create policy subscriptions_read_own on public.subscriptions
  for select using (user_id = auth.uid());

-- Same reasoning for stored payment methods: the client may look, never write.
drop policy if exists payment_methods_owner on public.payment_methods;

drop policy if exists payment_methods_read_own on public.payment_methods;
create policy payment_methods_read_own on public.payment_methods
  for select using (user_id = auth.uid());

-- Nobody reaches these tables through PostgREST with the anon key at all.
revoke insert, update, delete on public.subscriptions   from anon, authenticated;
revoke insert, update, delete on public.payment_methods from anon, authenticated;

-- ===========================================================================
-- SEC-02 — cap the guardian request payload
--
-- medicines.photo is capped at 60 000 chars, but action_requests.payload is
-- unconstrained jsonb and the request flow puts a photo inside it. A malicious
-- or buggy guardian client could write arbitrarily large blobs into a patient's
-- row.
-- ===========================================================================
alter table public.action_requests
  drop constraint if exists action_requests_payload_size;
alter table public.action_requests
  add constraint action_requests_payload_size
  check (pg_column_size(payload) <= 80000);

-- ===========================================================================
-- SEC-03 — a user may edit their own profile, but not every column
--
-- `profiles_update ... using (id = auth.uid())` allowed changing `username`
-- (the identifier guardians pair against) and `is_guardian` (which decides
-- which flow the app enters). Only display_name, push_token and settings are
-- the user's to change.
-- ===========================================================================
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- The service role bypasses RLS and is trusted; only constrain end users.
  if auth.uid() is null then
    return new;
  end if;
  new.id          := old.id;
  new.username    := old.username;
  new.is_guardian := old.is_guardian;
  new.created_at  := old.created_at;
  return new;
end;
$$;

drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

-- ===========================================================================
-- SEC-04 — pairing: one generic error, and a real attempt limit
--
-- The old function distinguished 'user not found' from 'invalid or expired
-- code', which let any signed-in user enumerate accounts. It also had no
-- attempt counter against a 10^6 keyspace with 30-day codes.
-- ===========================================================================
create table if not exists public.pairing_attempts (
  id         uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references public.profiles(id) on delete cascade,
  target_username text not null,
  succeeded  boolean not null default false,
  at         timestamptz not null default now()
);
create index if not exists pairing_attempts_guardian_idx
  on public.pairing_attempts(guardian_id, at);

alter table public.pairing_attempts enable row level security;
-- No policy at all: only the security-definer function below touches this.
revoke all on public.pairing_attempts from anon, authenticated;

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
  recent_failures int;
  -- One message for every rejection, so nothing distinguishes "no such user"
  -- from "wrong code".
  generic_error constant text := 'That username and code do not match. Ask them to generate a new code.';
begin
  if gid is null then raise exception 'not authenticated'; end if;

  -- Rate limit: 10 failures in 15 minutes locks this guardian out of pairing.
  select count(*) into recent_failures
    from public.pairing_attempts
   where guardian_id = gid
     and succeeded = false
     and at > now() - interval '15 minutes';
  if recent_failures >= 10 then
    raise exception 'Too many attempts. Try again in 15 minutes.';
  end if;

  select id into target_id from public.profiles
    where lower(username) = lower(target_username);

  if target_id is null or target_id = gid then
    insert into public.pairing_attempts (guardian_id, target_username)
      values (gid, target_username);
    raise exception '%', generic_error;
  end if;

  select * into pc from public.pairing_codes
    where user_id = target_id and status = 'active'
      and code_hash = encode(digest(code, 'sha256'), 'hex')
      and expires_at > now()
    order by created_at desc limit 1;
  if pc is null then
    insert into public.pairing_attempts (guardian_id, target_username)
      values (gid, target_username);
    raise exception '%', generic_error;
  end if;

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

  insert into public.pairing_attempts (guardian_id, target_username, succeeded)
    values (gid, target_username, true);

  return json_build_object('user_id', target_id, 'username', target_username);
end;
$$;

grant execute on function public.pair_with_code(text, text) to authenticated;

-- ===========================================================================
-- DB-01 — `values` is a reserved SQL keyword
--
-- It works through PostgREST but breaks any hand-written SQL that does not
-- quote it. Renamed while the table is still small. Idempotent.
-- ===========================================================================
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'health_readings'
      and column_name = 'values'
  ) then
    alter table public.health_readings rename column "values" to reading_values;
  end if;
end $$;

-- ===========================================================================
-- DB-02 — 2-year retention, enforced by the server
--
-- The client-side pruneOldHistory() only runs when a user opens the app, so a
-- lapsed user kept their history forever. Requires the pg_cron extension:
-- Dashboard -> Database -> Extensions -> enable "pg_cron".
-- ===========================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('prune-dose-history')
      where exists (select 1 from cron.job where jobname = 'prune-dose-history');
    perform cron.schedule(
      'prune-dose-history',
      '0 3 * * *',
      $job$ delete from public.dose_history where day < (current_date - interval '2 years'); $job$
    );
  else
    raise notice 'pg_cron is not enabled — server-side retention was NOT scheduled.';
  end if;
end $$;
