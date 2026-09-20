import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  registerUser,
  loginUser,
  logoutUser,
  getSession,
  getMedicines,
  addMedicine,
  updateMedicine,
  deleteMedicine,
  getMedicine,
  importLocalMedicinesOnce,
  recordDose,
  getDoseEntries,
  getDoseEntriesForDay,
  entriesForSlot,
  isTakenToday,
  setTakenToday,
  getHistory,
  pruneOldHistory,
  getGuardian,
  setGuardian,
  clearGuardian,
  getOwnPushToken,
  setOwnPushToken,
  hasAlertedGuardian,
  markAlertedGuardian,
  getCachedMedicines,
  getCachedDayEntries,
} from '../../src/utils/storage';

const db = () => globalThis.__db;

async function signedIn(username = 'alice') {
  await registerUser(username, 'password123');
  await loginUser(username, 'password123');
  return db().session.user;
}

describe('registerUser', () => {
  it('creates the auth user and its profile row', async () => {
    expect(await registerUser('alice', 'password123')).toEqual({ ok: true });
    expect(db().rows('profiles')).toHaveLength(1);
    expect(db().rows('profiles')[0].username).toBe('alice');
  });

  it('rejects a username that fails the format rules', async () => {
    const res = await registerUser('ab', 'password123');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/3-30 chars/);
    expect(db().authUsers).toHaveLength(0);
  });

  it('maps a duplicate signup to a friendly message', async () => {
    await registerUser('alice', 'password123');
    const res = await registerUser('alice', 'password123');
    expect(res).toEqual({ ok: false, error: 'User already exists' });
  });

  it('treats usernames case-insensitively for uniqueness', async () => {
    await registerUser('Alice', 'password123');
    const res = await registerUser('alice', 'password123');
    expect(res.ok).toBe(false);
  });

  it('surfaces other backend errors verbatim', async () => {
    const res = await registerUser('alice', 'short');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at least 6 characters/);
  });

  it('does not sign the user in — the caller must log in explicitly', async () => {
    await registerUser('alice', 'password123');
    expect(await getSession()).toBeNull();
  });

  it('records the role the caller asked for', async () => {
    await registerUser('carol', 'password123');
    expect(db().rows('profiles')[0].is_guardian).toBe(false);
    await registerUser('dave', 'password123', { isGuardian: true });
    expect(db().rows('profiles')[1].is_guardian).toBe(true);
  });
});

describe('loginUser / logoutUser / getSession', () => {
  it('signs in with the right password', async () => {
    await registerUser('alice', 'password123');
    expect(await loginUser('alice', 'password123')).toEqual({ ok: true });
    expect(await getSession()).toBe('alice');
  });

  it('rejects a wrong password without leaking which field was wrong', async () => {
    await registerUser('alice', 'password123');
    expect(await loginUser('alice', 'nope')).toEqual({
      ok: false,
      error: 'Invalid credentials',
    });
  });

  it('rejects an unknown user with the same generic message', async () => {
    expect(await loginUser('ghost', 'password123')).toEqual({
      ok: false,
      error: 'Invalid credentials',
    });
  });

  it('accepts any casing of the username at login', async () => {
    await registerUser('Alice', 'password123');
    expect((await loginUser('  ALICE  ', 'password123')).ok).toBe(true);
  });

  it('returns null from getSession when signed out', async () => {
    await signedIn();
    await logoutUser();
    expect(await getSession()).toBeNull();
  });
});

