# PillReminder — Functional Overview (Module by Module)

> **Purpose of this document.** A theoretical, prose-first explanation of *what every
> functional module does, what rules it obeys, and why it exists*. No code required to
> read it. For diagrams, data flow and decision logic see
> [`02-architecture.md`](./02-architecture.md).
>
> **Status:** describes the app as it exists on branch `feat/guardian-alarm-actions`
> (Phases P0–P4 merged). Payment charging is a deliberate stub.

---

## 0. The product in one paragraph

PillReminder is an Android-first medication adherence app. A patient registers with a
username and password, records the medicines they take and the times of day they take
them, and the phone then rings a full-screen, DND-bypassing alarm at each of those
times. Every response — *taken*, *snoozed*, *skipped*, or *no response at all* — is
written to an append-only adherence ledger in the cloud. A second person, the
**guardian**, can pair to the patient's account with a one-time 6-digit code; from
their own phone they can see the patient's medicine list and health readings, they
receive a push notification when a dose is missed, and they can *propose* new medicines
that the patient must approve. Alongside medication the app records blood pressure,
blood sugar, cholesterol and weight readings, and rolls them into a shareable summary
report. A plan/subscription layer exists and gates how many guardians a patient may
have; real money movement is not yet wired.

**Two roles, one account model.** "Patient" and "guardian" are not separate account
types. Every account is a `profiles` row and can do both jobs. The role is chosen at
the login screen and only decides which screen you land on — a guardian can tap
"My medicines" and immediately act as a patient, and vice-versa.

---

## 1. Module map

| # | Module | Owns | Primary files |
|---|--------|------|---------------|
| M1 | Identity & Session | registration, login, session persistence, role routing | `LoginScreen.js`, `utils/storage.js` (auth), `utils/supabase.js` |
| M2 | Medicine Catalogue | the medicine record and its editor | `AddMedicineScreen.js`, `components/*`, `utils/storage.js` (medicines) |
| M3 | Scheduling & Alarm Delivery | turning schedules into OS-level alarms | `utils/notifications.js`, `utils/sync.js`, `App.js` |
| M4 | Dose Response | the ringing screen and the notification action buttons | `AlarmScreen.js`, `App.js` listeners |
| M5 | Adherence Ledger & Today View | the dose log and the daily state machine | `HomeScreen.js`, `utils/storage.js` (history) |
| M6 | Guardian Pairing & Oversight | linking two accounts, guardian's read-only views | `GuardianScreen.js`, `GuardianDashboardScreen.js`, `GuardianUserScreen.js`, `utils/guardianCloud.js`, `supabase/pairing.sql` |
| M7 | Missed-Dose Detection & Alerting | the sweep, the grace rules, the push | `utils/guardian.js` |
| M8 | Approval Workflow | guardian proposes, patient consents | `ApprovalsScreen.js`, `action_requests` |
| M9 | Health Trackers & Report | vitals capture and summarisation | `TrackersScreen.js`, `HealthReportScreen.js`, `utils/health.js` |
| M10 | Plans, Subscriptions & Payments | tiering, entitlements, checkout stub | `PlansScreen.js`, `utils/subscription.js`, `utils/payments.js`, `supabase/subscriptions.sql` |
| M11 | Persistence, Offline & Retention | cloud/local split, caching, pruning | `utils/storage.js`, `utils/sync.js`, `supabase/schema.sql` |
| M12 | Platform, Permissions & Delivery | Android capabilities, build, OTA updates | `app.json`, `eas.json`, `expo-updates` |

---

## M1 — Identity & Session

### What it does

Registers and authenticates a person, remembers them across app launches, and decides
whether they enter the app as a patient or as a guardian.

### The design decision that shapes everything else

Supabase Auth is an **email/password** system, but the product deliberately asks for a
*username* instead — the target audience includes elderly users who may not have or
remember an email address. The module bridges this by manufacturing a **synthetic
email**: the username `raju` becomes `raju@pillreminder.app`, and that address is what
Supabase actually stores.

