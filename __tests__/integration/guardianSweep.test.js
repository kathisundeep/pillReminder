// The missed-dose sweep: the safety-critical path. If this is wrong, a
// guardian is either never told their person missed a dose, or is spammed.

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import {
  SWEEP_TASK,
  sweepMissedDoses,
  notifyGuardianTaken,
  sendPush,
  registerForPushTokenAsync,
  getPushRegistrationError,
  registerBackgroundSweep,
} from '../../src/utils/guardian';
import {
  registerUser,
  loginUser,
  addMedicine,
  recordDose,
} from '../../src/utils/storage';

const db = () => globalThis.__db;
const pushes = () =>
  globalThis.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

// Set the wall clock to a local (IST) time on Tue 10 June 2025.
function atLocal(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  jest.setSystemTime(new Date(2025, 5, 10, h, m, 0, 0));
}

async function patientWithGuardian({ settings = {}, guardianToken = 'ExponentPushToken[bob]' } = {}) {
  const bob = db().makeUser('bob', { push_token: guardianToken });
  await registerUser('alice', 'password123');
  await loginUser('alice', 'password123');
  const alice = db().session.user;

  const profile = db().rows('profiles').find((p) => p.id === alice.id);
  profile.settings = { ...profile.settings, ...settings };
  db().link(alice.id, bob.id);
  return { alice, bob };
}

beforeEach(() => {
  jest.useFakeTimers();
  atLocal('12:00');
});