describe('medicines CRUD', () => {
  it('adds a medicine owned by the signed-in user and returns its id', async () => {
    const user = await signedIn();
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    expect(id).toBeTruthy();
    const rows = db().rows('medicines');
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(user.id);
    expect(rows[0].name).toBe('Aspirin');
  });

  it('lists medicines oldest-first and maps them to app shape', async () => {
    await signedIn();
    await addMedicine(null, { name: 'First', times: ['08:00'] });
    await addMedicine(null, { name: 'Second', times: ['20:00'] });
    const meds = await getMedicines();
    expect(meds.map((m) => m.name)).toEqual(['First', 'Second']);
    expect(meds[0].snoozeMinutes).toBe(10);
    expect(meds[0].toneId).toBe('classic');
  });

  it('returns an empty list when signed out', async () => {
    expect(await getMedicines()).toEqual([]);
  });

  it('never returns another user`s medicines', async () => {
    const alice = await signedIn('alice');
    await addMedicine(null, { name: 'Alice pill', times: ['08:00'] });
    await logoutUser();

    await registerUser('mallory', 'password123');
    await loginUser('mallory', 'password123');
    expect(await getMedicines()).toEqual([]);

    await logoutUser();
    await loginUser('alice', 'password123');
    expect((await getMedicines()).map((m) => m.name)).toEqual(['Alice pill']);
    expect(alice.id).toBeTruthy();
  });

  it('updates only the fields present in the patch', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'], toneId: 'bell' });
    await updateMedicine(null, id, { name: 'Aspirin 500' });
    const row = db().rows('medicines')[0];
    expect(row.name).toBe('Aspirin 500');
    expect(row.tone_id).toBe('bell'); // untouched
    expect(row.times).toEqual(['08:00']);
  });

  it('maps every editable field onto its column', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    await updateMedicine(null, id, {
      name: 'B', form: 'Syrup', color: '#1E88E5', times: ['09:00'],
      snoozeMinutes: 30, frequency: 'weekly', daysOfWeek: [1, 2],
      toneId: 'gentle', alertGuardian: false, photo: 'b64',
    });
    expect(db().rows('medicines')[0]).toMatchObject({
      name: 'B', form: 'Syrup', color: '#1E88E5', times: ['09:00'],
      snooze_minutes: 30, frequency: 'weekly', days_of_week: [1, 2],
      tone_id: 'gentle', alert_guardian: false, photo: 'b64',
    });
  });

  it('clears a photo when patched with null', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'], photo: 'b64' });
    await updateMedicine(null, id, { photo: null });
    expect(db().rows('medicines')[0].photo).toBeNull();
  });

  it('does nothing for an empty patch', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    await expect(updateMedicine(null, id, {})).resolves.toBeUndefined();
    expect(db().rows('medicines')[0].name).toBe('A');
  });

  it('keeps notification ids on the device and out of the cloud', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    await updateMedicine(null, id, { notificationIds: ['n1', 'n2'] });

    expect(db().rows('medicines')[0].notificationIds).toBeUndefined();
    expect(db().rows('medicines')[0].notification_ids).toBeUndefined();

    const meds = await getMedicines();
    expect(meds[0].notificationIds).toEqual(['n1', 'n2']);
  });

  it('still applies cloud fields when a patch mixes them with notification ids', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    await updateMedicine(null, id, { notificationIds: ['n1'], name: 'B' });
    expect(db().rows('medicines')[0].name).toBe('B');
    expect((await getMedicines())[0].notificationIds).toEqual(['n1']);
  });

  // Was a pothole: dose_history cascades from medicines, so removing the row
  // erased every dose ever recorded for it and rewrote past calendar days.
  it('marks a medicine deleted, keeping its history, and forgets its alarm ids', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    await updateMedicine(null, id, { notificationIds: ['n1'] });
    await recordDose(null, id, 'taken', '08:00');

    await deleteMedicine(null, id);

    expect(db().rows('medicines')).toHaveLength(1);
    expect(db().rows('medicines')[0].deleted_at).toBeTruthy();
    expect(db().rows('dose_history')).toHaveLength(1);
    const map = JSON.parse(await AsyncStorage.getItem('@pr_notif_ids'));
    expect(map[id]).toBeUndefined();
  });

  it('leaves a deleted medicine out of the list, unless asked for it', async () => {
    await signedIn();
    const keep = await addMedicine(null, { name: 'Keep', times: ['08:00'] });
    const gone = await addMedicine(null, { name: 'Gone', times: ['09:00'] });
    await deleteMedicine(null, gone);

    expect((await getMedicines()).map((m) => m.id)).toEqual([keep]);
    const all = await getMedicines(null, { includeDeleted: true });
    expect(all.map((m) => m.name).sort()).toEqual(['Gone', 'Keep']);
    expect(all.find((m) => m.id === gone).deletedAt).toBeTruthy();
  });

  it('keeps the offline cache to the active list, so no alarm is re-armed', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'Gone', times: ['08:00'] });
    await deleteMedicine(null, id);
    await getMedicines(); // the call the app makes to arm alarms
    await getMedicines(null, { includeDeleted: true }); // must not overwrite it

    const cached = JSON.parse(await AsyncStorage.getItem('@pr_meds_cache'));
    expect(cached).toEqual([]);
  });

  it('getMedicine finds one by id and returns null when absent', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    expect((await getMedicine(null, id)).name).toBe('A');
    expect(await getMedicine(null, 'no-such-id')).toBeNull();
  });
});

