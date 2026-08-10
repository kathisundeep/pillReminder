# Device QA checklist

The 716 automated tests cover logic, data access, screens and configuration.
They cannot verify that a phone actually wakes up and makes a noise. These are
the checks that need a real device.

Run the sections your change touches. Run all of them before a store submission.

**Setup:** two physical Android devices (one patient, one guardian), notification
permission granted, battery optimisation disabled for PillReminder, and a
reachable Supabase backend with all four migrations applied — `schema.sql`,
`pairing.sql`, `subscriptions.sql`, `hardening.sql` (see INFRA-01).

---

## A. Alarms — the core promise

| # | Check | Expected |
|---|---|---|
| A1 | Add a medicine 2 minutes out. Lock the phone. Wait. | Full-screen alarm fires on the lock screen, sound plays, phone vibrates |
| A2 | Same, with the screen off and the app swiped away from recents | Alarm still fires |
| A3 | Same, with the phone in Do Not Disturb | Alarm still fires (channels are set `bypassDnd`) |
| A4 | Same, with the phone on silent | Alarm audio still plays |
| A5 | Let the alarm ring untouched for 2 minutes | Sound loops, notification does not auto-dismiss |
| A6 | Reboot the phone, wait for the next scheduled dose | Alarm fires (RECEIVE_BOOT_COMPLETED) |
| A7 | Add a weekly medicine for tomorrow only | Nothing fires today; fires tomorrow |
| A8 | Add a medicine with two times, e.g. 08:00 and 20:00 | Both fire |
| A9 | Change the device timezone, then wait for a dose | Doses file under the LOCAL date (BUG-05 fixed) |

## B. Alarm tones

| # | Check | Expected |
|---|---|---|
| B1 | Preview each of the 5 tones in Add medicine | Each plays a distinct sound, stops after ~2s |
| B2 | Save a medicine with **Siren**, let the alarm fire | Siren plays, not Classic |
| B3 | Repeat B2 for Chime, Bell, Gentle, Classic | Each plays its own sound |
| B4 | Tap Reschedule on a Siren alarm, wait for the re-alarm | Siren plays (BUG-08 fixed — verify on device) |
| B5 | Install a fresh build (not an OTA update) and check B2 | Tone still correct — proves the sound files were bundled into `res/raw` |

## C. Notification action buttons

| # | Check | Expected |
|---|---|---|
| C1 | Expand the alarm notification | Taken / Reschedule / Skip buttons visible |
| C2 | Tap **Taken** from the notification | Dose recorded, app opens on Home |
| C3 | Tap **Reschedule** | Re-alarm fires after the medicine's snooze duration |
| C4 | Tap **Skip** | Skip recorded; guardian alerted after the grace period |
| C5 | Tap the notification body itself | Full alarm screen opens |
| C6 | Repeat C1 on iOS | Taken / Reschedule / Skip all present (BUG-11 fixed) |

## D. Medicine photos

| # | Check | Expected |
|---|---|---|
| D1 | Take a photo of a pill strip in Add medicine | Preview appears, size hint reads ~5–12 KB |
| D2 | Choose an existing photo from the gallery | Same |
| D3 | Deny camera permission, then tap Take a photo | Clear "Camera permission denied" message |
| D4 | Save, then let that medicine's alarm fire | Photo shown on the alarm screen, large enough to identify the pill |
| D5 | Turn on aeroplane mode, then trigger the alarm | Photo still shown (offline cache) |
| D6 | Photograph something visually busy (a printed label) | Still legible after compression |
| D7 | Add two medicines in one save, photo on the first only | Only the first has a photo |
| D8 | Check the photo on the guardian's device | Visible in the linked-user list |

## E. Guardian flow (needs both devices)

| # | Check | Expected |
|---|---|---|
| E1 | Patient generates a code; guardian enters username + code | Linked; patient appears in the guardian's list |
| E2 | Share the invite from the patient device | Share sheet contains username and code |
| E3 | Patient misses a dose past the grace period | Guardian's phone receives a push within ~15 min |
| E4 | Guardian taps that push | Guardian app opens |
| E5 | Patient sets "Notify my guardian" to *When I take a dose*, then marks one taken | Guardian receives a "Medicine taken" push |
| E6 | Guardian requests a medicine; patient approves | Medicine appears on the patient device, alarms armed |
| E7 | Patient turns approval off; guardian requests again | Applied automatically on the patient device |
| E8 | Patient removes the guardian | Guardian can no longer see medicines or health data |
| E9 | Re-pair with a new code | Works; the previous guardian stays revoked |
| E10 | Guardian force-quits and reopens their app | Lands on the Guardian Dashboard (BUG-10 fixed) |
| E11 | Guardian requests a medicine while the patient's app is closed | Patient's phone gets a push; tapping it opens Approvals |
| E12 | Patient sets "Notify my guardian" to *When I take a dose*, then misses one | Guardian gets **no** missed alert; the miss still appears in history |
| E13 | Patient sets it to *Both*, then takes one and misses one | Guardian gets both pushes |
| E14 | Try to log into a guardian account with "I take medicines" selected | Refused with a clear message; not signed in |
| E15 | Look for "My medicines" on the guardian dashboard | Gone — a guardian account has no medicines |

## F. Background sweep

| # | Check | Expected |
|---|---|---|
| F1 | Miss a dose with the app fully closed; wait 20 min | Guardian alerted without opening the app |
| F2 | Miss a dose, then open the app | Guardian alerted immediately on foreground |
| F3 | Miss two different medicines on the same day | Two separate alerts |
| F4 | Miss two doses of the same medicine in a day | Two alerts, one per dose (BUG-06 fixed) |
| F5 | Take the evening dose but not the morning one | Guardian is still told about the morning dose |
| F6 | Snooze a dose, then force-quit and reopen the app | The snooze re-alarm still fires (BUG-09 fixed) |

## G. Offline behaviour

| # | Check | Expected |
|---|---|---|
| G1 | Aeroplane mode, open the app | Medicine list still renders from cache |
| G2 | Aeroplane mode, let an alarm fire | Alarm fires normally |
| G3 | Aeroplane mode, mark a dose taken | Records once connectivity returns, or fails visibly — **record which** |
| G4 | Airplane mode, force-quit, reopen | No crash, no white screen |

## H. Accounts and sessions

| # | Check | Expected |
|---|---|---|
| H1 | Register, force-quit, reopen | Still signed in, alarms intact |
| H2 | Sign in on a second device with the same account | Same medicines; alarms armed on the new device |
| H3 | Log out | Returns to Login; alarms should not fire afterwards — **verify** |
| H4 | Register with an existing username | "User already exists" |
| H5 | Wrong password | "Invalid credentials" |

## I. Release build

| # | Check | Expected |
|---|---|---|
| I1 | Install the release APK on a clean device | Onboarding works end to end |
| I2 | Fire an alarm on the release build | Correct custom tone (not the system default) |
| I3 | `eas update` then relaunch twice | Update applied |
| I4 | Confirm the runtime version after a version bump | 1.1.0 installs need a **new binary**, not an OTA (REL-01) |
| I5 | Trigger an unexpected error | "Something went wrong" with a working Try again (BUG-14 fixed) |

---

## Recording results

Note the date, build number, device model and OS version. For any **Known bug**
row, confirm the behaviour still matches the report — if it has changed, the
finding needs re-triage.
