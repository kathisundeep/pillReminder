-- Forgot password and change phone, by phone code. Run after onboarding.sql.
-- Re-runnable.
--
-- A verification now says what it is FOR. A code sent to sign up cannot reset
-- a password, and a code sent to reset a password cannot move an account to a
-- new number: verify-otp matches on purpose, and each function that spends a
-- claim checks it.

alter table public.phone_verifications
  add column if not exists purpose text not null default 'signup';

alter table public.phone_verifications
  drop constraint if exists phone_verifications_purpose_check;
alter table public.phone_verifications
  add constraint phone_verifications_purpose_check
  check (purpose in ('signup', 'reset', 'change_phone'));

notify pgrst, 'reload schema';