describe('sweepMissedDoses — when it stays silent', () => {
  it('does nothing when signed out', async () => {
    await sweepMissedDoses();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends nothing when no guardian is linked', async () => {
    await registerUser('alice', 'password123');
    await loginUser('alice', 'password123');
    await addMedicine(null, { name: 'A', times: ['08:00'] });
    atLocal('11:00');
    await sweepMissedDoses();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // Was BUG-07: the sweep returned early with no guardian, and recordDose lived
  // below that guard — so a user without a guardian accumulated no missed-dose
  // history at all, and their health report was silently incomplete.
  it('still records the miss when there is no guardian to tell', async () => {
    await registerUser('alice', 'password123');
    await loginUser('alice', 'password123');
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });

    atLocal('11:00');
    await sweepMissedDoses();

    const missed = db().rows('dose_history').filter((r) => r.status === 'missed');
    expect(missed).toHaveLength(1);
    expect(missed[0].medicine_id).toBe(id);
    expect(missed[0].slot).toBe('08:00');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('records the miss when the guardian has no push token either', async () => {
    await patientWithGuardian({ guardianToken: null });
    await addMedicine(null, { name: 'A', times: ['08:00'] });
    atLocal('11:00');
    await sweepMissedDoses();

    expect(
      db().rows('dose_history').filter((r) => r.status === 'missed')
    ).toHaveLength(1);
  });

  it('does nothing when the guardian has no push token', async () => {
    await patientWithGuardian({ guardianToken: null });
    await addMedicine(null, { name: 'A', times: ['08:00'] });
    atLocal('11:00');
    await sweepMissedDoses();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('stays silent before any dose time has passed', async () => {
    await patientWithGuardian();
    await addMedicine(null, { name: 'A', times: ['08:00'] });
    atLocal('07:00');
    await sweepMissedDoses();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('stays silent inside the grace period', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 30 } });
    await addMedicine(null, { name: 'A', times: ['08:00'] });
    atLocal('08:20');
    await sweepMissedDoses();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('stays silent once the dose is taken', async () => {
    await patientWithGuardian();
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    await recordDose(null, id, 'taken', '08:00');
    atLocal('11:00');
    await sweepMissedDoses();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('respects the per-medicine "alert guardian" opt-out', async () => {
    await patientWithGuardian();
    await addMedicine(null, { name: 'A', times: ['08:00'], alertGuardian: false });
    atLocal('11:00');
    await sweepMissedDoses();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('ignores a medicine not scheduled for today', async () => {
    await patientWithGuardian();
    // 10 June 2025 is a Tuesday (getDay() === 2).
    await addMedicine(null, {
      name: 'A', times: ['08:00'], frequency: 'weekly', daysOfWeek: [0, 6],
    });
    atLocal('11:00');
    await sweepMissedDoses();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('stays silent while a snooze re-alarm has not fired yet', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 5 } });
    const id = await addMedicine(null, { name: 'A', times: ['08:00'], snoozeMinutes: 30 });
    atLocal('08:10');
    await recordDose(null, id, 'snoozed', '08:00');
    atLocal('08:20'); // re-alarm is due at 08:40
    await sweepMissedDoses();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('stays silent inside the grace period after a snooze re-alarm', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 30 } });
    const id = await addMedicine(null, { name: 'A', times: ['08:00'], snoozeMinutes: 10 });
    atLocal('08:05');
    await recordDose(null, id, 'snoozed', '08:00');
    atLocal('08:30'); // re-alarm 08:15, deadline 08:45
    await sweepMissedDoses();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('sweepMissedDoses — when it alerts', () => {
  // A plan can allow several guardians; each of them is told.
  it('alerts every linked guardian', async () => {
    const { alice } = await patientWithGuardian({ settings: { graceMinutes: 30 } });
    const carol = db().makeUser('carol', { push_token: 'ExponentPushToken[carol]' });
    db().link(alice.id, carol.id);
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    atLocal('08:31');
    await sweepMissedDoses();

    const to = globalThis.fetch.mock.calls.map(([, init]) => JSON.parse(init.body).to);
    expect(to).toHaveLength(2);
    expect(to).toContain('ExponentPushToken[carol]');
  });

  it('alerts once the grace period has elapsed', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 30 } });
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    atLocal('08:31');
    await sweepMissedDoses();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [push] = pushes();
    expect(push.to).toBe('ExponentPushToken[bob]');
    expect(push.title).toBe('Missed medicine alert');
    expect(push.body).toContain('alice');
    expect(push.body).toContain('Aspirin');
    expect(push.body).toContain('8:00 AM');
    expect(push.channelId).toBe('guardian-alerts');
    expect(push.priority).toBe('high');
    expect(push.data).toMatchObject({ type: 'guardian-alert', medicineName: 'Aspirin' });
  });

  it('honours a custom grace period', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 5 } });
    await addMedicine(null, { name: 'A', times: ['08:00'] });

    atLocal('08:04');
    await sweepMissedDoses();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    atLocal('08:06');
    await sweepMissedDoses();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('defaults to a 30-minute grace when the profile has none', async () => {
    await patientWithGuardian({ settings: { graceMinutes: undefined } });
    await addMedicine(null, { name: 'A', times: ['08:00'] });

    atLocal('08:29');
    await sweepMissedDoses();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    atLocal('08:31');
    await sweepMissedDoses();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('sends a distinct message for an explicit skip', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 10 } });
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    atLocal('08:05');
    await recordDose(null, id, 'skipped', '08:00');
    atLocal('08:20');
    await sweepMissedDoses();

    const [push] = pushes();
    expect(push.title).toBe('Skipped medicine alert');
    expect(push.body).toContain('skipped Aspirin');
  });

  it('alerts after the snooze re-alarm plus grace has passed', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 10 } });
    const id = await addMedicine(null, { name: 'A', times: ['08:00'], snoozeMinutes: 15 });
    atLocal('08:05');
    await recordDose(null, id, 'snoozed', '08:00');
    atLocal('08:31'); // re-alarm 08:20, deadline 08:30
    await sweepMissedDoses();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('records a "missed" entry alongside the alert', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 10 } });
    const id = await addMedicine(null, { name: 'A', times: ['08:00'] });
    atLocal('08:20');
    await sweepMissedDoses();

    const missed = db().rows('dose_history').filter((r) => r.status === 'missed');
    expect(missed).toHaveLength(1);
    expect(missed[0].medicine_id).toBe(id);
  });

  it('alerts at most once per dose per day', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 10 } });
    await addMedicine(null, { name: 'A', times: ['08:00'] });
    atLocal('08:20');

    await sweepMissedDoses();
    await sweepMissedDoses();
    await sweepMissedDoses();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('alerts separately for each missed medicine', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 10 } });
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await addMedicine(null, { name: 'Metformin', times: ['08:00'] });
    atLocal('08:20');
    await sweepMissedDoses();

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(pushes().map((p) => p.data.medicineName).sort()).toEqual([
      'Aspirin', 'Metformin',
    ]);
  });

  it('never throws, even if the push endpoint is down', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 10 } });
    await addMedicine(null, { name: 'A', times: ['08:00'] });
    globalThis.fetch = jest.fn(async () => {
      throw new Error('network unreachable');
    });
    atLocal('08:20');
    await expect(sweepMissedDoses()).resolves.toBeUndefined();
  });

  // Was BUG-12: a failed delivery still marked the day as alerted, so the
  // guardian was never told even once their device came back.
  it('retries on a later sweep when delivery failed', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 10 } });
    await addMedicine(null, { name: 'A', times: ['08:00'] });

    globalThis.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ data: { status: 'error', message: 'DeviceNotRegistered' } }),
    }));
    atLocal('08:20');
    await sweepMissedDoses();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Guardian re-registers; the next sweep tries again and succeeds.
    globalThis.fetch = jest.fn(async () => ({
      ok: true, status: 200, json: async () => ({ data: { status: 'ok' } }),
    }));
    atLocal('09:00');
    await sweepMissedDoses();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('stops retrying once the guardian has actually been reached', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 10 } });
    await addMedicine(null, { name: 'A', times: ['08:00'] });

    atLocal('08:20');
    await sweepMissedDoses();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    atLocal('09:00');
    await sweepMissedDoses();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

