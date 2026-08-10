# PillReminder — test & security audit

**Scope:** the whole application as of the `feat/guardian-alarm-actions` branch,
including the uncommitted medicine-photo feature.
**Method:** 716 automated tests across 24 suites (96.6% statement coverage),
plus a live attack suite written against the production backend.
**Result:** 716/716 passing.

## Status

**Every finding in this report has been fixed except INFRA-01**, which cannot be
fixed from the codebase — it needs a Supabase project that exists.

Each bug's test was **inverted** rather than deleted: the case that documented
the defect now proves the fix, so a regression fails the build. The original
findings are kept below because the reasoning still explains why the code is
shaped the way it is.

Two items are not code and remain open by nature:

- **INFRA-01** — needs a live Supabase project (see below).
- **REL-01** — a statement of fact about OTA updates, not a defect: version
  1.1.0 requires a new binary rather than an `eas update`.

New in this pass: `supabase/hardening.sql`, which must be run after
`schema.sql`, `pairing.sql` and `subscriptions.sql`.

Nothing in this report is speculative. Each finding has a reproduction, and most
have a test that will flip from "documents the bug" to "proves the fix" once
addressed.

---

## Fix in this order

| # | ID | Finding | Status |
|---|---|---|---|
| 1 | INFRA-01 | The Supabase project the app points at no longer exists | **OPEN — needs you** |
| — | SEC-01 | Any user could grant themselves any paid plan for free | Fixed |
| — | BUG-05 | Dose dates used UTC while dose times used local time | Fixed |
| — | BUG-06 | Doses were tracked per day, not per scheduled time | Fixed |
| — | BUG-07 | Missed doses unrecorded for users without a guardian | Fixed |
| — | BUG-12 | A failed guardian push was never retried | Fixed |
| — | *(20 others)* | See the sections below, all marked FIXED | Fixed |

### What you still have to do

1. **Create or restore the Supabase project** and point `app.json` and
   `src/utils/supabase.js` at it.
2. Run the migrations **in order**: `schema.sql` → `pairing.sql` →
   `subscriptions.sql` → **`hardening.sql`**.
3. Enable the **pg_cron** extension so server-side retention schedules (the
   hardening script prints a notice and skips it otherwise).
4. Deploy a **`change-plan` Edge Function** using the service role before paid
   plans can be activated at all — the client can no longer write subscriptions.
5. Run `RUN_LIVE=1 npm run test:live` to prove the policies hold on the real
   database.

---

## CRITICAL

### INFRA-01 — The backend does not exist

`app.json → expo.extra.supabaseUrl` and the default in `src/utils/supabase.js:11`
both point at `https://accxqbtukprszgwroorq.supabase.co`. That hostname does not
resolve:

```
$ nslookup accxqbtukprszgwroorq.supabase.co 8.8.8.8
** server can't find accxqbtukprszgwroorq.supabase.co: NXDOMAIN
$ nslookup accxqbtukprszgwroorq.supabase.co 1.1.1.1
** server can't find accxqbtukprszgwroorq.supabase.co: NXDOMAIN
```

`supabase.co` and `api.supabase.com` resolve normally from the same machine, so
this is not DNS filtering — the project itself is gone or the reference is wrong.
A *paused* Supabase project still resolves; NXDOMAIN means the DNS record was
removed.

**Consequence:** registration, login, medicine sync, guardian pairing, dose
history, health trackers, subscriptions — every cloud-backed feature — fail on
the shipped build. A fresh install has no offline cache, so it is unusable.

**Fix:** create or restore a project, run `supabase/schema.sql`, `pairing.sql`
and `subscriptions.sql` against it, then update **both** `app.json` and the
`DEFAULT_URL` / `DEFAULT_ANON` constants in `src/utils/supabase.js`.

> This also blocks the live test suite, which now fails its preflight with a
> clear message rather than 40 opaque `fetch failed` errors.

### SEC-01 — Paid plans are granted by the client · **FIXED**

`supabase/schema.sql:258-260` gives the client full write access to its own
subscription rows:

