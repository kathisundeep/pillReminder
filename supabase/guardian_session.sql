-- One phone per guardian account. Run after schema.sql and hardening.sql.
-- Re-runnable.
--
-- When a guardian signs in, their session claims the account
-- (claim_guardian_session). Any other phone still signed in as that guardian
-- is then:
--   * refused the people's data — is_linked_guardian() is false for it;
--   * cut off from alerts — the claim clears push_token, and a stale phone
--     cannot write its own token back (trigger below);
--   * told to sign out by the app (guardian_session_check returns 'replaced').
-- The app also revokes the other sessions' refresh tokens at sign-in, so the
-- old phone cannot even renew its login.
--
-- Supabase puts the auth session id in every access token as `session_id`.

alter table public.profiles add column if not exists active_session_id uuid;

create or replace function public.jwt_session_id()
returns uuid
language sql stable
as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid;
$$;

-- True unless the caller is a guardian whose account has been claimed by a
-- different session. Patients are never restricted.
create or replace function public.session_is_current()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select not p.is_guardian
            or p.active_session_id is null
            or p.active_session_id = public.jwt_session_id()
       from public.profiles p where p.id = auth.uid()),
    true);
$$;
grant execute on function public.session_is_current() to authenticated;

create or replace function public.is_linked_guardian(target_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.guardian_links gl
    where gl.user_id = target_user
      and gl.guardian_id = auth.uid()
      and gl.status = 'active'
  ) and public.session_is_current();
$$;

-- Called at sign-in: this session now owns the guardian account.
create or replace function public.claim_guardian_session()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform set_config('app.claiming_session', 'on', true);
  update public.profiles
     set active_session_id = public.jwt_session_id(),
         push_token = null          -- the new phone registers its own
   where id = auth.uid() and is_guardian;
end;
$$;
grant execute on function public.claim_guardian_session() to authenticated;

-- The app asks on launch and when it comes back to the foreground.
--   'ok'       — carry on (claims an unclaimed account, e.g. a new one)
--   'replaced' — another phone signed in; sign out here
create or replace function public.guardian_session_check()
returns text
language plpgsql security definer set search_path = public
as $$
declare p record;
begin
  if auth.uid() is null then return 'ok'; end if;
  select is_guardian, active_session_id into p from public.profiles where id = auth.uid();
  if not found or not p.is_guardian then return 'ok'; end if;
  if p.active_session_id is null then
    perform public.claim_guardian_session();
    return 'ok';
  end if;
  if p.active_session_id = public.jwt_session_id() then return 'ok'; end if;
  return 'replaced';
end;
$$;
grant execute on function public.guardian_session_check() to authenticated;

-- A replaced phone must not take the account back, or put its own push token
-- back and keep receiving alerts. Only claim_guardian_session may move the
-- claim; only the current session may set the token.
create or replace function public.guard_guardian_session()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.active_session_id is distinct from old.active_session_id
     and coalesce(current_setting('app.claiming_session', true), '') <> 'on' then
    new.active_session_id := old.active_session_id;
  end if;
  if new.push_token is distinct from old.push_token
     and new.is_guardian
     and new.active_session_id is not null
     and new.active_session_id is distinct from public.jwt_session_id()
     and coalesce(current_setting('app.claiming_session', true), '') <> 'on' then
    new.push_token := old.push_token;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_guardian_session on public.profiles;
create trigger profiles_guard_guardian_session
  before update on public.profiles
  for each row execute function public.guard_guardian_session();

notify pgrst, 'reload schema';