describe('offline medicine cache', () => {
  it('keeps today`s entries for an instant first paint, and only for today', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await recordDose(null, id, 'taken', '08:00');
    await getDoseEntriesForDay();

    expect((await getCachedDayEntries())[id][0].status).toBe('taken');
    expect(await getCachedDayEntries('1999-01-01')).toBeNull();
  });

  it('forgets both caches on log out, so the next account never sees them', async () => {
    await signedIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await getMedicines();
    await getDoseEntriesForDay();

    await logoutUser();

    expect(await getCachedMedicines()).toBeNull();
    expect(await getCachedDayEntries()).toBeNull();
  });


  it('caches the list after a successful fetch', async () => {
    await signedIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await getMedicines();
    const cached = JSON.parse(await AsyncStorage.getItem('@pr_meds_cache'));
    expect(cached).toHaveLength(1);
    expect(cached[0].name).toBe('Aspirin');
  });

  it('falls back to the cache when the network fails, so alarms survive', async () => {
    await signedIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await getMedicines(); // warm the cache

    db().failOn('medicines', 'select', { message: 'network down' });
    const meds = await getMedicines();
    expect(meds).toHaveLength(1);
    expect(meds[0].name).toBe('Aspirin');
  });

  it('carries the photo into the cache so the alarm screen works offline', async () => {
    await signedIn();
    await addMedicine(null, { name: 'A', times: ['08:00'], photo: 'b64photo' });
    await getMedicines();

    db().failOn('medicines', 'select', { message: 'network down' });
    expect((await getMedicines())[0].photo).toBe('b64photo');
  });

  it('returns an empty list when offline with no cache at all', async () => {
    await signedIn();
    db().failOn('medicines', 'select', { message: 'network down' });
    expect(await getMedicines()).toEqual([]);
  });
});

