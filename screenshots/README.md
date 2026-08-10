# PillReminder — screen captures

Every screen in the app, in journey order, login → logout. 390×844 @2x (Pixel-class
phone), rendered from the real screen components in `src/screens/` with seeded
data. `shots.json` is the same list in machine-readable form.

## Patient journey

| # | File | Screen | What it shows |
|---|------|--------|----------------|
| 01 | `01-login-patient.png` | Login | Log in as "I take medicines" |
| 02 | `02-login-register.png` | Login | Register a new account |
| 03 | `03-login-guardian.png` | Login | Guardian log in (role toggle) |
| 04 | `04-home-empty.png` | Home | First run — no medicines yet |
| 05 | `05-add-medicine-blank.png` | Add medicine | Names, type, colour |
| 06 | `06-add-medicine-blank-lower.png` | Add medicine | Photo, times, quick add, frequency |
| 07 | `07-add-medicine-tone-snooze.png` | Add medicine | Tone, snooze, guardian alert, Save |
| 08 | `08-add-medicine-time-picker.png` | Add medicine | Custom-time wheel picker |
| 09 | `09-add-medicine-filled.png` | Add medicine | Filled in — two medicines on one schedule |
| 10 | `10-add-medicine-filled-lower.png` | Add medicine | Times, specific days, tone selected |
| 11 | `11-home-today.png` | Home | Today's doses — taken / due now / upcoming |
| 12 | `12-home-other-days.png` | Home | Scrolled to the "Other days" section |
| 13 | `13-home-guardian-request.png` | Home | Banner: guardian requests to review |
| 14 | `14-alarm.png` | Alarm | Full-screen alarm with medicine photo |
| 15 | `15-edit-medicine.png` | Edit medicine | Editing an existing medicine |
| 16 | `16-edit-medicine-delete.png` | Edit medicine | Save changes / Delete medicine |

## Guardian setup (patient side)

| # | File | Screen | What it shows |
|---|------|--------|----------------|
| 17 | `17-guardian-setup.png` | Guardian | No guardian linked yet |
| 18 | `18-guardian-pairing-code.png` | Guardian | One-time 6-digit pairing code |
| 19 | `19-guardian-alert-settings.png` | Guardian | Grace period + notify/approval toggles |
| 20 | `20-guardian-linked.png` | Guardian | A linked guardian |
| 21 | `21-approvals.png` | Guardian requests | Approve or reject an add-medicine request |
| 22 | `22-approvals-empty.png` | Guardian requests | Empty state |

## Health & subscription

| # | File | Screen | What it shows |
|---|------|--------|----------------|
| 23 | `23-trackers.png` | Health trackers | Blood pressure entry |
| 24 | `24-trackers-cholesterol.png` | Health trackers | Cholesterol — multi-field entry |
| 25 | `25-trackers-history.png` | Health trackers | Recent readings list |
| 26 | `26-health-report.png` | Health report | Per-type latest / avg / min / max |
| 27 | `27-plans.png` | Plans & subscription | Free / Plus / Family |

## Guardian's own app

| # | File | Screen | What it shows |
|---|------|--------|----------------|
| 28 | `28-guardian-dashboard-empty.png` | Guardian dashboard | Link a person by username + code |
| 29 | `29-guardian-dashboard-linked.png` | Guardian dashboard | People you look after |
| 30 | `30-guardian-user-medicines.png` | Medicines | A linked person's medicines |
| 31 | `31-guardian-request-medicine.png` | Request for @user | Request to add a medicine |
| 32 | `32-guardian-health-report.png` | Health report | A linked person's report |
| 33 | `33-guardian-dashboard-logout.png` | Guardian dashboard | The "Log out" action |

## Log out

| # | File | Screen | What it shows |
|---|------|--------|----------------|
| 34 | `34-logged-out.png` | Login | Back at the login screen |

## How these were produced

The real screen components are rendered through `react-native-web` in headless
Chromium at a phone viewport, with `src/utils/{storage,guardianCloud,health,
subscription,notifications,guardian,sync}` swapped for fixtures and the clock
pinned to 2026-08-08 13:45, then driven with real taps (typing a name, choosing
a colour, opening the time picker, generating a pairing code). Nothing touches
the live Supabase project, so no test rows are created.

Everything except the status bar and the stack header is the app's own JSX and
`StyleSheet` — those two are redrawn to match `App.js`'s `screenOptions`, since
the native-stack navigator itself doesn't render on the web.