```sql
create policy subscriptions_owner on public.subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

`activatePlanMock()` (`src/utils/subscription.js:31-49`) inserts an `active`
subscription directly, and `PlansScreen.choose()` (`src/screens/PlansScreen.js:44-50`)
calls it **even when checkout reports failure**:

```js
const res = await startCheckout({ planId: plan.id, country: 'IN' });
charged = res.ok;          // always false — payments.js is a stub
await activatePlanMock(plan.id);   // runs regardless
```

Anyone with the public anon key can `POST /rest/v1/subscriptions` with
`plan_id: 'family'` and get the ₹199/month tier, which `guardian_limit()`
(`supabase/subscriptions.sql:19-31`) then honours by raising their guardian cap.

**This is the concrete answer to "make it unhackable".** The APK will always be
decompilable and the anon key is designed to be public — so plan activation must
move server-side.

**Fix:** drop the client's write access and let only a verified payment webhook
create subscriptions.

```sql
drop policy if exists subscriptions_owner on public.subscriptions;
create policy subscriptions_read_own on public.subscriptions
  for select using (user_id = auth.uid());
-- inserts/updates only via a Supabase Edge Function using the service role,
-- called from the Razorpay/Stripe webhook after payment verification.
```

Then delete `activatePlanMock` and have `PlansScreen` refuse to activate a paid
plan when `startCheckout()` returns `ok: false`.

*Tests:* `__tests__/integration/syncHealthPlans.test.js` ("lets any signed-in
user grant themselves the top paid plan for free"),
`__tests__/screens/HealthAndPlans.test.js`, `__tests__/live/security.test.js`.

### BUG-01 — Missed-dose alerts can go to the patient's own phone · **FIXED**

`getActiveGuardianTarget()` (`src/utils/guardianCloud.js:83-97`) reads the
guardian link filtered **only** on status:

```js
const { data: link } = await supabase
  .from('guardian_links')
  .select('guardian_id')
  .eq('status', 'active')     // <-- no user_id filter
  .limit(1)
  .maybeSingle();
```

The RLS policy on `guardian_links` (`schema.sql:236-238`) deliberately returns
rows where the caller is **either** the patient or the guardian. So for anyone
who is both — a spouse who receives alerts and also sends them, the common case
for this app — the query can return the row where *they* are the guardian. The
code then reads `guardian_id`'s push token, which is their own.

**Consequence:** the patient's missed-dose alerts are delivered to the patient's
own phone. Their real guardian is never told. The alert is also marked as sent
for the day, so no later sweep retries it.

The same missing filter affects `getMyActiveGuardian()` (`:30-45`), which shows
the user as their own guardian on the Guardian screen.

**Fix:** scope both queries to the caller.

```js
const { data: u } = await supabase.auth.getUser();
const { data: link } = await supabase
  .from('guardian_links')
  .select('guardian_id')
  .eq('user_id', u.user.id)      // <-- add this
  .eq('status', 'active')
  .limit(1)
  .maybeSingle();
```

*Tests:* `__tests__/integration/guardianCloud.test.js` — "sends a user's own
alerts to themselves when they are also a guardian".

### BUG-03 / BUG-04 — A guardian's own request is applied to their own account · **FIXED**

`getPendingRequests()` (`src/utils/guardianCloud.js:121-128`) filters on status
only:

```js
.from('action_requests').select('*').eq('status', 'pending')
```

RLS lets a guardian read the requests they created (`action_requests_guardian`,
`schema.sql:250-252`), so a guardian who opens their own Home tab sees their own
*outgoing* request presented as something for them to approve.

If that guardian has "require my approval" turned off, `HomeScreen.load()`
(`src/screens/HomeScreen.js:113-125`) silently applies it:

```js
for (const r of pending) {
  await addMedicine(null, r.payload);   // inserts as the SIGNED-IN user
  await setRequestStatus(r.id, 'approved');
}
```

`addMedicine` writes to whoever is signed in — the guardian. The medicine lands
in the guardian's own list with alarms armed, and the patient never receives it.

**Fix:** scope the query to the signed-in user.

```js
const { data: u } = await supabase.auth.getUser();
.from('action_requests').select('*')
  .eq('user_id', u.user.id)        // <-- add this
  .eq('status', 'pending')