describe('dose history', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-10T09:00:00.000Z')); // 14:30 IST
  });

  it('records a dose against today and the medicine', async () => {
    const user = await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    await recordDose(null, id, 'taken');

    const rows = db().rows('dose_history');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: user.id, medicine_id: id, day: '2025-06-10', status: 'taken',
    });
  });

  it('does nothing when signed out', async () => {
    await recordDose(null, 'm1', 'taken');
    expect(db().rows('dose_history')).toHaveLength(0);
  });

  it('appends rather than replacing, so the day keeps a full audit trail', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    await recordDose(null, id, 'snoozed');
    await recordDose(null, id, 'snoozed');
    await recordDose(null, id, 'taken');
    expect(await getDoseEntries(null, id)).toHaveLength(3);
  });

  it('returns entries in chronological order', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    jest.setSystemTime(new Date('2025-06-10T09:00:00.000Z'));
    await recordDose(null, id, 'snoozed');
    jest.setSystemTime(new Date('2025-06-10T10:00:00.000Z'));
    await recordDose(null, id, 'taken');

    const entries = await getDoseEntries(null, id);
    expect(entries.map((e) => e.status)).toEqual(['snoozed', 'taken']);
  });

  it('scopes entries to a single medicine and day', async () => {
    await signedIn();
    const a = await addMedicine(null, { name: 'A', times: ['08:00'] });
    const b = await addMedicine(null, { name: 'B', times: ['08:00'] });
    await recordDose(null, a, 'taken');
    await recordDose(null, b, 'skipped');

    expect(await getDoseEntries(null, a)).toHaveLength(1);
    expect(await getDoseEntries(null, a, '2025-06-09')).toHaveLength(0);
  });

  it('isTakenToday is true only after a taken entry', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    expect(await isTakenToday(null, id)).toBe(false);
    await recordDose(null, id, 'skipped');
    expect(await isTakenToday(null, id)).toBe(false);
    await recordDose(null, id, 'taken');
    expect(await isTakenToday(null, id)).toBe(true);
  });

  it('setTakenToday(true) is idempotent', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    await setTakenToday(null, id, true);
    await setTakenToday(null, id, true);
    expect(db().rows('dose_history').filter((r) => r.status === 'taken')).toHaveLength(1);
  });

  it('setTakenToday(false) removes only today`s taken rows', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    await recordDose(null, id, 'snoozed');
    await setTakenToday(null, id, true);
    await setTakenToday(null, id, false);

    const rows = db().rows('dose_history');
    expect(rows.map((r) => r.status)).toEqual(['snoozed']);
  });

  it('getHistory groups by day then medicine', async () => {
    await signedIn();
    const a = await addMedicine(null, { name: 'A', times: ['08:00'] });
    const b = await addMedicine(null, { name: 'B', times: ['08:00'] });
    await recordDose(null, a, 'taken');
    await recordDose(null, b, 'skipped');

    const hist = await getHistory(null);
    expect(Object.keys(hist)).toEqual(['2025-06-10']);
    expect(hist['2025-06-10'][a][0].status).toBe('taken');
    expect(hist['2025-06-10'][b][0].status).toBe('skipped');
  });

  it('getHistory returns {} when signed out', async () => {
    expect(await getHistory(null)).toEqual({});
  });

  it('prunes entries older than two years and keeps newer ones', async () => {
    const user = await signedIn();
    db().seed('dose_history', [
      { user_id: user.id, medicine_id: null, day: '2020-01-01', status: 'taken' },
      { user_id: user.id, medicine_id: null, day: '2024-01-01', status: 'taken' },
      { user_id: user.id, medicine_id: null, day: '2025-06-10', status: 'taken' },
    ]);
    await pruneOldHistory();
    expect(db().rows('dose_history').map((r) => r.day)).toEqual([
      '2024-01-01', '2025-06-10',
    ]);
  });

  it('pruning never throws when signed out', async () => {
    await expect(pruneOldHistory()).resolves.toBeUndefined();
  });

  // Was BUG-05: the day key was UTC while every dose time was local, so in IST
  // the two disagreed between 00:00 and 05:30 every night.
  it('files an early-morning IST dose under the local calendar day', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['01:00'] });
    jest.setSystemTime(new Date('2025-06-09T20:30:00.000Z')); // 02:00 IST, 10 Jun
    await recordDose(null, id, 'taken');
    expect(db().rows('dose_history')[0].day).toBe('2025-06-10');
  });

  it('does not carry last evening`s dose into the new local day', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['20:00'] });

    jest.setSystemTime(new Date('2025-06-09T15:00:00.000Z')); // 20:30 IST, 9 Jun
    await recordDose(null, id, 'taken');

    jest.setSystemTime(new Date('2025-06-09T20:30:00.000Z')); // 02:00 IST, 10 Jun
    expect(await isTakenToday(null, id)).toBe(false);
  });
});

