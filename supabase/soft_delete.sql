-- Deleting a medicine keeps its history.
--
-- dose_history.medicine_id cascades, so removing the row erased every dose
-- ever recorded for it — past calendar days emptied and the adherence score
-- changed retrospectively. A medicine is now marked deleted instead, and
-- counts up to and including the day it was deleted.
--
-- Run after schema.sql. Re-runnable.

alter table public.medicines add column if not exists deleted_at timestamptz;

create index if not exists medicines_active_idx
  on public.medicines (user_id, deleted_at);

comment on column public.medicines.deleted_at is
  'When the user deleted this medicine. Null means active. Kept so its dose history stays readable.';

notify pgrst, 'reload schema';
