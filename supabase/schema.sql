-- PillReminder — Supabase schema (Phase 0 + forward-declared tables)
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE where possible.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;      -- gen_random_uuid, digest()
-- pg_cron is used for 2-year history retention (Phase 2). Enable it in the
-- Dashboard: Database → Extensions → enable "pg_cron". Then the cron job at the
-- bottom of this file will work.

-- ===========================================================================
-- profiles: one row per auth user (both "users" and "guardians" are profiles)
-- ===========================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text unique not null,
  display_name text,
  push_token   text,
  is_guardian  boolean not null default false,   -- signed up via Guardian login
  settings     jsonb not null default '{"graceMinutes":30,"notifyMode":"missed","approvalRequired":true}'::jsonb,
  created_at   timestamptz not null default now()
);

-- Auto-create a profile when a new auth user signs up. The username is passed
-- in auth metadata at sign-up time (options.data.username).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, is_guardian)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text,1,8)),
    new.raw_user_meta_data->>'display_name',
    coalesce((new.raw_user_meta_data->>'is_guardian')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- guardian_links: an active link = a guardian who can access a user's data.
-- At most ONE active guardian per user (Phase 1); tier raises this later.
-- ===========================================================================
create table if not exists public.guardian_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  guardian_id uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'active',    -- active | deactivated
  permissions jsonb not null default '{"canView":true,"canRequestAdd":true}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (user_id, guardian_id)
);
-- Enforce a single ACTIVE guardian per user:
create unique index if not exists one_active_guardian_per_user
  on public.guardian_links (user_id) where (status = 'active');

-- ===========================================================================
-- pairing_codes: 6-digit codes the user shows; guardian consumes to link.
-- ===========================================================================
create table if not exists public.pairing_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  code_hash  text not null,                       -- sha256 of the 6-digit code
  status     text not null default 'active',      -- active | consumed | revoked
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index if not exists pairing_codes_user_idx on public.pairing_codes(user_id);

-- ===========================================================================
-- medicines (mirrors the current on-device shape)
-- ===========================================================================
create table if not exists public.medicines (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  name           text not null,
  form           text default 'Tablet',
  color          text default '#FFFFFF',
  times          text[] not null default '{}',    -- ['08:00','20:00']
  snooze_minutes int default 10,
  frequency      text default 'daily',            -- daily | weekly
  days_of_week   int[] default '{0,1,2,3,4,5,6}',
  tone_id        text default 'classic',
  alert_guardian boolean default true,
  created_at     timestamptz not null default now()
);
create index if not exists medicines_user_idx on public.medicines(user_id);

-- ===========================================================================
-- dose_history (2-year rolling retention — see cron at bottom)
-- ===========================================================================
create table if not exists public.dose_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  medicine_id uuid references public.medicines(id) on delete cascade,
  day         date not null,
  status      text not null,                       -- taken | snoozed | skipped | missed
  at          timestamptz not null default now()
);
create index if not exists dose_history_user_day_idx on public.dose_history(user_id, day);

-- ===========================================================================
-- health_readings (Phase 2 trackers: BP / sugar / cholesterol / weight …)
-- ===========================================================================
create table if not exists public.health_readings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,                       -- bp | sugar | cholesterol | weight
  values      jsonb not null,                      -- {systolic,diastolic} | {mgdl} | ...
  unit        text,
  measured_at timestamptz not null default now(),
  note        text
);
create index if not exists health_readings_user_idx on public.health_readings(user_id, type, measured_at);

-- ===========================================================================
-- action_requests: guardian-initiated changes awaiting user approval
-- ===========================================================================
create table if not exists public.action_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  guardian_id uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,                       -- add_medicine | edit_medicine
  payload     jsonb not null,
  status      text not null default 'pending',     -- pending | approved | rejected
  created_at  timestamptz not null default now()
);
create index if not exists action_requests_user_idx on public.action_requests(user_id, status);

-- ===========================================================================
-- Subscriptions / payments — Phase 3/4 STUBS (schema only; no charge logic yet)
-- ===========================================================================
create table if not exists public.plans (
  id            text primary key,                  -- 'free' | 'plus' | 'family'
  name          text not null,
  price_cents   int not null default 0,
  currency      text not null default 'INR',
  interval      text not null default 'month',
  max_guardians int not null default 1,
  features      jsonb not null default '{}'::jsonb
);

