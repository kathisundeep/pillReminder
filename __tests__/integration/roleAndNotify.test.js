// Role separation, the three-way notify setting, and the guardian -> patient
// request notification.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ROLES,
  isRole,
  getStoredRole,
  setStoredRole,
  clearStoredRole,
  resolveRole,
  roleMatchesAccount,
} from '../../src/utils/role';
import {
  NOTIFY_MODES,
  notifyModeOf,
  wantsIntakeAlerts,
  wantsMissedAlerts,
  notifyGuardianTaken,
  notifyPatientOfRequest,
  sweepMissedDoses,
} from '../../src/utils/guardian';
import {
  registerUser,
  loginUser,
  logoutUser,
  addMedicine,
} from '../../src/utils/storage';

const db = () => globalThis.__db;
const pushes = () =>
  globalThis.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

async function signIn(username = 'alice', opts) {
  await registerUser(username, 'password123', opts);
  await loginUser(username, 'password123');
  return db().session.user;
}

// alice (patient) + bob (guardian), linked, with a chosen notify mode.
async function pairedPatient(notifyMode) {
  const bob = db().makeUser('bob', {
    push_token: 'ExponentPushToken[bob]',
    is_guardian: true,
  });
  const alice = await signIn('alice');
  const profile = db().rows('profiles').find((p) => p.id === alice.id);
  if (notifyMode) profile.settings = { ...profile.settings, notifyMode };
  db().link(alice.id, bob.id);
  return { alice, bob };
}

describe('role helpers', () => {
  it('recognises only the two real roles', () => {
    expect(isRole(ROLES.PATIENT)).toBe(true);
    expect(isRole(ROLES.GUARDIAN)).toBe(true);
    for (const bad of ['admin', '', null, undefined, 0]) {
      expect(isRole(bad)).toBe(false);
    }
  });

  it('persists and clears the active role on the device', async () => {
    expect(await getStoredRole()).toBeNull();

    await setStoredRole(ROLES.GUARDIAN);
    expect(await getStoredRole()).toBe(ROLES.GUARDIAN);
    expect(await AsyncStorage.getItem('@pr_active_role')).toBe('guardian');

    await clearStoredRole();
    expect(await getStoredRole()).toBeNull();
  });

  it('refuses to store a bogus role', async () => {
    await setStoredRole('superuser');
    expect(await getStoredRole()).toBeNull();
  });

  it('resolves the role from the account, not the device', async () => {
    await signIn('bob', { isGuardian: true });
    expect(await resolveRole()).toBe(ROLES.GUARDIAN);

    await logoutUser();
    await signIn('alice');
    expect(await resolveRole()).toBe(ROLES.PATIENT);
  });

  it('caches the resolved role for a cold start', async () => {
    await signIn('bob', { isGuardian: true });
    await resolveRole();
    expect(await getStoredRole()).toBe(ROLES.GUARDIAN);
  });

  it('falls back to the cached role when the profile cannot be read', async () => {
    await signIn('bob', { isGuardian: true });
    await resolveRole();

    db().failOn('profiles', 'select', { message: 'offline' });
    expect(await resolveRole()).toBe(ROLES.GUARDIAN);
  });

  it('resolves to null when signed out with nothing cached', async () => {
    expect(await resolveRole()).toBeNull();
  });

  it('matches a wanted role against the account type', () => {
    expect(roleMatchesAccount(ROLES.GUARDIAN, { is_guardian: true })).toBe(true);
    expect(roleMatchesAccount(ROLES.PATIENT, { is_guardian: false })).toBe(true);
    expect(roleMatchesAccount(ROLES.GUARDIAN, { is_guardian: false })).toBe(false);
    expect(roleMatchesAccount(ROLES.PATIENT, { is_guardian: true })).toBe(false);
  });
});

describe('registerUser records the role', () => {
  it('marks a guardian signup as a guardian account', async () => {
    await registerUser('bob', 'password123', { isGuardian: true });
    expect(db().rows('profiles')[0].is_guardian).toBe(true);
  });

  it('defaults to a patient account', async () => {
    await registerUser('alice', 'password123');
    expect(db().rows('profiles')[0].is_guardian).toBe(false);
  });
});

describe('notifyMode', () => {
  it('offers exactly three modes', () => {
    expect(NOTIFY_MODES.map((m) => m.id)).toEqual(['missed', 'intake', 'both']);
    for (const m of NOTIFY_MODES) expect(m.label).toBeTruthy();
  });

  it('defaults to missed-only for a blank or unknown value', () => {
    expect(notifyModeOf(null)).toBe('missed');
    expect(notifyModeOf({ settings: {} })).toBe('missed');
    expect(notifyModeOf({ settings: { notifyMode: 'everything' } })).toBe('missed');
  });

  it('reads a valid stored value', () => {
    for (const id of ['missed', 'intake', 'both']) {
      expect(notifyModeOf({ settings: { notifyMode: id } })).toBe(id);
    }
  });

  it('maps each mode to the right alert types', () => {
    expect(wantsMissedAlerts('missed')).toBe(true);
    expect(wantsIntakeAlerts('missed')).toBe(false);

    expect(wantsMissedAlerts('intake')).toBe(false);
    expect(wantsIntakeAlerts('intake')).toBe(true);

    expect(wantsMissedAlerts('both')).toBe(true);
    expect(wantsIntakeAlerts('both')).toBe(true);
  });
});