// Was BUG-06: doses were keyed by day only, and the sweep looked at just the
// most recent passed time — so a missed morning dose disappeared the moment the
// evening dose came around.
describe('sweepMissedDoses — multi-dose medicines', () => {
  it('reports a missed morning dose even after the evening one is taken', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 30 } });
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00', '20:00'] });

    atLocal('20:05');
    await recordDose(null, id, 'taken', '20:00'); // evening dose only

    atLocal('20:40');
    await sweepMissedDoses();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(pushes()[0].data.slot).toBe('08:00');
    expect(pushes()[0].title).toBe('Missed medicine alert');
  });

  it('measures every passed dose, not only the latest', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 30 } });
    await addMedicine(null, { name: 'Aspirin', times: ['08:00', '20:00'] });

    // 20:00 has only just passed, but 08:00 is 12 hours overdue.
    atLocal('20:05');
    await sweepMissedDoses();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(pushes()[0].data.slot).toBe('08:00');
  });

  it('alerts separately for each missed dose of the same medicine', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 10 } });
    await addMedicine(null, { name: 'Aspirin', times: ['08:00', '14:00'] });

    atLocal('08:20');
    await sweepMissedDoses();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    atLocal('14:20');
    await sweepMissedDoses();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(pushes().map((p) => p.data.slot)).toEqual(['08:00', '14:00']);
  });

  it('does not re-alert for a dose it has already reported', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 10 } });
    await addMedicine(null, { name: 'Aspirin', times: ['08:00', '14:00'] });

    atLocal('14:20');
    await sweepMissedDoses();
    await sweepMissedDoses();
    await sweepMissedDoses();

    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // one per dose, once each
  });

  it('records one missed entry per dose', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 10 } });
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00', '14:00'] });

    atLocal('14:20');
    await sweepMissedDoses();
    await sweepMissedDoses();

    const missed = db().rows('dose_history').filter((r) => r.status === 'missed');
    expect(missed.map((r) => r.slot)).toEqual(['08:00', '14:00']);
    expect(missed.every((r) => r.medicine_id === id)).toBe(true);
  });

  it('stays silent for a dose that was taken at its own time', async () => {
    await patientWithGuardian({ settings: { graceMinutes: 10 } });
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00', '14:00'] });

    atLocal('08:05');
    await recordDose(null, id, 'taken', '08:00');
    atLocal('14:05');
    await recordDose(null, id, 'taken', '14:00');

    atLocal('14:30');
    await sweepMissedDoses();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('notifyGuardianTaken', () => {
  it('stays quiet in the default "missed only" mode', async () => {
    await patientWithGuardian();
    await notifyGuardianTaken('alice', 'Aspirin');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('notifies when the user opted into "both"', async () => {
    await patientWithGuardian({ settings: { notifyMode: 'both' } });
    await notifyGuardianTaken('alice', 'Aspirin');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [push] = pushes();
    expect(push.title).toBe('Medicine taken');
    expect(push.body).toBe('alice just took Aspirin.');
    expect(push.data.type).toBe('guardian-taken');
  });

  it('falls back to a generic name when none is given', async () => {
    await patientWithGuardian({ settings: { notifyMode: 'both' } });
    await notifyGuardianTaken('alice', undefined);
    expect(pushes()[0].body).toBe('alice just took their medicine.');
  });

  it('does nothing without a user, and never throws', async () => {
    await patientWithGuardian({ settings: { notifyMode: 'both' } });
    await expect(notifyGuardianTaken(null, 'Aspirin')).resolves.toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does nothing when no guardian has a token', async () => {
    await patientWithGuardian({ settings: { notifyMode: 'both' }, guardianToken: null });
    await notifyGuardianTaken('alice', 'Aspirin');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('sendPush', () => {
  it('posts to the Expo push endpoint with the right shape', async () => {
    expect(await sendPush('ExponentPushToken[x]', { title: 'T', body: 'B' })).toBe(true);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toMatchObject({
      to: 'ExponentPushToken[x]', title: 'T', body: 'B', priority: 'high',
    });
  });

  it('returns false without a token and never calls out', async () => {
    expect(await sendPush(null, { title: 'T' })).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns false when Expo reports an error status', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true, json: async () => ({ data: { status: 'error' } }),
    }));
    expect(await sendPush('t', {})).toBe(false);
  });

  it('returns false when the request throws', async () => {
    globalThis.fetch = jest.fn(async () => { throw new Error('offline'); });
    expect(await sendPush('t', {})).toBe(false);
  });

  it('treats an unparseable response as success (best effort)', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true, json: async () => { throw new Error('not json'); },
    }));
    expect(await sendPush('t', {})).toBe(true);
  });
});

describe('registerForPushTokenAsync', () => {
  it('returns null on a simulator', async () => {
    Device.isDevice = false;
    expect(await registerForPushTokenAsync()).toBeNull();
  });

  it('returns null when notification permission is refused', async () => {
    Notifications.__state.permission = 'denied';
    expect(await registerForPushTokenAsync()).toBeNull();
  });

  it('stores the token locally and on the cloud profile', async () => {
    const alice = db().makeUser('alice');
    db().as(alice);

    const token = await registerForPushTokenAsync();
    expect(token).toBe('ExponentPushToken[test-device]');
    expect(db().rows('profiles').find((p) => p.id === alice.id).push_token).toBe(token);
  });

  it('passes the EAS project id so the token is bound to this project', async () => {
    await registerForPushTokenAsync();
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: 'a1f2f3fa-012b-43f4-bfa9-775ec35cfed6',
    });
  });

  it('returns null instead of throwing when token issuance fails', async () => {
    Notifications.__state.pushTokenError = new Error('no network');
    expect(await registerForPushTokenAsync()).toBeNull();
    expect(getPushRegistrationError()).toMatch(/no network/);
  });

  it('explains a refused permission, and clears the reason once a token is issued', async () => {
    Notifications.__state.permission = 'denied';
    await registerForPushTokenAsync();
    expect(getPushRegistrationError()).toMatch(/turned off/);

    Notifications.__state.permission = 'granted';
    db().as(db().makeUser('bob'));
    await registerForPushTokenAsync();
    expect(getPushRegistrationError()).toBeNull();
  });
});

