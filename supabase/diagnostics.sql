-- Crash reports and a few usage counts, kept in this project rather than sent
-- to a third party. Run after schema.sql. Re-runnable.
--
-- Write-only for the app: a phone may add rows, and read none — not even its
-- own. Reading is for the dashboard (service role), so one account cannot
-- learn anything about another from this table.
--
-- Nothing personal goes in. `detail` carries counts and ids the app chose to
-- send (see src/utils/telemetry.js); never a medicine name, a phone number or
-- a health reading.

create table if not exists public.app_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  kind        text not null check (kind in ('crash', 'event')),
  name        text not null,
  detail      jsonb not null default '{}'::jsonb,
  app_version text,
  platform    text,
  created_at  timestamptz not null default now()
);

create index if not exists app_events_recent_idx on public.app_events (created_at desc);
create index if not exists app_events_kind_idx on public.app_events (kind, created_at desc);

alter table public.app_events enable row level security;

-- Insert only, and only under your own id.
drop policy if exists app_events_insert on public.app_events;
create policy app_events_insert on public.app_events for insert to authenticated
  with check (user_id is null or user_id = auth.uid());

revoke select, update, delete on public.app_events from anon, authenticated;
grant insert on public.app_events to authenticated;

-- ===========================================================================
-- Retention: diagnostics answer "what broke this week", so 90 days is plenty.
-- ===========================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('prune-app-events')
      where exists (select 1 from cron.job where jobname = 'prune-app-events');
    perform cron.schedule(
      'prune-app-events',
      '30 3 * * *',
      $job$ delete from public.app_events where created_at < now() - interval '90 days'; $job$
    );
  else
    raise notice 'pg_cron is not enabled — app_events will NOT be pruned automatically.';
  end if;
end $$;

notify pgrst, 'reload schema';