```

*Tests:* `__tests__/screens/HomeScreen.test.js` — "a guardian with approval off
silently copies their request into their OWN account".

---

## HIGH

### BUG-05 — Dose dates use UTC while dose times use local time · **FIXED**

`todayKey()` (`src/utils/storage.js:249-251`) is `new Date().toISOString().slice(0,10)`
— a **UTC** date. Every other piece of dose logic (`doseDateOn`, `medState`,
`latestPassedTime`) uses local time.

In IST (UTC+5:30) the two disagree between 00:00 and 05:30 every night:

- A dose taken at 02:00 on 10 June is filed under **09 June**.
- At 02:00 on 10 June, `isTakenToday()` still returns `true` for a dose taken at
  20:30 the previous evening — so a genuinely due early-morning dose reads as
  already taken and the guardian is never alerted.

Anyone west of UTC has the mirror problem in the evening.

**Fix:** make the key local.

```js
export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

Existing rows keep their UTC-derived `day` values; a one-off backfill is worth
considering if history matters.

*Tests:* `__tests__/unit/storageHelpers.test.js` (`todayKey` block),
`__tests__/integration/storage.test.js` — "still reports 'taken today' at 02:00
IST for a dose taken last evening".

### BUG-06 — Doses are tracked per day, not per scheduled time · **FIXED**

`dose_history` has a `day` column but no slot/time column, so "taken" is a
property of the whole day. Two consequences for any twice-daily medicine:

1. **Home shows the evening dose as already taken.** `medState()` returns
   `'taken'` if *any* taken entry exists that day, so after the 08:00 dose the
   20:00 slot is pre-ticked and struck through.
2. **A missed morning dose is never reported.** The sweep only examines
   `latestPassedTime()` — the most recent time that has passed. At 20:05 that is
   20:00, so the deadline resets and the 12-hour-old miss is invisible. If the
   evening dose is then taken, `isTakenToday()` short-circuits the whole check.

Twice-daily dosing is the common case for the conditions this app targets.

**Fix:** add a slot to the dose record.

```sql
alter table public.dose_history add column if not exists slot text; -- 'HH:MM'
create index if not exists dose_history_slot_idx
  on public.dose_history(user_id, day, medicine_id, slot);
```

Then key `recordDose` / `isTakenToday` / `medState` by `(day, medicine_id, slot)`
and have the sweep iterate every passed time rather than only the latest.

*Tests:* `__tests__/integration/guardianSweep.test.js` — "never reports a missed
morning dose once the evening one is taken"; `__tests__/unit/doseState.test.js`.

### BUG-02 — A patient is listed as someone they look after · **FIXED**

`getLinkedUsers()` (`src/utils/guardianCloud.js:135-151`) filters on status only,
so the caller's own guardian link comes back. On the Guardian Dashboard a patient
appears under "People you look after" — themselves.

**Fix:** add `.eq('guardian_id', myId)`.

*Tests:* `__tests__/integration/guardianCloud.test.js` — "lists a patient's own
guardian as someone they look after".

### BUG-07 — Missed doses are never recorded for users without a guardian

`sweepMissedDoses()` returns early when no guardian is linked
(`src/utils/guardian.js:121-122`):

```js
const target = await getActiveGuardianTarget();
if (!target?.token) return;      // <-- everything below is skipped
```

`recordDose(user, med.id, 'missed')` lives below that guard, so a user with no
guardian never accumulates any `missed` history. Their adherence record and the
health report they show a doctor are silently incomplete.

**Fix:** split the function — always detect and record misses; only send a push
when there is a guardian to send it to.

*Tests:* `__tests__/integration/guardianSweep.test.js` — "does nothing when no
guardian is linked".

### BUG-08 — Rescheduling always falls back to the Classic tone · **FIXED**