create table if not exists public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  plan_id            text not null references public.plans(id),
  status             text not null default 'active', -- active | canceled | past_due
  provider           text,                            -- razorpay | stripe (Phase 4)
  provider_ref       text,
  auto_renew         boolean not null default false,
  current_period_end timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions(user_id);

create table if not exists public.payment_methods (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  provider    text,
  brand       text,                                 -- visa | mastercard | upi
  last4       text,
  token_ref   text,                                 -- provider token (never raw card)
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

insert into public.plans (id, name, price_cents, currency, interval, max_guardians)
values ('free','Free',0,'INR','month',1)
on conflict (id) do nothing;

-- ===========================================================================
-- Helper: is auth.uid() an ACTIVE guardian of :target_user ?
-- ===========================================================================
create or replace function public.is_linked_guardian(target_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.guardian_links gl
    where gl.user_id = target_user
      and gl.guardian_id = auth.uid()
      and gl.status = 'active'
  );
$$;

-- ===========================================================================
-- Row-Level Security
-- ===========================================================================
alter table public.profiles        enable row level security;
alter table public.guardian_links  enable row level security;
alter table public.pairing_codes   enable row level security;
alter table public.medicines       enable row level security;
alter table public.dose_history    enable row level security;
alter table public.health_readings enable row level security;
alter table public.action_requests enable row level security;
alter table public.subscriptions   enable row level security;
alter table public.payment_methods enable row level security;
alter table public.plans           enable row level security;

-- plans: public read-only catalog (everyone can read; nobody writes via API)
drop policy if exists plans_read_all on public.plans;
create policy plans_read_all on public.plans for select using (true);

-- profiles: read own + linked user's profile; update own
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_linked_guardian(id)
         or id in (select guardian_id from public.guardian_links where user_id = auth.uid()));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid());

-- medicines / dose_history / health_readings: owner full; linked guardian read
do $$
declare t text;
begin
  foreach t in array array['medicines','dose_history','health_readings'] loop
    execute format('drop policy if exists %1$s_owner on public.%1$s;', t);
    execute format('create policy %1$s_owner on public.%1$s for all using (user_id = auth.uid()) with check (user_id = auth.uid());', t);
    execute format('drop policy if exists %1$s_guardian_read on public.%1$s;', t);
    execute format('create policy %1$s_guardian_read on public.%1$s for select using (public.is_linked_guardian(user_id));', t);
  end loop;
end $$;

-- guardian_links: user sees own; guardian sees links where they are guardian
drop policy if exists guardian_links_read on public.guardian_links;
create policy guardian_links_read on public.guardian_links for select
  using (user_id = auth.uid() or guardian_id = auth.uid());
-- (writes happen via Edge Functions using the service role, which bypasses RLS)

-- pairing_codes: only the owner can read/manage their codes
drop policy if exists pairing_codes_owner on public.pairing_codes;
create policy pairing_codes_owner on public.pairing_codes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- action_requests: user (owner) reads+updates; guardian inserts+reads own
drop policy if exists action_requests_user on public.action_requests;
create policy action_requests_user on public.action_requests for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists action_requests_guardian on public.action_requests;
create policy action_requests_guardian on public.action_requests for select
  using (guardian_id = auth.uid());
drop policy if exists action_requests_guardian_insert on public.action_requests;
create policy action_requests_guardian_insert on public.action_requests for insert
  with check (guardian_id = auth.uid() and public.is_linked_guardian(user_id));

-- subscriptions / payment_methods: owner only
drop policy if exists subscriptions_owner on public.subscriptions;
create policy subscriptions_owner on public.subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists payment_methods_owner on public.payment_methods;
create policy payment_methods_owner on public.payment_methods for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===========================================================================
-- 2-year history retention (Phase 2). Requires pg_cron extension enabled.
-- Uncomment after enabling pg_cron in Dashboard → Database → Extensions.
-- ===========================================================================
-- select cron.schedule(
--   'prune-dose-history',
--   '0 3 * * *',                                   -- daily at 03:00 UTC
--   $$ delete from public.dose_history where day < (current_date - interval '2 years'); $$
-- );