Two consequences follow directly:

1. **Usernames are globally unique for free.** The uniqueness constraint on the auth
   email does the work; no separate check is needed.
2. **There is no account recovery.** The mailbox does not exist, so "forgot password"
   and email verification cannot function. A forgotten password today means a lost
   account. This is the single largest functional gap in the product (see
   [`04-feature-inventory.md`](./04-feature-inventory.md)).

### Rules enforced

- **Username shape:** 3–30 characters, letters, digits, `_` or `.` only. Checked on
  registration; login accepts whatever is typed and simply fails to match.
- **Duplicate detection:** any Supabase error mentioning "already/exists/registered" is
  translated to the human-readable *"User already exists"*.
- **Login failures are deliberately vague** — always *"Invalid credentials"*, never
  "no such user", so the login form cannot be used to enumerate who has an account.
- **Register implies login.** After a successful sign-up the module immediately signs
  the person in, so registration never dead-ends on a login form.

### Session behaviour

The Supabase client is configured to persist its session into `AsyncStorage` and refresh
its own tokens. This means:

- Reading "who am I?" is a **local disk read, not a network call** — important, because
  it happens on every app launch, on every screen focus, and inside the background
  sweep, where the network may be unavailable.
- The app survives being killed and relaunched offline while still knowing its user.
- The rest of the app addresses the user in two different currencies: a **UUID**
  (`session.uid`) for every database row, and a **username string** for every piece of
  UI text and every guardian alert body.

### Role routing

The login screen carries an "I take medicines / I'm a guardian" toggle. On success it
routes to `Home` or `GuardianDashboard` respectively. Two things are worth stating
plainly, because they are easy to misread:

- The toggle is **presentational routing only**. It is not a permission boundary.
- An `is_guardian` flag *is* recorded on the profile at sign-up time, but nothing in the
  app currently reads it to gate behaviour. It exists for future use.

### Migration on first cloud login

The app previously stored medicines on-device per username. On the first patient login
the module looks for leftover local medicine lists and uploads them — but **only if the
cloud account has zero medicines**, which prevents a second device from duplicating an
already-migrated list. It reports how many were imported and is otherwise silent on
failure, because a failed migration must never block someone from getting into the app.

---

## M2 — Medicine Catalogue

### What a "medicine" is

A medicine is not a drug record; it is a **recurring instruction with an identity**:

| Attribute | Meaning | Why it exists |
|---|---|---|
| `name` | free text, e.g. "Paracetamol 500mg" | the only required identity |
| `form` | Tablet / Capsule / Syrup / Injection / Drops | recognition aid; shown next to the name |
| `color` | one of 8 named swatches | lets a non-reading user match the on-screen dot to the physical pill |
| `times` | list of `HH:MM` strings | *when*; drives alarm creation |
| `frequency` | `daily` or `weekly` | whether `daysOfWeek` applies |
| `daysOfWeek` | `0`(Sun)–`6`(Sat) | for weekly regimens; defaults to all 7 |
| `snoozeMinutes` | 5 / 10 / 15 / 30 | how long a reschedule defers the alarm |
| `toneId` | one of 5 bundled tones | different medicines can sound different |
| `alertGuardian` | boolean | per-medicine opt-out of guardian escalation |

Colour and form exist for a specific accessibility reason: they make the Today list
usable at a glance by someone who cannot comfortably read a list of similar drug names.

### The editor's three modes

The same screen serves three jobs, distinguished by navigation parameters:

1. **Create** (no params) — supports *batching*. The user picks a colour, types a name,
   taps *+ Add*, repeats. Every name entered becomes its **own independent medicine
   record**, but all of them inherit the one schedule configured below. This is the
   common real-world case: "these four tablets, all after dinner." Each entry keeps its
   own colour.
2. **Edit** (`medicineId`) — single medicine, pre-filled, plus a Delete affordance.
   Batching is disabled because editing many records through one form is ambiguous.
