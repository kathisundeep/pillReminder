// App shell: initial routing, the notification action buttons (Taken /
// Reschedule / Skip), foreground sweeps, and listener cleanup.

import { render, act, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import App from '../../App';
import {
  registerUser,
  loginUser,
  addMedicine,
} from '../../src/utils/storage';
import { SWEEP_TASK, sweepMissedDoses } from '../../src/utils/guardian';

const db = () => globalThis.__db;
const history = () => db().rows('dose_history');
// Statuses a user action writes. 'missed' is written by the background sweep,
// which is not what these assertions are about.
const userLoggedDoses = () =>
  history().filter((r) => r.status !== 'missed');
const pushes = () =>
  globalThis.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

async function flush(times = 30) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountApp() {
  const utils = render(<App />);
  await flush();
  return utils;
}

async function signIn(username = 'alice') {
  await registerUser(username, 'password123');
  await loginUser(username, 'password123');
  return db().session.user;
}

const alarmResponse = (actionIdentifier, data) => ({
  actionIdentifier,
  notification: { request: { content: { data } } },
});

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  // Inside the default 30-minute grace for an 08:00 dose: the startup sweep
  // stays quiet, so these tests observe only what they trigger themselves.
  jest.setSystemTime(new Date(2025, 5, 10, 8, 5, 0, 0));
});

describe('App — startup', () => {
  it('sets up notification permissions and channels', async () => {
    await mountApp();
    expect(Notifications.getPermissionsAsync).toHaveBeenCalled();
    expect(Object.keys(Notifications.__state.channels)).toEqual(
      expect.arrayContaining([
        'pill-alarm-classic', 'pill-alarm-chime', 'pill-alarm-bell',
        'pill-alarm-siren', 'pill-alarm-gentle', 'guardian-alerts',
      ])
    );
  });

  it('registers the notification action buttons', async () => {
    await mountApp();
    expect(Notifications.__state.categories['pill-alarm-actions']).toBeDefined();
  });

  it('registers the periodic background sweep', async () => {
    await mountApp();
    expect(await TaskManager.isTaskRegisteredAsync(SWEEP_TASK)).toBe(true);
  });

  it('re-arms alarms from the cloud for a signed-in user', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00', '20:00'] });
    Notifications.__reset();

    await mountApp();
    expect(Notifications.__state.scheduled).toHaveLength(2);
  });

  it('does not arm alarms when signed out', async () => {
    await mountApp();
    expect(Notifications.__state.scheduled).toHaveLength(0);
  });

  it('registers a push token so the device can act as a guardian', async () => {
    const user = await signIn();
    await mountApp();
    expect(db().rows('profiles').find((p) => p.id === user.id).push_token).toBe(
      'ExponentPushToken[test-device]'
    );
  });

  it('prunes history older than two years on launch', async () => {
    const user = await signIn();
    db().seed('dose_history', [
      { user_id: user.id, medicine_id: null, day: '2019-01-01', status: 'taken' },
      { user_id: user.id, medicine_id: null, day: '2025-06-10', status: 'taken' },
    ]);

    await mountApp();
    expect(history().map((r) => r.day)).toEqual(['2025-06-10']);
  });

  it('subscribes to both notification listeners and to AppState', async () => {
    await mountApp();
    expect(Notifications.__state.receivedListeners).toHaveLength(1);
    expect(Notifications.__state.responseListeners).toHaveLength(1);
  });

  it('removes every listener on unmount', async () => {
    const { unmount } = await mountApp();
    await act(async () => {
      unmount();
    });
    expect(Notifications.__state.receivedListeners).toHaveLength(0);
    expect(Notifications.__state.responseListeners).toHaveLength(0);
  });
});