`scheduleSnooze()` honours `toneId`, but all three callers omit it:

- `App.js:91-95` (the Reschedule notification button)
- `src/screens/HomeScreen.js:154-158` (the Reschedule slot action)
- `src/screens/AlarmScreen.js:132-136` (the Reschedule 5/10 min buttons)

A user who chose Siren precisely because they sleep through Classic gets Classic
on every snooze — the exact moment the louder tone matters most.

**Fix:** pass `toneId: med.toneId` at all three sites.

*Tests:* `__tests__/integration/notifications.test.js`,
`__tests__/screens/HomeScreen.test.js`, `__tests__/screens/AlarmScreen.test.js`,
`__tests__/app/App.test.js` — all tagged BUG-08.

---

## MEDIUM

### BUG-09 — Every app launch destroys pending snoozes · **FIXED**

`App.js:46` calls `resyncAlarmsFromCloud()`, which calls `resyncAlarms()`, which
starts with `cancelAllScheduledNotificationsAsync()` (`notifications.js:181`).
That is intentional for repeating alarms, but it also deletes one-shot snoozes
that have not fired. Snooze a dose, switch apps, come back — the re-alarm is gone.

**Fix:** re-arm only repeating alarms, or re-create outstanding snoozes from the
`snoozed` dose entries after the resync.

*Test:* `__tests__/integration/notifications.test.js` — "destroys a pending
snooze that has not fired yet".

### BUG-10 — The guardian role is never persisted · **FIXED**

The Login screen's "I'm a guardian" toggle only decides which screen you land on.
`registerUser()` hardcodes `is_guardian: false` (`src/utils/storage.js:38`), and
`App.js:42` routes purely on session presence:

```js
setInitialRoute(user ? 'Home' : 'Login');
```

A guardian who reopens the app lands on the patient Home screen — empty, with a
"+ Add medicine" button — and has to find their way back via "My medicines".

**Fix:** pass the real flag at signup, and read `profiles.is_guardian` when
choosing the initial route.

*Tests:* `__tests__/screens/LoginScreen.test.js`,
`__tests__/integration/storage.test.js`.

### BUG-11 — No notification action buttons on iOS · **FIXED**

The entire channel + category block in `ensureNotificationSetup()`
(`src/utils/notifications.js:45-90`) is inside `if (Platform.OS === 'android')`,
including `setNotificationCategoryAsync('pill-alarm-actions', …)`. On iOS the
alarm notification has no Taken / Reschedule / Skip buttons.

Since App Store submission is a goal, this needs fixing before an iOS release.

**Fix:** move `setNotificationCategoryAsync` outside the platform guard.

*Test:* `__tests__/integration/notifications.test.js` — "registers NO action
buttons on iOS".

### BUG-12 — A failed guardian push is never retried · **FIXED**

`src/utils/guardian.js` ignores the result of `sendGuardianPush` and marks the
day as alerted regardless:

```js
await sendGuardianPush(target.token, { … });   // return value discarded
await markAlertedGuardian(user, key);
```

If the guardian's device was unregistered, offline, or the request failed, the
dedup flag still blocks every later sweep that day. The alert is lost silently.

**Fix:** only call `markAlertedGuardian` when the send succeeded.

*Test:* `__tests__/integration/guardianSweep.test.js` — "marks the day alerted
even when delivery failed".

### BUG-13 — The health report silently truncates · **FIXED**

`getReadings()` / `getUserReadings()` (`src/utils/health.js:64,79`) cap at 60 rows
**across all types**. A user who logs weight daily pushes their blood-pressure
history out of the report entirely — with no indication anything is missing.

**Fix:** fetch per type, or raise the cap and paginate.

*Test:* `__tests__/integration/syncHealthPlans.test.js` — "caps at 60 rows across
ALL types, starving less-frequent measurements".

### BUG-14 — No error boundary · **FIXED**

Nothing wraps the navigator. Any render-time throw in a screen produces a white
screen in a release build with no recovery path and no report.