3. **Guardian request** (`requestUserId`) — an identical form, but Save does not write a
   medicine. It creates an *approval request* addressed to the patient (see M8). The
   title and button text change to make the difference visible.

### Input affordances and validation

- **Quick-add time chips** — Morning 08:00, Before lunch 12:30, After lunch 13:30,
  Evening 17:00, Before dinner 19:00, After dinner 21:00, Night 22:00. Tapping toggles.
  Most users never open the custom picker.
- **Custom time** — a scroll-wheel modal for hour/minute. Times are de-duplicated and
  kept sorted, so the Today view's slot grouping is stable.
- **Tone preview** — tapping a tone selects *and* plays it for ~2.5 seconds, then
  unloads the sound. Selecting a tone you have never heard is a poor experience for an
  alarm you must recognise while half asleep.
- **Validation gates:** at least one name; at least one time; if weekly, at least one
  day.

### The save contract

Saving is not just an insert. Because a changed schedule invalidates previously
registered OS alarms, every successful save (and every delete) **re-arms the alarms for
the entire account**, not just the edited medicine. The reasoning is covered in M3.

---

## M3 — Scheduling & Alarm Delivery

### The core problem

The app cannot rely on being running. Phones sleep, get killed by OEM battery managers,
and reboot. Therefore the app does not "wait" for a dose time — it **hands the schedule
to the operating system in advance** and lets Android wake it.

Each `HH:MM` in a medicine becomes one or more OS-registered repeating notifications:

- **Daily medicine** → one repeating daily trigger per time.
- **Weekly medicine** → one repeating weekly trigger per (time × selected day). A
  medicine at two times on three days registers six triggers.

### Why one notification channel per tone

On Android, a notification channel's sound is **immutable after creation** — the OS
gives the user final say over how a channel behaves, and the app cannot change it later.
So "let the user pick a tone per medicine" cannot be implemented by mutating one
channel. The module instead pre-creates **five channels, one per bundled tone**
(Classic, Chime, Bell, Siren, Gentle), and each scheduled alarm is routed to the channel
matching its medicine's tone.

All five alarm channels are configured to behave like alarms rather than messages:
maximum importance, bypass Do Not Disturb, a long three-pulse vibration pattern, and
public lock-screen visibility. A separate, softer **Guardian Alerts** channel (high, not
maximum) carries inbound alerts when the device is acting as a guardian — a guardian
being told about someone else's dose should not shriek like the patient's own alarm.
A legacy channel from an earlier version is deleted on setup so stale settings do not
linger.

### Actionable notifications

Every alarm notification carries three buttons — **Taken**, **Reschedule**, **Skip** —
so an alert can be resolved from the shade or lock screen without ever opening the app.
Notifications are sticky and do not auto-dismiss, so an unanswered alarm remains visible
as a reminder. Each carries the medicine's id and name in its payload, which is what
lets the app route the response correctly even after a cold start.

### The full-resync strategy

Whenever the schedule could have changed, the app **cancels every scheduled
notification and rebuilds the whole set from the current medicine list.** This happens
on app start, on login, after any add/edit/delete, and after approving a guardian
request.

This is a conscious trade of efficiency for correctness. The alternative — tracking and
surgically cancelling individual notification ids — is where duplicate and
phantom-alarm bugs come from: a leftover one-shot snooze from yesterday, a stale trigger
for a deleted medicine, or two triggers for the same time after an edit. A patient being
woken by a medicine they no longer take is a serious trust failure, so the module
prefers to rebuild from truth every time. Resulting notification ids are stored
**device-locally**, never in the cloud, because they are meaningless on another phone.

### Snooze semantics

A snooze is a **one-shot** notification `snoozeMinutes` in the future (floored at 60
seconds), not a change to the recurring schedule. The daily trigger still fires tomorrow
as normal. A snooze also writes a ledger entry, which is what allows the missed-dose
sweep to extend its deadline rather than declaring a dose missed while the patient is
legitimately still within a snooze window (M7).

