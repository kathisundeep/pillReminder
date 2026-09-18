-- Guardian plans: 1 / 3 / 6 / 12 months × 1 / 2 / 3 guardians, and a TEST
-- checkout that activates a plan without taking money.
-- Run after subscriptions.sql and hardening.sql. Re-runnable.
--
-- The number of guardians a person may link comes from their active plan.
-- Without one (Free) it is 0: guardians need a plan. Links made before this
-- was introduced are left alone; only new links are refused.

alter table public.plans add column if not exists months int not null default 1;
alter table public.plans add column if not exists active boolean not null default true;

-- The old tiers are retired but kept, so existing subscription rows still
-- point at a real plan.
update public.plans set active = false where id in ('plus', 'family');
update public.plans set max_guardians = 0, months = 0 where id = 'free';

-- Prices in paise. Monthly: ₹150 / ₹250 / ₹300 for 1 / 2 / 3 guardians.
-- Longer plans: 5% off for 3 months, 10% off for 6, 15% off for 12 (rounded).
insert into public.plans (id, name, price_cents, currency, interval, max_guardians, months, features, active) values
  ('g1_m1',  '1 guardian · 1 month',     15000, 'INR', 'month', 1,  1, '{}'::jsonb, true),
  ('g2_m1',  '2 guardians · 1 month',    25000, 'INR', 'month', 2,  1, '{}'::jsonb, true),
  ('g3_m1',  '3 guardians · 1 month',    30000, 'INR', 'month', 3,  1, '{}'::jsonb, true),
  ('g1_m3',  '1 guardian · 3 months',    42500, 'INR', 'month', 1,  3, '{}'::jsonb, true),
  ('g2_m3',  '2 guardians · 3 months',   71000, 'INR', 'month', 2,  3, '{}'::jsonb, true),
  ('g3_m3',  '3 guardians · 3 months',   85500, 'INR', 'month', 3,  3, '{}'::jsonb, true),
  ('g1_m6',  '1 guardian · 6 months',    81000, 'INR', 'month', 1,  6, '{}'::jsonb, true),
  ('g2_m6',  '2 guardians · 6 months',  135000, 'INR', 'month', 2,  6, '{}'::jsonb, true),
  ('g3_m6',  '3 guardians · 6 months',  162000, 'INR', 'month', 3,  6, '{}'::jsonb, true),
  ('g1_m12', '1 guardian · 12 months',  153000, 'INR', 'month', 1, 12, '{}'::jsonb, true),
  ('g2_m12', '2 guardians · 12 months', 255000, 'INR', 'month', 2, 12, '{}'::jsonb, true),
  ('g3_m12', '3 guardians · 12 months', 306000, 'INR', 'month', 3, 12, '{}'::jsonb, true)
on conflict (id) do update
  set name = excluded.name,
      price_cents = excluded.price_cents,
      max_guardians = excluded.max_guardians,
      months = excluded.months,
      active = excluded.active;

-- How many guardians this person may have: the largest active, unexpired plan,
-- else 0.
create or replace function public.guardian_limit(target_user uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select max(p.max_guardians)
       from public.subscriptions s
       join public.plans p on p.id = s.plan_id
      where s.user_id = target_user
        and s.status = 'active'
        and (s.current_period_end is null or s.current_period_end > now())),
    0);
$$;
grant execute on function public.guardian_limit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- TEST checkout. Switch off by setting mock_payments to false once real
-- payments (Razorpay) activate plans from a verified webhook instead.
-- ---------------------------------------------------------------------------
create table if not exists public.app_config (
  key   text primary key,
  value jsonb not null
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;  -- functions only
insert into public.app_config (key, value) values ('mock_payments', 'true'::jsonb)
  on conflict (key) do nothing;

create or replace function public.mock_activate_plan(plan text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  me  uuid := auth.uid();
  p   record;
  ends timestamptz;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if coalesce((select value from public.app_config where key = 'mock_payments'), 'false'::jsonb) <> 'true'::jsonb then
    raise exception 'Test payments are switched off.';
  end if;

  select * into p from public.plans where id = plan and active and months > 0;
  if not found then raise exception 'That plan is not available.'; end if;

  -- A new purchase replaces the current plan.
  update public.subscriptions set status = 'canceled'
   where user_id = me and status = 'active';

  ends := now() + make_interval(months => p.months);
  insert into public.subscriptions (user_id, plan_id, status, provider, provider_ref, current_period_end)
    values (me, p.id, 'active', 'test', 'TEST-' || gen_random_uuid(), ends);

  return json_build_object('plan_id', p.id, 'current_period_end', ends);
end;
$$;
grant execute on function public.mock_activate_plan(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Pairing honours the plan: refused once the person's plan is full, instead of
-- silently replacing their current guardian.
-- ---------------------------------------------------------------------------
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
  generic_error constant text := 'That username and code do not match. Ask them to generate a new code.';
begin
  if gid is null then raise exception 'not authenticated'; end if;

  select count(*) into recent_failures
    from public.pairing_attempts
   where guardian_id = gid and succeeded = false and at > now() - interval '15 minutes';
  if recent_failures >= 10 then
    raise exception 'Too many attempts. Try again in 15 minutes.';
  end if;

  select id into target_id from public.profiles where lower(username) = lower(target_username);
  if target_id is null or target_id = gid then
    insert into public.pairing_attempts (guardian_id, target_username) values (gid, target_username);
    raise exception '%', generic_error;
  end if;

  select * into pc from public.pairing_codes
   where user_id = target_id and status = 'active'
     and code_hash = encode(digest(code, 'sha256'), 'hex')
     and expires_at > now()
   order by created_at desc limit 1;
  if pc is null then
    insert into public.pairing_attempts (guardian_id, target_username) values (gid, target_username);
    raise exception '%', generic_error;
  end if;

  lim := public.guardian_limit(target_id);
  select count(*) into active_ct from public.guardian_links
   where user_id = target_id and status = 'active' and guardian_id <> gid;

  if lim = 0 then
    raise exception '@% needs a plan that includes a guardian. They can choose one in Settings → Plans.', target_username;
  end if;
  if active_ct >= lim then
    raise exception '@%''s plan allows % guardian(s), and that many are linked. They can upgrade or remove one.', target_username, lim;
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

-- With several guardians, the person removes one at a time.
create or replace function public.remove_guardian(guardian uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.guardian_links set status = 'deactivated'
   where user_id = auth.uid() and guardian_id = guardian and status = 'active';
end;
$$;
grant execute on function public.remove_guardian(uuid) to authenticated;

notify pgrst, 'reload schema';
