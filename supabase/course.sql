-- Course length: "take this for 15 days".
--
-- A prescription is usually finite — an antibiotic for 7 days, a steroid taper
-- for 10 — and an alarm that keeps firing after the course has finished trains
-- people to ignore it, which is the one thing this app cannot afford.
--
-- Stored as two dates rather than a day count so the end never drifts: a count
-- has to be resolved against a start every time it is read, and any disagreement
-- about which day is "day 1" moves the end date.
--
-- end_date NULL means ongoing, which stays the default — most long-term
-- medicines genuinely have no end.

-- Existing medicines start on the day they were ADDED, not the day this ran:
-- stamping "today" on them hid their whole history from the calendar.
alter table public.medicines
  add column if not exists start_date date;
update public.medicines set start_date = created_at::date where start_date is null;
alter table public.medicines alter column start_date set default current_date;
alter table public.medicines alter column start_date set not null;

alter table public.medicines
  add column if not exists end_date date;

-- A course that ends before it starts would silently never be due.
alter table public.medicines drop constraint if exists medicines_course_order;
alter table public.medicines
  add constraint medicines_course_order
  check (end_date is null or end_date >= start_date);

comment on column public.medicines.start_date is
  'First day of the course. Defaults to the day the medicine was added.';
comment on column public.medicines.end_date is
  'Last day INCLUSIVE. NULL means ongoing with no planned end.';
