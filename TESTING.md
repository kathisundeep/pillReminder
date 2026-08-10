# Testing PillReminder

716 automated tests across 24 suites, plus an opt-in suite that runs against the
real Supabase backend.

```bash
npm test              # full mocked suite — must be green before every ship
npm run test:watch    # while developing
npm run test:coverage # per-file coverage
RUN_LIVE=1 npm run test:live   # hits the REAL backend (see warning below)
```

The default run never touches the network. It takes ~8 seconds.

## The standing rule

**When anything in the app changes, run `npm test` and add tests for the new
behaviour.** The suite exists so that a change to one feature cannot quietly
break another. A green run means every existing feature still behaves as it did.

For a new feature, add tests at whichever layers apply:

| The change is… | Add tests to |
|---|---|
| a pure rule (timing, formatting, validation) | `__tests__/unit/` |
| a module that talks to Supabase or a native API | `__tests__/integration/` |
| something a user can see or tap | `__tests__/screens/` |
| startup, navigation, or notification handling | `__tests__/app/` |
| app.json, permissions, assets, dependencies | `__tests__/config/` |
| an RLS policy or anything security-relevant | `__tests__/live/security.test.js` |
| role separation or guardian↔patient alerts | `__tests__/integration/roleAndNotify.test.js` |

Then work through the parts of `docs/qa-checklist.md` your change touches —
those are the things jest genuinely cannot verify.

## Layout

```
jest.config.js        two projects: `unit` (default) and `live` (opt-in)
jest.setup.js         module mocks: supabase, expo-*, AsyncStorage, fetch
jest.afterEnv.js      per-test reset of every stateful mock
test/fakeSupabase.js  in-memory Postgres + RLS simulation
test/renderScreen.js  screen render helpers (flush / press / typeInto) and the
                      RoleContext provider every screen with a logout path needs
test/liveClient.js    live-suite account provisioning and safety rails
```

### `test/fakeSupabase.js`

The most important piece. It implements the query-builder surface the app uses
**and simulates the Row-Level Security policies from `supabase/schema.sql`**.

That matters because several real defects in this app are of the form "the query
relies on RLS to scope rows, but RLS is broader than the code assumes". A fake
that ignored RLS would make those tests pass and hide the bug. Three confirmed
findings (BUG-01, BUG-02, BUG-03) are reproduced this way.

Test-facing API:

```js
const db = globalThis.__db;

db.makeUser('alice')          // create a signed-up user + profile row
db.as(user)                   // switch identity (attack scenarios)
db.link(userId, guardianId)   // create an active guardian link
db.seed('medicines', [...])   // insert rows directly
db.rows('medicines')          // read raw rows, bypassing RLS, for assertions
db.failOn('medicines', 'select', { message: 'offline' })  // inject a failure
```

### Determinism

- **Timezone is pinned to `Asia/Kolkata`** in `jest.config.js`. IST is UTC+5:30 —
  a non-zero, non-whole-hour offset, which is exactly what exposes UTC-vs-local
  date bugs. Override with `TEST_TZ=…` to check another region.
- **Platform is Android** (`jest-expo/android`). Tests that need iOS behaviour
  flip `Platform.OS` explicitly.
- Screens load through deep promise chains, so tests use `flush()` from
  `test/renderScreen.js` rather than racing them with `waitFor`.
- Time-sensitive tests use `jest.useFakeTimers()` + `jest.setSystemTime()`.

## Tests that used to document a bug

Every finding in `docs/audit-report.md` except INFRA-01 is fixed, and each one's
test was **inverted rather than deleted** — the case that proved the bug now
proves the fix. They are commented so the history stays readable:

```js
// Was BUG-08: every caller omitted toneId, so a snooze silently dropped to
// Classic. Now fixed — this test proves the tone survives.
it('rescheduling keeps the medicine`s chosen tone', …)
```

Keep that convention. A test named after the behaviour it guarantees, carrying
the id of the defect it came from, is worth more than a deleted one.

## The live suite

`RUN_LIVE=1 npm run test:live` runs against the real Supabase project.

- **`__tests__/live/happyPath.test.js`** — signup, medicines, photos, the DB
  photo cap, dose history, pairing, guardian reads, approval, revocation.
- **`__tests__/live/security.test.js`** — an "attacker" account probes the
  backend the way someone with a decompiled APK would. Every test asserts the
  *secure* outcome, so a failure is a real finding.

Safety rails:

- Every account is named `qa_<runId>_<role>`; `assertQaOnly()` refuses to touch
  anything else.
- Only rows owned by accounts created in that run are deleted on teardown.
- The anon key cannot delete `auth.users`, so those accounts linger. Run
  `docs/qa-cleanup.sql` periodically to purge them.

⚠️ This writes real rows to the production project. Do not run it on a schedule.

### It currently cannot run

The live suite fails its preflight because
`https://accxqbtukprszgwroorq.supabase.co` does not resolve (NXDOMAIN via both
`8.8.8.8` and `1.1.1.1`). See **INFRA-01** in `docs/audit-report.md`. Point
`app.json → expo.extra.supabaseUrl` and `src/utils/supabase.js` at a live
project and the suite will run as written.

## Coverage

96.6% of statements, 98.4% of lines. The one deliberate gap is
`src/utils/supabase.js`, whose untaken branches are the "no credentials
configured" fallbacks. `src/utils/ringtone.js` is gone (CLEAN-01).

## Roles in tests

Patient and guardian are separate account types. Two things follow:

- `registerUser(name, pw, { isGuardian: true })` creates a guardian account.
  Without the flag you get a patient.
- `renderScreen(Screen, { role: ROLES.GUARDIAN })` renders inside the guardian
  flow. The helper returns a `setRole` spy — logging out is expressed as
  `setRole(null)`, not a navigation call, because the two flows register
  different screen sets and there is no shared `Login` route to navigate to.