// BUG-06: a dose is (day, medicine, slot), not (day, medicine).
describe('per-slot dose tracking', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 21, 0, 0, 0)); // 21:00 IST
  });

  it('records the slot a dose belongs to', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00', '20:00'] });
    await recordDose(null, id, 'taken', '08:00');

    expect(db().rows('dose_history')[0].slot).toBe('08:00');
  });

  it('taking the morning dose leaves the evening dose untaken', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00', '20:00'] });
    await recordDose(null, id, 'taken', '08:00');

    expect(await isTakenToday(null, id, '08:00')).toBe(true);
    expect(await isTakenToday(null, id, '20:00')).toBe(false);
  });

  it('narrows getDoseEntries to a single slot', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00', '20:00'] });
    await recordDose(null, id, 'taken', '08:00');
    await recordDose(null, id, 'snoozed', '20:00');

    expect(await getDoseEntries(null, id, null, '08:00')).toHaveLength(1);
    expect((await getDoseEntries(null, id, null, '20:00'))[0].status).toBe('snoozed');
    expect(await getDoseEntries(null, id)).toHaveLength(2); // whole day
  });

  it('un-taking one slot leaves the other alone', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00', '20:00'] });
    await setTakenToday(null, id, true, '08:00');
    await setTakenToday(null, id, true, '20:00');

    await setTakenToday(null, id, false, '08:00');

    expect(await isTakenToday(null, id, '08:00')).toBe(false);
    expect(await isTakenToday(null, id, '20:00')).toBe(true);
  });

  it('setTakenToday is idempotent per slot', async () => {
    await signedIn();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    await setTakenToday(null, id, true, '08:00');
    await setTakenToday(null, id, true, '08:00');
    expect(db().rows('dose_history')).toHaveLength(1);
  });

  it('fetches the whole day for every medicine in one query', async () => {
    await signedIn();
    const a = await addMedicine(null, { name: 'A', times: ['08:00', '20:00'] });
    const b = await addMedicine(null, { name: 'B', times: ['09:00'] });
    await recordDose(null, a, 'taken', '08:00');
    await recordDose(null, a, 'snoozed', '20:00');
    await recordDose(null, b, 'skipped', '09:00');

    const byMed = await getDoseEntriesForDay(null);
    expect(Object.keys(byMed).sort()).toEqual([a, b].sort());
    expect(byMed[a]).toHaveLength(2);
    expect(byMed[b][0].status).toBe('skipped');
  });

  it('returns {} for the day map when signed out', async () => {
    expect(await getDoseEntriesForDay(null)).toEqual({});
  });

  it('entriesForSlot filters an already-fetched day', () => {
    const entries = [
      { status: 'taken', slot: '08:00' },
      { status: 'snoozed', slot: '20:00' },
    ];
    expect(entriesForSlot(entries, '08:00')).toHaveLength(1);
    expect(entriesForSlot(entries, '20:00')[0].status).toBe('snoozed');
    expect(entriesForSlot(entries, null)).toHaveLength(2);
    expect(entriesForSlot(undefined, '08:00')).toEqual([]);
  });
});