---

## M4 — Dose Response

There are two ways a patient answers an alarm, and both must reach the same outcome.

### Path A — the notification's action buttons

Handled by a listener registered at app root, so it works from a cold start:

- **Taken** → log `taken`; if the patient opted into "also notify when I take a dose",
  push a courtesy notice to the guardian; land on Home.
- **Reschedule** → log `snoozed`; schedule a one-shot alarm using *that medicine's*
  configured snooze duration; land on Home.
- **Skip** → log `skipped`; immediately run the missed-dose sweep, because an explicit
  skip is exactly the event a guardian should learn about; land on Home.
- **Tapping the body** (no button) → open the full-screen alarm screen.

### Path B — the full-screen alarm screen

Deliberately maximal, for someone who may be asleep, distracted, or visually impaired:

- The screen is **kept awake** and the back gesture is disabled, so the alarm cannot be
  dismissed by reflex.
- The medicine's chosen tone plays **on loop at full volume**, in a "do not mix" audio
  mode so it will not be politely ducked under other audio. If the tone fails to load,
  it falls back to the default alarm sound — an alarm that is silent is worse than an
  alarm that is wrong.
- Vibration runs on a repeating pattern.
- The clock, the medicine name at 40pt, and four large targets: **Taken**,
  **Reschedule 5 min**, **Reschedule 10 min**, **Skip this dose**.
- Every exit path stops the sound, cancels vibration, releases the wake lock, logs the
  outcome, and replaces the screen with Home so the alarm cannot be re-entered by going
  back.

*Note:* the on-screen reschedule offers a fixed 5/10 minutes, whereas the notification
button honours the medicine's configured snooze. This inconsistency is tracked in the
feature inventory.

### Foreground behaviour

If an alarm arrives while the app is already open, a received-notification listener
navigates straight to the full-screen alarm rather than showing a banner the user might
swipe away.

---

## M5 — Adherence Ledger & Today View

### The ledger is append-only

Dose history is not a per-day status field that gets overwritten. It is a **log of
events**: `(user, medicine, day, status, timestamp)` with status in
`taken | snoozed | skipped | missed`. A single dose can accumulate several rows —
snoozed, snoozed again, finally taken.

This choice is what makes the rest of the system possible: adherence reporting, the
snooze-aware missed-dose deadline (M7), and any future clinical export all need the
sequence of events, not just the final verdict. The one place the app does delete is
un-ticking a medicine on Home, which removes that day's `taken` rows for it.

### Deriving "today's state"

Today's list is not stored; it is **computed** from the medicine's schedule plus its
ledger entries, in strict precedence order:

1. any `taken` entry → **taken** (terminal; wins over everything)
2. any `skipped` entry → **skipped**
3. a `snoozed` entry whose snooze window has not yet elapsed → **snoozed**
4. otherwise, if a scheduled time today has already passed → **pending**
5. otherwise → **upcoming**

Medicines not scheduled for today's weekday are filtered out of the main list entirely
and shown in a separate, dimmed **"Other days"** section — visible for reassurance,
impossible to confuse with today's work.

### Time-slot grouping

The Today view groups by **time**, not by medicine. All medicines due at 08:00 form one
card. This mirrors the physical act — people take a handful of pills at once, not one
medicine at a time — and it enables the batch actions **✓ Taken / Reschedule / ✗ Skip**
that resolve an entire slot in one tap. A slot is *done* when every medicine in it is
taken, *due* when any is pending, and *upcoming* otherwise; the card's colour and badge
follow that state.

Individual medicines remain independently tappable (toggle taken) and long-pressable
(edit/delete), so the batch shortcut never removes precision.

### What Home does on every focus