describe('intake alerts follow the setting', () => {
  it.each([
    ['intake', true],
    ['both', true],
    ['missed', false],
  ])('notifyMode=%s -> taken push sent: %s', async (mode, expected) => {
    await pairedPatient(mode);
    await notifyGuardianTaken('alice', 'Aspirin');

    if (expected) {
      expect(pushes()).toHaveLength(1);
      expect(pushes()[0].title).toBe('Medicine taken');
      expect(pushes()[0].to).toBe('ExponentPushToken[bob]');
    } else {
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  });
});

describe('missed alerts follow the setting', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 12, 0, 0, 0));
  });

  it.each([
    ['missed', true],
    ['both', true],
    ['intake', false],
  ])('notifyMode=%s -> missed push sent: %s', async (mode, expected) => {
    const { alice } = await pairedPatient(mode);
    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    profile.settings = { ...profile.settings, graceMinutes: 10 };

    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await sweepMissedDoses();

    if (expected) {
      expect(pushes()).toHaveLength(1);
      expect(pushes()[0].title).toBe('Missed medicine alert');
    } else {
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  });

  it('records the miss in history even when the push is suppressed', async () => {
    const { alice } = await pairedPatient('intake');
    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    profile.settings = { ...profile.settings, graceMinutes: 10 };

    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await sweepMissedDoses();

    expect(globalThis.fetch).not.toHaveBeenCalled();
    const missed = db().rows('dose_history').filter((r) => r.status === 'missed');
    expect(missed).toHaveLength(1);
    expect(missed[0].medicine_id).toBe(id);
  });

  it('still only records the miss once across repeated sweeps', async () => {
    const { alice } = await pairedPatient('intake');
    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    profile.settings = { ...profile.settings, graceMinutes: 10 };
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });

    await sweepMissedDoses();
    await sweepMissedDoses();
    await sweepMissedDoses();

    expect(
      db().rows('dose_history').filter((r) => r.status === 'missed')
    ).toHaveLength(1);
  });
});

describe('notifyPatientOfRequest', () => {
  async function guardianOf(patientOpts = {}) {
    const alice = db().makeUser('alice', patientOpts);
    await signIn('bob', { isGuardian: true });
    const bob = db().session.user;
    db().link(alice.id, bob.id);
    return { alice, bob };
  }

  it('pushes to the patient`s device, not the guardian`s', async () => {
    const { alice } = await guardianOf({ push_token: 'ExponentPushToken[alice]' });

    expect(await notifyPatientOfRequest(alice.id, 'Vitamin D')).toBe(true);
    expect(pushes()).toHaveLength(1);
    const [push] = pushes();
    expect(push.to).toBe('ExponentPushToken[alice]');
    expect(push.title).toBe('Your guardian added a medicine');
    expect(push.body).toContain('Vitamin D');
    expect(push.data).toEqual({
      type: 'guardian-request',
      medicineName: 'Vitamin D',
    });
  });

  it('falls back to a generic body without a medicine name', async () => {
    const { alice } = await guardianOf({ push_token: 'ExponentPushToken[alice]' });
    await notifyPatientOfRequest(alice.id);
    expect(pushes()[0].body).toBe('A medicine is waiting for your approval.');
  });

  it('does nothing when the patient has no push token', async () => {
    const { alice } = await guardianOf();
    expect(await notifyPatientOfRequest(alice.id)).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does nothing without a patient id', async () => {
    await guardianOf({ push_token: 'ExponentPushToken[alice]' });
    expect(await notifyPatientOfRequest(null, 'Vitamin D')).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('cannot reach a patient the guardian is not linked to', async () => {
    // RLS hides the profile, so there is no token to read.
    const stranger = db().makeUser('stranger', {
      push_token: 'ExponentPushToken[stranger]',
    });
    await signIn('bob', { isGuardian: true });

    expect(await notifyPatientOfRequest(stranger.id, 'Vitamin D')).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('never throws when delivery fails', async () => {
    const { alice } = await guardianOf({ push_token: 'ExponentPushToken[alice]' });
    globalThis.fetch = jest.fn(async () => {
      throw new Error('offline');
    });
    await expect(notifyPatientOfRequest(alice.id, 'Vitamin D')).resolves.toBe(false);
  });
});