describe('importLocalMedicinesOnce', () => {
  it('uploads pre-cloud on-device medicines exactly once', async () => {
    await signedIn();
    await AsyncStorage.setItem(
      '@pr_meds_alice',
      JSON.stringify([
        { name: 'Legacy A', times: ['08:00'] },
        { name: 'Legacy B', times: ['20:00'] },
      ])
    );
    expect(await importLocalMedicinesOnce()).toBe(2);
    expect((await getMedicines()).map((m) => m.name)).toEqual(['Legacy A', 'Legacy B']);
  });

  it('imports nothing when the cloud account already has medicines', async () => {
    await signedIn();
    await addMedicine(null, { name: 'Cloud', times: ['08:00'] });
    await AsyncStorage.setItem('@pr_meds_alice', JSON.stringify([{ name: 'Legacy', times: ['08:00'] }]));
    expect(await importLocalMedicinesOnce()).toBe(0);
    expect(await getMedicines()).toHaveLength(1);
  });

  it('never mistakes the offline cache for legacy data', async () => {
    await signedIn();
    await AsyncStorage.setItem(
      '@pr_meds_cache',
      JSON.stringify([{ name: 'Cached', times: ['08:00'] }])
    );
    expect(await importLocalMedicinesOnce()).toBe(0);
    expect(await getMedicines()).toHaveLength(0);
  });

  it('returns 0 when signed out', async () => {
    expect(await importLocalMedicinesOnce()).toBe(0);
  });

  // Was BUG-20: the guard was "the cloud is empty", not "already imported", so
  // deleting every medicine resurrected the legacy list at the next login.
  it('does not re-import after the user deletes everything', async () => {
    await signedIn();
    await AsyncStorage.setItem('@pr_meds_alice', JSON.stringify([{ name: 'Legacy', times: ['08:00'] }]));
    expect(await importLocalMedicinesOnce()).toBe(1);

    for (const m of await getMedicines()) await deleteMedicine(null, m.id);
    expect(await importLocalMedicinesOnce()).toBe(0);
    expect(await getMedicines()).toEqual([]);
  });

  it('marks the import done even when the cloud already had data', async () => {
    await signedIn();
    await addMedicine(null, { name: 'Cloud', times: ['08:00'] });
    await AsyncStorage.setItem('@pr_meds_alice', JSON.stringify([{ name: 'Legacy', times: ['08:00'] }]));
    expect(await importLocalMedicinesOnce()).toBe(0);

    for (const m of await getMedicines()) await deleteMedicine(null, m.id);
    expect(await importLocalMedicinesOnce()).toBe(0);
  });
});

describe('device-local guardian bookkeeping', () => {
  it('stores and clears a guardian profile per user', async () => {
    await setGuardian('alice', { name: 'Bob', token: 't' });
    expect(await getGuardian('alice')).toEqual({ name: 'Bob', token: 't' });
    expect(await getGuardian('carol')).toBeNull();
    await clearGuardian('alice');
    expect(await getGuardian('alice')).toBeNull();
  });

  it('stores this device`s push token', async () => {
    expect(await getOwnPushToken()).toBeNull();
    await setOwnPushToken('ExponentPushToken[abc]');
    expect(await getOwnPushToken()).toBe('ExponentPushToken[abc]');
  });

  it('ignores an attempt to store a null token', async () => {
    await setOwnPushToken(null);
    expect(await getOwnPushToken()).toBeNull();
  });

  it('dedups guardian alerts per medicine per day', async () => {
    expect(await hasAlertedGuardian('alice', 'med-1')).toBe(false);
    await markAlertedGuardian('alice', 'med-1');
    expect(await hasAlertedGuardian('alice', 'med-1')).toBe(true);
    expect(await hasAlertedGuardian('alice', 'med-2')).toBe(false);
    expect(await hasAlertedGuardian('bob', 'med-1')).toBe(false);
  });

  it('keys the dedup by day, so a new day alerts again', async () => {
    await markAlertedGuardian('alice', 'med-1', '2025-06-09');
    expect(await hasAlertedGuardian('alice', 'med-1', '2025-06-09')).toBe(true);
    expect(await hasAlertedGuardian('alice', 'med-1', '2025-06-10')).toBe(false);
  });

  it('keeps only the last 7 days of dedup state', async () => {
    for (let d = 1; d <= 10; d += 1) {
      await markAlertedGuardian('alice', 'med-1', `2025-06-${String(d).padStart(2, '0')}`);
    }
    const map = JSON.parse(await AsyncStorage.getItem('@pr_alerts_alice'));
    expect(Object.keys(map)).toHaveLength(7);
    expect(Object.keys(map).sort()).toEqual([
      '2025-06-04', '2025-06-05', '2025-06-06', '2025-06-07',
      '2025-06-08', '2025-06-09', '2025-06-10',
    ]);
  });
});