Home is the app's reconciliation point. Each time it gains focus it re-reads the
session (bouncing to Login if it evaporated), reloads medicines and today's ledger,
recomputes states, **runs the missed-dose sweep** to catch up on anything that happened
while the app was closed, and checks for pending guardian requests — auto-applying them
if the patient has turned approval off, or surfacing a badge if not. Pull-to-refresh
runs the same routine on demand.

---

## M6 — Guardian Pairing & Oversight

### The trust model

Linking two accounts must satisfy three constraints at once: the patient must
*consent*; the flow must be usable by someone who cannot copy a UUID or click a deep
link; and possession of the credential must not be enough on its own.

The answer is a **6-digit one-time pairing code plus the patient's username**. The
patient generates a code and reads it out, texts it, or uses the share sheet; the
guardian types the username and the code on their own phone. Two facts are needed, not
one, and the code is worthless without knowing whose account it belongs to.

### Rules of the pairing lifecycle

- Codes are **hashed (SHA-256) before storage**. The database never holds the plaintext;
  the plaintext is returned exactly once, to the patient who asked for it.
- Generating a new code **revokes all previous unused codes** for that patient. There is
  never more than one live code.
- Codes **expire after 30 days**.
- A code is **consumed** the moment it is used successfully.
- **Self-pairing is rejected.**
- Validation and link creation happen **inside the database**, in privileged functions,
  not in the app. A tampered client cannot forge a link, because the client is never
  the thing that decides.
- **Revocation is unilateral and immediate.** The patient can remove their guardian at
  any time, which deactivates the link and kills outstanding codes.

### How many guardians?

The patient's plan decides (M10). On the free tier the limit is one, and the semantics
are deliberately *replace, not reject*: a new guardian pairing silently retires the
previous one, which is what "change my guardian" should feel like. On a multi-guardian
plan, guardians are added up to the limit and the next attempt fails with an explicit
message naming the limit.

### What a guardian can see and do

Once linked, a guardian gets a dashboard listing everyone they look after, and per
person:

- **Read** that person's medicine list — name, form, colour, times, snooze, tone.
- **Read** that person's health report (M9).
- **Propose** a new medicine, which becomes an approval request (M8).
- **Receive** missed-dose and skipped-dose push alerts (M7).

A guardian can never write to a patient's records directly. Every guardian-originated
change is a proposal.

### What the patient controls

From their own Guardian screen the patient sets:

- **Grace period** — 5 / 15 / 30 / 60 minutes of lateness tolerated before an alert.
- **Notify on taken** — off by default; when on, the guardian also gets a positive
  "dose taken" notice, not only bad news.
- **Require approval** — on by default; when off, guardian proposals are applied
  automatically the next time the patient's app reconciles.

---

## M7 — Missed-Dose Detection & Alerting

This is the module that makes the product more than a louder alarm clock.

### The detection question

*"Is this medicine late enough, right now, that a human being should be told?"*

Answering it requires distinguishing four situations that look identical if you only
store a final status: not yet due; due and unanswered; deliberately deferred; and
deliberately refused. The append-only ledger (M5) is what makes them separable.

### The rule, stated precisely

For each medicine, on each sweep:

1. **Skip it** if the patient turned off `alertGuardian` for that medicine.
2. **Skip it** if today's weekday is not in its schedule.
3. Find the **most recent scheduled time today that has already passed**. If none, the
   medicine is not due yet — skip.
4. **Skip it** if the ledger already shows `taken` today.
5. Compute the **deadline** by precedence:
   - an explicit **Skip** → `skip time + grace`
   - else a **Snooze** → if the snooze re-alarm has not yet fired, skip entirely
     (the patient is legitimately still inside their own window); otherwise
     `snooze re-alarm time + grace`
   - else → `scheduled dose time + grace`
6. **Skip it** if now is before the deadline.
7. **Skip it** if this medicine has already generated an alert today.
8. Otherwise: **push the guardian**, mark the medicine as alerted for today, and write a
   `missed` entry to the ledger.

