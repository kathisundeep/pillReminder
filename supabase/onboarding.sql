-- PillReminder — registration, phone verification and profile details.
-- Run in the Supabase SQL Editor AFTER schema.sql, pairing.sql,
-- subscriptions.sql and hardening.sql. Safe to re-run.
--
-- Model: patient and guardian remain SEPARATE account types, and a phone number
-- may hold at most one of each. That is why the phone lives here rather than on
-- auth.users, whose `phone` column is globally unique and would block the
-- common case of one carer who also takes their own medicine.
--
-- Consequence: OTP cannot use Supabase's built-in phone auth. It runs through
-- the Edge Functions in supabase/functions/, which hold the service role. The
-- client never writes a verified phone and never creates its own account.

-- ===========================================================================
-- Profile details
--
-- Date of birth, not age: an age is wrong within a year and carries no record
-- of when it was true. Height in centimetres, not feet: one canonical unit,
-- rendered per the user's preference.
--
-- Weight is deliberately ABSENT. It already lives in public.health_readings
-- with a full history and trend; a second copy here would disagree with it
-- within a month. The signup value seeds the first reading instead.
-- ===========================================================================
alter table public.profiles add column if not exists phone             text;
alter table public.profiles add column if not exists phone_verified_at timestamptz;
alter table public.profiles add column if not exists full_name         text;
alter table public.profiles add column if not exists gender            text;
alter table public.profiles add column if not exists date_of_birth     date;
alter table public.profiles add column if not exists height_cm         numeric(5,1);
alter table public.profiles add column if not exists country           text;
-- Non-null once the details step has been completed OR skipped, so the app
-- knows never to ask again.
alter table public.profiles add column if not exists onboarded_at      timestamptz;

alter table public.profiles drop constraint if exists profiles_gender_check;
alter table public.profiles add constraint profiles_gender_check
  check (gender is null or gender in ('female', 'male', 'other', 'undisclosed'));

alter table public.profiles drop constraint if exists profiles_height_check;
alter table public.profiles add constraint profiles_height_check
  check (height_cm is null or (height_cm > 30 and height_cm < 280));

alter table public.profiles drop constraint if exists profiles_dob_check;
alter table public.profiles add constraint profiles_dob_check
  check (date_of_birth is null
         or (date_of_birth > date '1900-01-01' and date_of_birth <= current_date));

alter table public.profiles drop constraint if exists profiles_phone_check;
alter table public.profiles add constraint profiles_phone_check
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');   -- E.164

-- ONE patient account and ONE guardian account per number. A carer registering
-- their own patient account and a guardian account on the same phone is the
-- case this is built for.
drop index if exists public.profiles_phone_per_role;
create unique index profiles_phone_per_role
  on public.profiles (phone, is_guardian)
  where phone is not null;

-- ===========================================================================
-- Phone verification
--
-- Only the Edge Functions touch this table. No RLS policy is defined at all,
-- so the anon and authenticated roles can read nothing even by accident.
-- ===========================================================================
create table if not exists public.phone_verifications (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,
  is_guardian  boolean not null,
  code_hash    text not null,
  attempts     int not null default 0,
  consumed_at  timestamptz,
  -- Handed to the client on success and required to create the account, so a
  -- verified number cannot be swapped for an unverified one at the last step.
  claim_token  uuid not null default gen_random_uuid(),
  claimed_at   timestamptz,
  expires_at   timestamptz not null default now() + interval '10 minutes',
  created_at   timestamptz not null default now(),
  requested_ip text
);
create index if not exists phone_verifications_lookup_idx
  on public.phone_verifications (phone, is_guardian, created_at desc);

alter table public.phone_verifications enable row level security;
revoke all on public.phone_verifications from anon, authenticated;

-- ===========================================================================
-- Username availability
--
-- Every signup form needs this, and it necessarily confirms whether a name is
-- taken. That is a different exposure from the pairing oracle closed in
-- hardening.sql (SEC-04): this reveals only that a name exists, never ties a
-- name to a phone, and gives no foothold for guessing a pairing code. Rate
-- limiting is what keeps it from becoming a bulk enumeration tool.
-- ===========================================================================
create or replace function public.username_available(candidate text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (
    select 1 from public.profiles
    where lower(username) = lower(trim(candidate))
  );
$$;

grant execute on function public.username_available(text) to anon, authenticated;

-- Is this number already used by an account of this role?
create or replace function public.phone_available(candidate text, want_guardian boolean)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (
    select 1 from public.profiles
    where phone = candidate and is_guardian = want_guardian
  );
$$;

grant execute on function public.phone_available(text, boolean) to anon, authenticated;

-- ===========================================================================
-- Column guard: extend the SEC-03 trigger to cover the new identity columns.
--
-- A user may edit their own name, gender, date of birth, height and country.
-- They may NOT rewrite their username, role, or — crucially — their phone or
-- its verified timestamp, because the phone is a recovery credential. Changing
-- it goes through a fresh OTP and the Edge Function, never a direct update.
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
  new.id                := old.id;
  new.username          := old.username;
  new.is_guardian       := old.is_guardian;
  new.created_at        := old.created_at;
  new.phone             := old.phone;
  new.phone_verified_at := old.phone_verified_at;
  return new;
end;
$$;

drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

-- ===========================================================================
-- Retention: verification rows are short-lived and contain a phone number.
-- Keep them only as long as the rate-limit window needs.
-- ===========================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('prune-phone-verifications')
      where exists (select 1 from cron.job where jobname = 'prune-phone-verifications');
    perform cron.schedule(
      'prune-phone-verifications',
      '15 * * * *',
      $job$ delete from public.phone_verifications where created_at < now() - interval '24 hours'; $job$
    );
  else
    raise notice 'pg_cron is not enabled — verification rows will NOT be pruned automatically.';
  end if;
end $$;