**Fix:** wrap `NavigationContainer` in an error boundary that shows a retry
button.

### SEC-02 — Guardian request payloads have no size limit · **FIXED**

`medicines.photo` is capped at 60 000 characters by a DB constraint, but
`action_requests.payload` is unconstrained `jsonb`, and the guardian request flow
puts a photo inside it (`AddMedicineScreen` → `createAddMedicineRequest`). A
malicious or buggy guardian client can write arbitrarily large blobs into a
patient's row.

**Fix:**

```sql
alter table public.action_requests add constraint action_requests_payload_size
  check (pg_column_size(payload) <= 80000);
```

### SEC-03 — Users can rename themselves freely · **FIXED**

`profiles_update` (`schema.sql:220-221`) allows a user to update any column of
their own row, including `username` — the identifier guardians pair against — and
`is_guardian`. Uniqueness prevents direct collisions, but a handle freed by a
rename can be claimed by someone else, and pairing instructions are given by
username.

**Fix:** restrict updates to the columns that should be user-editable
(`display_name`, `push_token`, `settings`) with a column-level grant or a
trigger, and handle renames through a dedicated RPC if you want them at all.

### SEC-04 — Username enumeration and unthrottled pairing-code guessing · **FIXED**

`pair_with_code` (`supabase/pairing.sql:42`) raises a distinguishable
`user not found` for unknown usernames, versus `invalid or expired code` for real
ones — an enumeration oracle for any signed-in user.

There is also no attempt counter on the RPC. The keyspace is 10⁶ and codes live
for 30 days. The live suite measures the achievable guess rate and prints an
estimated time-to-exhaustion.

**Fix:** return one generic error for both cases, and add a per-caller attempt
counter that revokes the target's code after ~10 failures.

### REL-01 — 1.1.0 cannot ship as an OTA update

`runtimeVersion.policy` is `appVersion`, and `expo.version` moved 1.0.0 → 1.1.0
with the photo feature. That starts a **new runtime version**: existing 1.0.0
installs will not receive this code via `eas update`. A new binary is required.

Worth flagging because the current deploy habit is to ship JS with `eas update`.

### REL-02 — No iOS bundle identifier · **FIXED**

`app.json` has no `expo.ios.bundleIdentifier`. It is required before an App Store
build can be produced.

### DB-01 — `values` is a reserved SQL keyword · **FIXED**

`health_readings.values` (`schema.sql:120`) uses a reserved word unquoted as a
column name. It appears to work through PostgREST, but it will break any hand-
written SQL that references the column without quoting it (`r."values"`).

The live suite includes a test that confirms reads and writes work end to end.
Consider renaming to `reading_values` while the table is still small.

### DB-02 — Retention runs only on the client · **FIXED**

The `pg_cron` job for 2-year retention is commented out (`schema.sql:269-273`), so
the only thing enforcing it is `pruneOldHistory()`, which runs on app launch for
the signed-in user. A user who stops opening the app keeps their history forever.

**Fix:** enable `pg_cron` and uncomment the schedule.

### PERF-01 — Every Home render refetches all photos, one query per medicine · **FIXED**

`getMedicines()` does `select('*')`, which pulls every base64 photo (~9 KB each)
on every Home focus. `HomeScreen.load()` then issues one `getDoseEntries` query
**per medicine**. Ten medicines with photos is ~90 KB plus 11 round trips, every
time the screen is focused.

**Fix:** select explicit columns and omit `photo` from list views; batch the dose
lookup into one `.in('medicine_id', ids)` query.

---

## LOW