Two details carry most of the value. **Snooze extends the deadline** rather than
suppressing it — a patient can defer, but not indefinitely without their guardian
learning. And **skip is escalated, not accepted** — pressing Skip is a signal, not
permission, though the grace period still gives the patient a window to change their
mind before the guardian is bothered.

Alerts are worded differently for the two cases: *"…skipped X and has not taken it"* vs
*"…has not taken X (due 8:00 AM)"*, both closing with *"Please check on them."*

### Once per medicine per day

Alert de-duplication is tracked on the patient's device, keyed by medicine and date,
with only the last seven days retained. This is a hard requirement: the sweep runs from
three different triggers, and a guardian who is pinged every fifteen minutes will mute
the app, at which point the entire safety feature is worthless.

### Three triggers, defence in depth

| Trigger | Fires when | Covers |
|---|---|---|
| Background task | roughly every 15 min (Android's floor), surviving app termination and reboot | the app is not running |
| App foreground | every return to the app | the background task was throttled |
| Home screen focus / pull-to-refresh | every visit to Home | belt and braces, and gives instant feedback |

Explicit Skip also fires a sweep immediately.

### How the push actually travels

The alert is sent **from the patient's device directly to Expo's push service**, using
the guardian's push token, which the patient's app reads from the guardian's profile.
There is no server in the path.

This is the module's principal architectural weakness and is called out honestly here:
if the patient's phone is off, offline, or has been killed by an aggressive battery
manager, **the alert is never sent** — and that is precisely the scenario in which a
guardian most wants to be told. It also means a patient's client handles a guardian's
push token. Moving detection server-side is the highest-value item in the forward plan
(see Sprint 6 in [`03-sprint-plan.md`](./03-sprint-plan.md)).

The whole sweep is written to never throw. It runs inside a background task, and a crash
there costs the OS's willingness to schedule it again.

---

## M8 — Approval Workflow

### Why proposals instead of writes

A guardian is trusted, but a guardian editing a patient's medication list without their
knowledge is a safety and dignity problem — the patient is the one who will be woken by
the alarm. So the system separates *intent* from *effect*: the guardian records an
intent, the patient converts it into effect.

### The flow

1. From a linked patient's screen the guardian opens the normal medicine form in
   **request mode** and submits. The full medicine payload is stored as a **pending
   request** addressed to that patient. Batched names become one request each.
2. The patient's Home screen surfaces an orange banner — *"N guardian requests to
   review"*.
3. On the Approvals screen the patient sees exactly what is proposed (name, form,
   times) and chooses **Approve** or **Reject**.
4. **Approve** → the medicine is inserted **by the patient's own session**, so
   ownership is unambiguous; the request is marked approved; alarms are re-armed so the
   new medicine starts ringing immediately.
5. **Reject** → the request is marked rejected and nothing else happens.

### The consent bypass

A patient who finds approval tedious can switch off "require my approval". Pending
requests are then applied automatically during the next reconciliation, with alarms
re-armed afterwards. This is genuine consent, given once, in advance, by the patient —
and it is reversible at any time.

### Known gap

Nothing pushes a notification to the patient when a request arrives; they discover it
the next time they open the app. Likewise the guardian is never told whether their
request was approved or rejected. Both are tracked in the inventory.

---

## M9 — Health Trackers & Report

### What is tracked

Four reading types, each with its own shape:

| Type | Fields | Unit |
|---|---|---|
| Blood pressure | systolic, diastolic | mmHg |
| Blood sugar | value | mg/dL |
| Cholesterol | total, HDL, LDL | mg/dL |
| Weight | value | kg |

Values are stored as a **flexible JSON blob** rather than fixed columns. Adding SpO₂,
heart rate, temperature or HbA1c later is a client-side addition, with no database
migration — the schema was chosen for that extensibility.

Every reading carries a measurement timestamp and an optional free-text note; the note
placeholder ("e.g. fasting, after food") is doing real clinical work, since a sugar
reading without that context is close to meaningless.

### Capture

One screen: pick a type, and the form re-renders to that type's fields. Numeric
keyboards, all fields required and validated as numbers, unit shown but not editable.
Saving clears the form and refreshes the list of recent readings below, so entering
several readings in a row is fast. Long-press deletes.

### Reporting

The report groups readings by type and, for each, shows the **latest** value plus
**average, minimum, maximum and sample count** per field. It is intentionally plain
text and numbers — no charts.

Two things about it matter:

- **Guardians can view it.** The same screen serves the patient's own report and a
  guardian's view of a linked patient's report, differing only by whose id it loads.
- **It can leave the app.** A Share button emits a plain-text summary into any app —
  WhatsApp, SMS, email. For a patient walking into a ten-minute appointment, "here are
  my last two months of readings" in a message is the actual, achievable version of
  interoperability.

*Current limitation:* the report reads a bounded window of the most recent readings
across all types together, so a very active user's report can be truncated. Per-type
windowing and trend charts are tracked in the inventory.

---

## M10 — Plans, Subscriptions & Payments

### The catalogue

| Plan | Price | Guardians |
|---|---|---|
| Free | ₹0 | 1 |
| Plus | ₹99 / month | 3 |
| Family | ₹199 / month | 5 |

Plans live in a **database table, not in the app binary**, and are readable by everyone.
Pricing and limits can therefore be changed server-side without shipping an update — the
right call for a consumer app that will experiment with pricing.

### The entitlement that actually bites

Exactly one entitlement is enforced today: **how many guardians a patient may have**.
It is checked inside the pairing function at pair time, reading the patient's active
plan and defaulting to 1 when there is no subscription. Enforcement is server-side, in
the same privileged function that creates the link, which is the only place it can be
trusted.

Everything else the plans screen lists — trackers, 2-year history — is currently
available on every tier, including Free. The tiers are not yet meaningfully
differentiated; deciding what genuinely belongs behind the paywall is a product
decision the forward plan schedules explicitly.

### Payments: an honest stub

There is no charging. Choosing a paid plan calls a checkout function that returns
"not enabled", after which the app **activates the plan anyway in test mode** and says
so in plain language: *"Online payment isn't enabled yet — no charge was made."*
Subscriptions get a period end one month out and no auto-renew.

The scaffolding around the hole is real and reflects a deliberate market decision:
**Razorpay for India** (UPI, cards, and UPI AutoPay / e-NACH for recurring debit),
**Stripe for the US and Canada** (cards and Stripe Billing), selected by the user's
country at checkout. Database tables for subscriptions and payment methods already
exist and are shaped to store **provider tokens only, never raw card data**.

The remaining work is not the button — it is the trustworthy part: a server-side
webhook that verifies the payment and flips the subscription, so entitlement can never
be granted by a client claim.

---

## M11 — Persistence, Offline & Retention

### What lives where, and why

| Data | Location | Reason |
|---|---|---|
| Auth session | device | must be readable offline, on every launch |
| Profiles, guardian links, pairing codes | cloud | shared between two accounts; must be tamper-proof |
| Medicines | cloud, **mirrored to a device cache** | shared with guardian; cache keeps alarms alive offline |
| Dose history | cloud | the record of truth; feeds reports and detection |
| Health readings | cloud | shared with guardian |
| Subscriptions | cloud | entitlement must not be client-editable |
| **Notification ids** | device only | meaningless on any other phone |
| **Push token** | device **and** profile | needed locally, and by the paired patient to reach this guardian |
| **Alert de-dup marks** | device only | ephemeral, 7-day window |

### Offline behaviour

Reading the medicine list writes a local mirror on every success and **falls back to
that mirror on any failure**. This is what keeps the product safe on a patient's phone
with no data: alarms were registered with the OS in advance, and the alarm screen can
still resolve the medicine's name and tone from the cache. Writes are not queued — a
dose recorded while offline is lost. An offline write queue is an open item.

### Retention

Dose history is kept for **two years** on a rolling basis. A nightly database job is the
intended mechanism (its definition ships commented out, pending the scheduler extension
being enabled); until then a client-side prune runs at app start and deletes the signed-in
user's rows older than two years. Two years is long enough to be clinically useful and
short enough to bound storage and privacy exposure.

### Security posture

The app ships a **public** project URL and publishable key. That is by design: the
security boundary is not secrecy of the key, it is **row-level security in the
database**, which the next document sets out in a table. Every table denies by default
and is opened only by explicit policy: owners get full access to their own rows; a
linked guardian gets read access to medicines, dose history and health readings; writes
to sensitive relationships happen only through privileged database functions.

---

## M12 — Platform, Permissions & Delivery

### The Android capabilities the product depends on

| Permission | Without it |
|---|---|
| Post notifications | nothing rings at all |
| Schedule / use exact alarm | alarms drift by minutes, defeating "take at 08:00" |
| Full-screen intent | no alarm over the lock screen |
| Wake lock | screen does not light up |
| Vibrate | no tactile alert |
| Receive boot completed | alarms are lost after a reboot |

The app requests notification permission early and pre-creates all channels at startup
rather than at first alarm, so an alarm is never the first time permissions are
discovered to be missing.

### The honest platform caveat

The single largest cause of "my alarm didn't ring" is not the app — it is **OEM battery
optimisation**. Xiaomi, Oppo, Vivo and similar aggressively kill background work and
suppress scheduled notifications. The project README documents the required per-device
settings (Battery → Unrestricted, Autostart on, channel importance Urgent, exact alarms
allowed). Any real user-facing v1.0 needs this as an in-app onboarding step rather than
a line in a README, and the forward plan schedules it.

**iOS is not currently a target.** The config carries background modes but no bundle
identifier, and the full-screen alarm model does not exist on iOS. Treat the product as
Android-only today.

### Delivery

- **Builds** run in Expo's cloud (EAS) and produce an installable APK; a *preview*
  profile for internal distribution and a *production* profile.
- **Updates**: the app is wired for over-the-air JavaScript updates on a channel, with
  the runtime version tied to the app version. JS-only changes ship without a store
  release; anything touching native permissions, channels or plugins needs a real build.
- Small helper scripts in the repo generate the bundled tone assets and icons.

---

## Cross-cutting rules worth remembering

1. **The ledger is append-only.** Never overwrite dose status; add an event.
2. **Re-arm everything, never patch one alarm.** Correctness beats efficiency where a
   phantom alarm costs trust.
3. **The client proposes; the database decides.** Pairing, guardian limits and (soon)
   entitlement are enforced in privileged database functions.
4. **The guardian never writes to the patient.** Every guardian action is a proposal.
5. **Background code never throws.** A crash in the sweep costs future scheduling.
6. **Degrade, don't fail.** Offline reads fall back to cache; a bad tone falls back to
   the default; a failed migration never blocks login.
7. **Say the true thing in the UI.** Test-mode activation tells the user no charge was
   made.

---

## Known functional gaps (summary)

Detailed and prioritised in [`04-feature-inventory.md`](./04-feature-inventory.md);
listed here so this document is not read as a claim of completeness.

- **No account recovery** — synthetic emails make password reset impossible.
- **Client-side missed-dose detection** — no alert if the patient's phone is off.
- **Day boundaries are computed in UTC** while dose times are local, so the ledger's
  "day" can disagree with the user's day in non-UTC time zones.
- **No push when a guardian request arrives**, and no outcome notice back to the
  guardian.
- **Plan tiers are not meaningfully differentiated**; paid features are available free.
- **No real payments.**
- **Guardians cannot see adherence history** in the UI, though the data and permissions
  exist.
- **No offline write queue.**
- **No automated tests.**
- **On-screen reschedule offers fixed 5/10 min** instead of the medicine's setting.
