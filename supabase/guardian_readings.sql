-- A linked guardian may record a health reading (BP, sugar, weight, …) for the
-- person they look after — at a clinic visit, say. Run after schema.sql and
-- hardening.sql. Re-runnable.
--
-- The reading still belongs to the person (user_id is theirs); recorded_by
-- says who entered it. The guardian may only ADD: edits and deletions stay
-- with the owner, under the existing health_readings_owner policy.

alter table public.health_readings
  add column if not exists recorded_by uuid references public.profiles(id) on delete set null;

drop policy if exists health_readings_guardian_insert on public.health_readings;
create policy health_readings_guardian_insert on public.health_readings for insert
  with check (public.is_linked_guardian(user_id) and recorded_by = auth.uid());

notify pgrst, 'reload schema';