describe('App — notification arrives', () => {
  it('opens the alarm screen for an incoming pill alarm', async () => {
    await signIn();
    await mountApp();

    await act(async () => {
      Notifications.__emitReceived({
        request: {
          content: {
            data: { type: 'pill-alarm', medicineId: 'm1', medicineName: 'Aspirin' },
          },
        },
      });
    });
    await flush();
    // Navigating to a registered route must not throw.
    expect(Notifications.__state.receivedListeners).toHaveLength(1);
  });

  it('ignores a notification that is not a pill alarm', async () => {
    await signIn();
    await mountApp();

    await act(async () => {
      Notifications.__emitReceived({
        request: { content: { data: { type: 'guardian-alert' } } },
      });
    });
    await flush();
    expect(history()).toHaveLength(0);
  });

  it('tolerates a notification with no data payload at all', async () => {
    await signIn();
    await mountApp();
    await act(async () => {
      Notifications.__emitReceived({ request: { content: {} } });
    });
    await flush();
    expect(history()).toHaveLength(0);
  });
});

describe('App — notification action buttons', () => {
  let medicineId;

  beforeEach(async () => {
    await signIn();
    medicineId = await addMedicine(null, {
      name: 'Aspirin', times: ['08:00'], snoozeMinutes: 15, toneId: 'siren',
    });
    await mountApp();
    Notifications.__state.scheduled = [];
  });

  it('TAKEN records the dose against its own slot', async () => {
    await act(async () => {
      await Notifications.__emitResponse(
        alarmResponse('TAKEN', {
          type: 'pill-alarm', medicineId, medicineName: 'Aspirin', slot: '08:00',
        })
      );
    });
    await flush();

    const taken = history().filter((r) => r.status === 'taken');
    expect(taken).toHaveLength(1);
    expect(taken[0].medicine_id).toBe(medicineId);
    expect(taken[0].slot).toBe('08:00');
  });

  it('TAKEN notifies a guardian who opted into "both"', async () => {
    const alice = db().session.user;
    const bob = db().makeUser('bob', { push_token: 'ExponentPushToken[bob]' });
    db().link(alice.id, bob.id);
    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    profile.settings = { ...profile.settings, notifyMode: 'both' };
    globalThis.fetch.mockClear();

    await act(async () => {
      await Notifications.__emitResponse(
        alarmResponse('TAKEN', { type: 'pill-alarm', medicineId, medicineName: 'Aspirin' })
      );
    });
    await flush();

    expect(pushes().some((p) => p.title === 'Medicine taken')).toBe(true);
  });

  it('RESCHEDULE logs a snooze and re-arms using the medicine`s own duration', async () => {
    await act(async () => {
      await Notifications.__emitResponse(
        alarmResponse('RESCHEDULE', { type: 'pill-alarm', medicineId, medicineName: 'Aspirin' })
      );
    });
    await flush();

    expect(history().filter((r) => r.status === 'snoozed')).toHaveLength(1);
    const snooze = Notifications.__state.scheduled.find(
      (n) => n.content.title === 'Snoozed reminder'
    );
    expect(snooze).toBeDefined();
    expect(snooze.trigger.seconds).toBe(900); // 15 minutes
  });

  it('RESCHEDULE carries the slot forward to the re-alarm', async () => {
    await act(async () => {
      await Notifications.__emitResponse(
        alarmResponse('RESCHEDULE', {
          type: 'pill-alarm', medicineId, medicineName: 'Aspirin', slot: '08:00',
        })
      );
    });
    await flush();

    expect(history().filter((r) => r.status === 'snoozed')[0].slot).toBe('08:00');
    const snooze = Notifications.__state.scheduled.find(
      (n) => n.content.title === 'Snoozed reminder'
    );
    expect(snooze.content.data.slot).toBe('08:00');
  });

  // Was BUG-08 — now fixed.
  it('RESCHEDULE keeps the medicine`s chosen tone', async () => {
    await act(async () => {
      await Notifications.__emitResponse(
        alarmResponse('RESCHEDULE', { type: 'pill-alarm', medicineId, medicineName: 'Aspirin' })
      );
    });
    await flush();

    const snooze = Notifications.__state.scheduled.find(
      (n) => n.content.title === 'Snoozed reminder'
    );
    expect(snooze.content.sound).toBe('siren');
    expect(snooze.trigger.channelId).toBe('pill-alarm-siren');
  });

  it('RESCHEDULE falls back to 10 minutes for an unknown medicine', async () => {
    await act(async () => {
      await Notifications.__emitResponse(
        alarmResponse('RESCHEDULE', {
          type: 'pill-alarm', medicineId: 'not-a-real-id', medicineName: 'Ghost',
        })
      );
    });
    await flush();

    const snooze = Notifications.__state.scheduled.find(
      (n) => n.content.title === 'Snoozed reminder'
    );
    expect(snooze.trigger.seconds).toBe(600);
  });

  it('SKIP records a skip against its own slot', async () => {
    await act(async () => {
      await Notifications.__emitResponse(
        alarmResponse('SKIP', {
          type: 'pill-alarm', medicineId, medicineName: 'Aspirin', slot: '08:00',
        })
      );
    });
    await flush();
    const skipped = history().filter((r) => r.status === 'skipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0].slot).toBe('08:00');
  });

  it('SKIP triggers the guardian sweep', async () => {
    const alice = db().session.user;
    const bob = db().makeUser('bob', { push_token: 'ExponentPushToken[bob]' });
    db().link(alice.id, bob.id);
    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    profile.settings = { ...profile.settings, graceMinutes: 5 };
    globalThis.fetch.mockClear();

    // 08:00 dose, skipped now (08:30) -> the skip pushes the deadline to 08:35,
    // so nothing is sent yet.
    jest.setSystemTime(new Date(2025, 5, 10, 8, 30, 0, 0));
    await act(async () => {
      await Notifications.__emitResponse(
        alarmResponse('SKIP', {
          type: 'pill-alarm', medicineId, medicineName: 'Aspirin', slot: '08:00',
        })
      );
    });
    await flush();

    expect(history().filter((r) => r.status === 'skipped')).toHaveLength(1);
    expect(pushes()).toHaveLength(0);

    // Once that deadline passes, the next sweep reports it as a skip.
    jest.setSystemTime(new Date(2025, 5, 10, 8, 40, 0, 0));
    await act(async () => {
      await sweepMissedDoses();
    });
    await flush();

    expect(pushes().some((p) => p.title === 'Skipped medicine alert')).toBe(true);
  });

  it('a plain tap records nothing and opens the alarm screen instead', async () => {
    await act(async () => {
      await Notifications.__emitResponse(
        alarmResponse('expo.modules.notifications.actions.DEFAULT', {
          type: 'pill-alarm', medicineId, medicineName: 'Aspirin',
        })
      );
    });
    await flush();
    expect(userLoggedDoses()).toHaveLength(0);
  });

  it('ignores an action on a non-pill-alarm notification', async () => {
    await act(async () => {
      await Notifications.__emitResponse(
        alarmResponse('TAKEN', { type: 'guardian-alert' })
      );
    });
    await flush();
    expect(userLoggedDoses()).toHaveLength(0);
  });

  it('records nothing when the session has expired', async () => {
    // eslint-disable-next-line global-require
    await require('../../src/utils/storage').logoutUser();

    await act(async () => {
      await Notifications.__emitResponse(
        alarmResponse('TAKEN', { type: 'pill-alarm', medicineId, medicineName: 'Aspirin' })
      );
    });
    await flush();
    expect(userLoggedDoses()).toHaveLength(0);
  });
});

describe('App — foreground sweep', () => {
  it('re-checks for missed doses when the app returns to the foreground', async () => {
    const alice = await signIn();
    const bob = db().makeUser('bob', { push_token: 'ExponentPushToken[bob]' });
    db().link(alice.id, bob.id);
    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    profile.settings = { ...profile.settings, graceMinutes: 10 };
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });

    // Launch inside the grace window so the startup sweep stays quiet and does
    // not consume the once-per-day alert.
    jest.setSystemTime(new Date(2025, 5, 10, 8, 5, 0, 0));
    const spy = jest.spyOn(AppState, 'addEventListener');
    await mountApp();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    // Time passes while the app is backgrounded; the dose is now overdue.
    jest.setSystemTime(new Date(2025, 5, 10, 8, 20, 0, 0));

    const [[eventName, handler]] = spy.mock.calls.filter(([e]) => e === 'change');
    expect(eventName).toBe('change');
    globalThis.fetch.mockClear();

    await act(async () => {
      handler('active');
    });
    await flush();

    expect(pushes().some((p) => p.title === 'Missed medicine alert')).toBe(true);
  });

  it('does not sweep when the app goes to the background', async () => {
    const alice = await signIn();
    const bob = db().makeUser('bob', { push_token: 'ExponentPushToken[bob]' });
    db().link(alice.id, bob.id);
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });

    const spy = jest.spyOn(AppState, 'addEventListener');
    await mountApp();
    const [[, handler]] = spy.mock.calls.filter(([e]) => e === 'change');
    globalThis.fetch.mockClear();

    await act(async () => {
      handler('background');
    });
    await flush();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('App — role gating', () => {
  async function mountAs(username, opts) {
    await registerUser(username, 'password123', opts);
    await loginUser(username, 'password123');
    return mountApp();
  }

  it('a guardian never lands on the patient Home screen', async () => {
    await mountAs('bob', { isGuardian: true });
    // The guardian dashboard is what renders; Home does not exist in this flow.
    expect(screen.getByText('Guardian Dashboard')).toBeTruthy();
    expect(screen.queryByText("Today's Doses")).toBeNull();
  });

  it('a patient lands on Home, not the guardian dashboard', async () => {
    await mountAs('alice');
    expect(screen.getByText("Today's Doses")).toBeTruthy();
    expect(screen.getByText('Patient View')).toBeTruthy();
    expect(screen.queryByText('Link a person')).toBeNull();
  });

  it('shows the login screen when signed out', async () => {
    await mountApp();
    expect(screen.getByText('Pill Reminder')).toBeTruthy();
  });

  it('does not arm alarms or prune history for a guardian', async () => {
    const bob = await (async () => {
      await registerUser('bob', 'password123', { isGuardian: true });
      await loginUser('bob', 'password123');
      return db().session.user;
    })();
    // A guardian account should have nothing to arm, but prove the startup
    // path is skipped rather than merely finding an empty list.
    db().seed('dose_history', [
      { user_id: bob.id, medicine_id: null, day: '2019-01-01', status: 'taken' },
    ]);

    await mountApp();

    expect(Notifications.__state.scheduled).toHaveLength(0);
    // pruneOldHistory() is patient-only, so the ancient row survives.
    expect(history()).toHaveLength(1);
  });

  it('registers a push token for a guardian so requests can be delivered', async () => {
    await registerUser('bob', 'password123', { isGuardian: true });
    await loginUser('bob', 'password123');
    const bob = db().session.user;

    await mountApp();
    expect(db().rows('profiles').find((p) => p.id === bob.id).push_token).toBe(
      'ExponentPushToken[test-device]'
    );
  });
});

describe('App — guardian request notification', () => {
  it('a tap on the request push takes the patient to Approvals', async () => {
    await signIn('alice');
    await mountApp();

    await act(async () => {
      await Notifications.__emitResponse({
        actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
        notification: {
          request: {
            content: {
              data: { type: 'guardian-request', medicineName: 'Vitamin D' },
            },
          },
        },
      });
    });
    await flush();

    // Approvals is a registered patient route, so navigating must not throw
    // and must not be mistaken for a pill alarm.
    expect(history()).toHaveLength(0);
  });

  it('a guardian-request push is ignored by the dose handlers', async () => {
    await signIn('alice');
    const medicineId = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await mountApp();

    await act(async () => {
      await Notifications.__emitResponse({
        actionIdentifier: 'TAKEN',
        notification: {
          request: { content: { data: { type: 'guardian-request', medicineId } } },
        },
      });
    });
    await flush();

    expect(history().filter((r) => r.status === 'taken')).toHaveLength(0);
  });
});