describe('registerBackgroundSweep', () => {
  it('registers the periodic task at the Android 15-minute floor', async () => {
    expect(await registerBackgroundSweep()).toBe(true);
    expect(BackgroundFetch.registerTaskAsync).toHaveBeenCalledWith(SWEEP_TASK, {
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  });

  it('does not re-register a task that already exists', async () => {
    await registerBackgroundSweep();
    BackgroundFetch.registerTaskAsync.mockClear();
    await registerBackgroundSweep();
    expect(BackgroundFetch.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('gives up when background fetch is denied or restricted', async () => {
    for (const status of [
      BackgroundFetch.BackgroundFetchStatus.Denied,
      BackgroundFetch.BackgroundFetchStatus.Restricted,
    ]) {
      BackgroundFetch.__state.status = status;
      expect(await registerBackgroundSweep()).toBe(false);
      expect(BackgroundFetch.registerTaskAsync).not.toHaveBeenCalled();
    }
  });

  it('defines the sweep task at module load so the OS can relaunch into it', () => {
    expect(TaskManager.defineTask).toBeDefined();
    jest.isolateModules(() => {
      require('../../src/utils/guardian');
    });
    const names = TaskManager.defineTask.mock.calls.map(([n]) => n);
    expect(names).toContain(SWEEP_TASK);
  });

  it('the background task reports NewData and never throws', async () => {
    let task;
    jest.isolateModules(() => {
      require('../../src/utils/guardian');
    });
    const call = TaskManager.defineTask.mock.calls.find(([n]) => n === SWEEP_TASK);
    [, task] = call;
    await expect(task()).resolves.toBe(
      BackgroundFetch.BackgroundFetchResult.NewData
    );
  });
});
