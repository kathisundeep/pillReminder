-- PillReminder — Phase 1 guardian pairing (RPC, no Edge Functions needed)
-- Run this in the Supabase SQL Editor AFTER schema.sql. Safe to re-run.

-- The user calls this to create a fresh 6-digit pairing code to hand to a
-- guardian. Revokes any previous unused codes. Returns the plaintext code once.
create or replace function public.generate_pairing_code()
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  new_code text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.pairing_codes set status = 'revoked'
    where user_id = auth.uid() and status = 'active';
  new_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into public.pairing_codes (user_id, code_hash, status, expires_at)
    values (auth.uid(),
            encode(digest(new_code, 'sha256'), 'hex'),
            'active',
            now() + interval '30 days');
  return new_code;
end;
$$;

-- A guardian calls this with the user's username + the 6-digit code. Validates,
-- consumes the code, deactivates any prior guardian (single-guardian rule), and
-- creates the active link. Raises on bad username/code/self-pair.
create or replace function public.pair_with_code(target_username text, code text)
returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  target_id uuid;
  pc        record;
  gid       uuid := auth.uid();
begin
  if gid is null then raise exception 'not authenticated'; end if;

  select id into target_id from public.profiles
    where lower(username) = lower(target_username);
  if target_id is null then raise exception 'user not found'; end if;
  if target_id = gid then raise exception 'cannot pair with yourself'; end if;

  select * into pc from public.pairing_codes
    where user_id = target_id
      and status = 'active'
      and code_hash = encode(digest(code, 'sha256'), 'hex')
      and expires_at > now()
    order by created_at desc
    limit 1;
  if pc is null then raise exception 'invalid or expired code'; end if;

  -- single active guardian per user: retire the previous one
  update public.guardian_links set status = 'deactivated'
    where user_id = target_id and status = 'active';

  update public.pairing_codes set status = 'consumed' where id = pc.id;

  insert into public.guardian_links (user_id, guardian_id, status)
    values (target_id, gid, 'active')
    on conflict (user_id, guardian_id) do update set status = 'active';

  return json_build_object('user_id', target_id, 'username', target_username);
end;
$$;

-- The user calls this to drop their current guardian and invalidate codes.
create or replace function public.revoke_guardian()
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.guardian_links set status = 'deactivated'
    where user_id = auth.uid() and status = 'active';
  update public.pairing_codes set status = 'revoked'
    where user_id = auth.uid() and status = 'active';
end;
$$;

grant execute on function public.generate_pairing_code()            to authenticated;
grant execute on function public.pair_with_code(text, text)         to authenticated;
grant execute on function public.revoke_guardian()                  to authenticated;