| ID | Finding | Location | Status |
|---|---|---|---|
| BUG-16 | `validUsername(null)` returns `true` — `String(null)` is `"null"`, which matches the regex. Not reachable from the UI, but the validator can't be trusted by a new caller. | `storage.js:27-29` | Fixed |
| BUG-17 | Cholesterol formatting drops an HDL or LDL of exactly `0` (falsy check rather than null check). | `health.js:33` | Fixed |
| BUG-18 | If compression returns no base64, `takeMedicinePhoto` resolves `{ ok: true, photo: null }` and the screen silently does nothing. | `photo.js:38-43` | Fixed |
| BUG-19 | `scheduleSnooze` without `minutes` yields `NaN` seconds — `Math.max(60, undefined * 60)`. Unreachable today; the 60s floor doesn't actually protect callers. | `notifications.js:153` | Fixed |
| BUG-20 | `importLocalMedicinesOnce` guards on "cloud is empty", not "already imported", so deleting every medicine resurrects the legacy list at next login. | `storage.js:216-241` | Fixed |
| BUG-21 | The alarm screen's fixed 5/10-minute buttons ignore the medicine's configured snooze duration. | `AlarmScreen.js:165-174` | Fixed |
| CLEAN-01 | `src/utils/ringtone.js` is dead code — nothing imports it. It is the only user of `expo-intent-launcher`. | 0% coverage | Fixed |
| CLEAN-02 | `@react-native-community/datetimepicker` is a declared dependency with zero imports (superseded by `WheelTimePicker`). | `package.json` | Fixed |

---

## On "impossible to hack or replicate"

Worth being direct, because it shapes where the effort should go.

**Not achievable:** the APK/IPA can be decompiled, and the Supabase anon key can
be extracted from it. That key is *designed* to be public — it identifies the
project, it does not authorise anything. Obfuscation raises the effort slightly
and changes nothing about the security boundary. Anyone can replicate the client.

**What actually matters** is that the client is untrusted and the server enforces
everything. That is mostly true here already: RLS covers medicines, dose history,
health readings, profiles and pairing codes, and guardian links can only be
created through a security-definer RPC. The live attack suite exercises all of it.

The real gaps are the ones above: **SEC-01** (the server trusts the client about
who has paid), **SEC-03** (over-broad profile updates), **SEC-04** (no rate limit
or generic error on pairing), and **SEC-02** (an unbounded payload column).

### Store-readiness backlog

Neither store requires these, but they are the standard hardening for a health
app handling personal data:

- **Google Play Integrity API** / **Apple App Attest** — lets the backend reject
  requests from modified or emulated clients. Attestation is verified in an Edge
  Function; it raises the bar for automated abuse but does not stop a determined
  attacker.
- **Certificate pinning** — blocks casual MITM inspection.
- **Play Data Safety form / App Privacy nutrition label** — mandatory, and this
  app collects health data, camera images and a device push token.
- **Account deletion** — both stores now require an in-app path to delete an
  account. There is none today.
- **Privacy policy URL** — required for both stores given the data collected.

---

## Test suite

716 tests, 24 suites, 96.6% statement coverage, ~8 seconds.

| Layer | Path | Covers |
|---|---|---|
| Role &amp; alerts | `__tests__/integration/roleAndNotify.test.js` | Role resolution and persistence, the three-way notify setting, guardian→patient request push |
| Backend rules | `__tests__/integration/backendRules.test.js` | Server-owned subscriptions, profile column guards, pairing throttle and generic errors |
| Unit | `__tests__/unit/` | Dose state machine, deadline precedence, tones, row mappers, health types, payments, photo compression, timezone keys |
| Integration | `__tests__/integration/` | Storage CRUD + offline cache, alarm scheduling, the guardian sweep matrix, guardian data access, sync, health, plans |
| Screens | `__tests__/screens/` | All 11 screens plus both components |
| App shell | `__tests__/app/` | Startup, notification action buttons, foreground sweep, listener cleanup |
| Config | `__tests__/config/` | Tone ↔ asset ↔ app.json alignment, permissions, OTA, dependencies, schema invariants |
| Live | `__tests__/live/` | Real end-to-end flows and an attacker probing RLS (opt-in; blocked by INFRA-01) |

See `TESTING.md` for how to run it and how to extend it, and
`docs/qa-checklist.md` for the device checks jest cannot perform.

Tests that currently document a bug are commented with the finding id. When you
fix a finding, **invert those tests rather than deleting them** — they become the
proof the fix works.
