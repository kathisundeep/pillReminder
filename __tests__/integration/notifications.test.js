import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import {
  TONES,
  ensureNotificationSetup,
  getPermissionStatus,
  scheduleDailyAlarm,
  scheduleWeeklyAlarm,
  scheduleSnooze,
  scheduleForMedicine,
  resyncAlarms,
  listScheduled,
  cancelNotification,
  cancelManyNotifications,
} from '../../src/utils/notifications';

const scheduled = () => Notifications.__state.scheduled;

describe('ensureNotificationSetup', () => {
  it('returns false on a simulator without asking for permission', async () => {
    Device.isDevice = false;
    expect(await ensureNotificationSetup()).toBe(false);
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not re-prompt when permission is already granted', async () => {
    expect(await ensureNotificationSetup()).toBe(true);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('prompts when permission has not been granted yet', async () => {
    Notifications.__state.permission = 'undetermined';
    await ensureNotificationSetup();
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
  });

  it('returns false and creates no channels when permission is denied', async () => {
    Notifications.__state.permission = 'denied';
    expect(await ensureNotificationSetup()).toBe(false);
    expect(Object.keys(Notifications.__state.channels)).toHaveLength(0);
  });

  it('creates one Android channel per tone, each with that tone`s sound', async () => {
    await ensureNotificationSetup();
    for (const tone of TONES) {
      const channel = Notifications.__state.channels[tone.channelId];
      expect(channel).toBeDefined();
      expect(channel.sound).toBe(tone.sound);
      expect(channel.importance).toBe(Notifications.AndroidImportance.MAX);
      expect(channel.bypassDnd).toBe(true);
      expect(channel.lockscreenVisibility).toBe(
        Notifications.AndroidNotificationVisibility.PUBLIC
      );
    }
  });

  it('creates a separate lower-priority channel for guardian alerts', async () => {
    await ensureNotificationSetup();
    const channel = Notifications.__state.channels['guardian-alerts'];
    expect(channel).toBeDefined();
    expect(channel.importance).toBe(Notifications.AndroidImportance.HIGH);
  });

  it('deletes the superseded v1 channel so its old sound cannot linger', async () => {
    await ensureNotificationSetup();
    expect(Notifications.__state.deletedChannels).toContain('pill-alarm');
  });

  it('registers the Taken / Reschedule / Skip action buttons', async () => {
    await ensureNotificationSetup();
    const actions = Notifications.__state.categories['pill-alarm-actions'];
    expect(actions.map((a) => a.identifier)).toEqual([
      'TAKEN',
      'RESCHEDULE',
      'SKIP',
    ]);
    for (const a of actions) {
      expect(a.buttonTitle).toBeTruthy();
      // Each must open the app: the handlers in App.js need a running JS context.
      expect(a.options.opensAppToForeground).toBe(true);
    }
  });

  // Was BUG-11: the category registration sat inside the Android-only block, so
  // iOS notifications had no action buttons at all.
  it('registers the action buttons on iOS too', async () => {
    const original = Platform.OS;
    Platform.OS = 'ios';
    try {
      expect(await ensureNotificationSetup()).toBe(true);
      expect(
        Notifications.__state.categories['pill-alarm-actions'].map((a) => a.identifier)
      ).toEqual(['TAKEN', 'RESCHEDULE', 'SKIP']);
      // ...but no Android channels, which do not exist on iOS.
      expect(Object.keys(Notifications.__state.channels)).toHaveLength(0);
    } finally {
      Platform.OS = original;
    }
  });

  it('is idempotent — running twice leaves the same channel set', async () => {
    await ensureNotificationSetup();
    const first = Object.keys(Notifications.__state.channels).sort();
    await ensureNotificationSetup();
    expect(Object.keys(Notifications.__state.channels).sort()).toEqual(first);
  });
});

describe('getPermissionStatus', () => {
  it('reports the current status verbatim', async () => {
    Notifications.__state.permission = 'denied';
    expect(await getPermissionStatus()).toBe('denied');
  });
});

describe('scheduleDailyAlarm', () => {
  it('schedules a repeating daily trigger at the given time', async () => {
    const id = await scheduleDailyAlarm({
      medicineId: 'm1',
      medicineName: 'Aspirin',
      hour: 8,
      minute: 30,
      toneId: 'classic',
    });
    expect(id).toBe('notif-1');
    expect(scheduled()).toHaveLength(1);
    expect(scheduled()[0].trigger).toEqual({
      hour: 8,
      minute: 30,
      repeats: true,
      channelId: 'pill-alarm-classic',
    });
  });

  it('carries the medicine identity and slot so taps can route and record', async () => {
    await scheduleDailyAlarm({
      medicineId: 'm1',
      medicineName: 'Aspirin',
      hour: 8,
      minute: 0,
    });
    expect(scheduled()[0].content.data).toEqual({
      medicineId: 'm1',
      medicineName: 'Aspirin',
      slot: '08:00',
      type: 'pill-alarm',
    });
  });

  it('zero-pads the slot so it matches the stored medicine time', async () => {
    await scheduleDailyAlarm({
      medicineId: 'm1', medicineName: 'A', hour: 7, minute: 5,
    });
    expect(scheduled()[0].content.data.slot).toBe('07:05');
  });

  it('attaches the action category and max priority', async () => {
    await scheduleDailyAlarm({ medicineId: 'm1', medicineName: 'A', hour: 8, minute: 0 });
    const { content } = scheduled()[0];
    expect(content.categoryIdentifier).toBe('pill-alarm-actions');
    expect(content.priority).toBe(Notifications.AndroidNotificationPriority.MAX);
    expect(content.sticky).toBe(true);
    expect(content.autoDismiss).toBe(false);
  });

  it('routes each tone to its own channel AND sets the matching sound', async () => {
    for (const tone of TONES) {
      Notifications.__reset();
      await scheduleDailyAlarm({
        medicineId: 'm1',
        medicineName: 'A',
        hour: 8,
        minute: 0,
        toneId: tone.id,
      });
      expect(scheduled()[0].trigger.channelId).toBe(tone.channelId);
      expect(scheduled()[0].content.sound).toBe(tone.sound);
    }
  });

  it('falls back to Classic for an unknown tone id', async () => {
    await scheduleDailyAlarm({
      medicineId: 'm1', medicineName: 'A', hour: 8, minute: 0, toneId: 'bogus',
    });
    expect(scheduled()[0].trigger.channelId).toBe('pill-alarm-classic');
    expect(scheduled()[0].content.sound).toBe('alarm');
  });
});

describe('scheduleWeeklyAlarm', () => {
  it('converts a 0-based weekday to the 1-based weekday expo expects', async () => {
    // App stores 0=Sunday..6=Saturday; expo-notifications uses 1=Sunday..7=Sat.
    await scheduleWeeklyAlarm({
      medicineId: 'm1', medicineName: 'A', weekday: 1, hour: 9, minute: 15,
    });
    expect(scheduled()[0].trigger).toEqual({
      weekday: 1, hour: 9, minute: 15, repeats: true, channelId: 'pill-alarm-classic',
    });
  });
});

describe('scheduleSnooze', () => {
  it('fires after the requested number of minutes', async () => {
    await scheduleSnooze({ medicineId: 'm1', medicineName: 'A', minutes: 15 });
    expect(scheduled()[0].trigger.seconds).toBe(900);
    expect(scheduled()[0].trigger.repeats).toBe(false);
  });

  it('never schedules sooner than 60 seconds', async () => {
    for (const minutes of [0, 0.5, -5]) {
      Notifications.__reset();
      await scheduleSnooze({ medicineId: 'm1', medicineName: 'A', minutes });
      expect(scheduled()[0].trigger.seconds).toBe(60);
    }
  });

  // Was BUG-19: Math.max(60, undefined * 60) is NaN, i.e. an alarm that never
  // fires. The floor now guards the arithmetic, not just the result.
  it('falls back to 10 minutes when `minutes` is missing or nonsense', async () => {
    for (const minutes of [undefined, null, 'soon', NaN, {}]) {
      Notifications.__reset();
      // eslint-disable-next-line no-await-in-loop
      await scheduleSnooze({ medicineId: 'm1', medicineName: 'A', minutes });
      expect(scheduled()[0].trigger.seconds).toBe(600);
    }
  });

  it('carries the slot of the dose it postpones', async () => {
    await scheduleSnooze({
      medicineId: 'm1', medicineName: 'A', minutes: 10, slot: '20:00',
    });
    expect(scheduled()[0].content.data.slot).toBe('20:00');
  });

  it('labels the notification as a snooze so it reads differently', async () => {
    await scheduleSnooze({ medicineId: 'm1', medicineName: 'Aspirin', minutes: 10 });
    expect(scheduled()[0].content.title).toBe('Snoozed reminder');
    expect(scheduled()[0].content.body).toBe('Take Aspirin now');
  });

  it('keeps the pill-alarm type so the tap handler still routes it', async () => {
    await scheduleSnooze({ medicineId: 'm1', medicineName: 'A', minutes: 10 });
    expect(scheduled()[0].content.data.type).toBe('pill-alarm');
    expect(scheduled()[0].content.categoryIdentifier).toBe('pill-alarm-actions');
  });

  it('honours the tone when one is passed', async () => {
    await scheduleSnooze({
      medicineId: 'm1', medicineName: 'A', minutes: 10, toneId: 'siren',
    });
    expect(scheduled()[0].content.sound).toBe('siren');
    expect(scheduled()[0].trigger.channelId).toBe('pill-alarm-siren');
  });

  // Documents the consequence of callers omitting toneId. Every in-app caller
  // (App.js, HomeScreen, AlarmScreen) does exactly this, so a user who chose
  // Siren gets Classic on every reschedule. See docs/audit-report.md — BUG-08.
  it('silently downgrades to Classic when no tone is passed', async () => {
    await scheduleSnooze({ medicineId: 'm1', medicineName: 'A', minutes: 10 });
    expect(scheduled()[0].content.sound).toBe('alarm');
    expect(scheduled()[0].trigger.channelId).toBe('pill-alarm-classic');
  });
});

describe('scheduleForMedicine', () => {
  it('schedules one daily alarm per time', async () => {
    const ids = await scheduleForMedicine({
      id: 'm1', name: 'A', times: ['08:00', '14:00', '20:00'], frequency: 'daily',
    });
    expect(ids).toHaveLength(3);
    expect(scheduled().map((n) => n.trigger.hour)).toEqual([8, 14, 20]);
  });

  it('schedules times x days for a weekly medicine', async () => {
    const ids = await scheduleForMedicine({
      id: 'm1', name: 'A', times: ['08:00', '20:00'],
      frequency: 'weekly', daysOfWeek: [1, 3, 5],
    });
    expect(ids).toHaveLength(6);
    expect(scheduled().map((n) => n.trigger.weekday).sort()).toEqual([2, 2, 4, 4, 6, 6]);
  });

  it('treats a weekly medicine with no days as daily', async () => {
    const ids = await scheduleForMedicine({
      id: 'm1', name: 'A', times: ['08:00'], frequency: 'weekly', daysOfWeek: [],
    });
    expect(ids).toHaveLength(1);
    expect(scheduled()[0].trigger.weekday).toBeUndefined();
  });

  it('schedules nothing for a medicine with no times', async () => {
    expect(await scheduleForMedicine({ id: 'm1', name: 'A', times: [] })).toEqual([]);
    expect(scheduled()).toHaveLength(0);
  });

  it('parses HH:MM into numeric hour and minute', async () => {
    await scheduleForMedicine({ id: 'm1', name: 'A', times: ['07:05'] });
    expect(scheduled()[0].trigger.hour).toBe(7);
    expect(scheduled()[0].trigger.minute).toBe(5);
  });
});

describe('resyncAlarms', () => {
  const meds = [
    { id: 'm1', name: 'A', times: ['08:00'], frequency: 'daily', toneId: 'chime' },
    { id: 'm2', name: 'B', times: ['09:00', '21:00'], frequency: 'daily' },
  ];

  it('wipes everything already scheduled before re-arming', async () => {
    await scheduleDailyAlarm({ medicineId: 'stale', medicineName: 'Old', hour: 3, minute: 0 });
    expect(scheduled()).toHaveLength(1);

    await resyncAlarms(meds);
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
    expect(scheduled().map((n) => n.content.data.medicineId).sort()).toEqual([
      'm1', 'm2', 'm2',
    ]);
  });

  it('returns a map of medicine id -> notification ids', async () => {
    const idMap = await resyncAlarms(meds);
    expect(Object.keys(idMap).sort()).toEqual(['m1', 'm2']);
    expect(idMap.m1).toHaveLength(1);
    expect(idMap.m2).toHaveLength(2);
  });

  it('clears all alarms when given an empty list', async () => {
    await resyncAlarms(meds);
    expect(scheduled().length).toBeGreaterThan(0);
    expect(await resyncAlarms([])).toEqual({});
    expect(scheduled()).toHaveLength(0);
  });

  it('tolerates null/undefined', async () => {
    await expect(resyncAlarms(null)).resolves.toEqual({});
    await expect(resyncAlarms(undefined)).resolves.toEqual({});
  });

  it('preserves each medicine`s own tone across a resync', async () => {
    await resyncAlarms(meds);
    const byMed = Object.fromEntries(
      scheduled().map((n) => [n.content.data.medicineId, n.content.sound])
    );
    expect(byMed.m1).toBe('chime');
    expect(byMed.m2).toBe('alarm');
  });

  // Was BUG-09: cancelAll also killed one-shot snoozes, and this runs on every
  // app start — so snoozing a dose and switching apps lost the re-alarm.
  it('preserves a pending snooze that has not fired yet', async () => {
    await scheduleSnooze({
      medicineId: 'm1', medicineName: 'A', minutes: 30, slot: '08:00',
    });

    await resyncAlarms(meds);

    const snoozes = scheduled().filter((n) => n.content.title === 'Snoozed reminder');
    expect(snoozes).toHaveLength(1);
    expect(snoozes[0].trigger.seconds).toBe(1800);
    expect(snoozes[0].content.data.slot).toBe('08:00');
  });

  it('preserves several pending snoozes at once', async () => {
    await scheduleSnooze({ medicineId: 'm1', medicineName: 'A', minutes: 15 });
    await scheduleSnooze({ medicineId: 'm2', medicineName: 'B', minutes: 30 });

    await resyncAlarms(meds);

    expect(
      scheduled().filter((n) => n.content.title === 'Snoozed reminder')
    ).toHaveLength(2);
  });

  it('still clears stale repeating alarms while preserving snoozes', async () => {
    await scheduleDailyAlarm({
      medicineId: 'gone', medicineName: 'Deleted', hour: 3, minute: 0,
    });
    await scheduleSnooze({ medicineId: 'm1', medicineName: 'A', minutes: 15 });

    await resyncAlarms(meds);

    expect(scheduled().some((n) => n.content.data.medicineId === 'gone')).toBe(false);
    expect(scheduled().some((n) => n.content.title === 'Snoozed reminder')).toBe(true);
  });
});

describe('cancellation helpers', () => {
  it('cancels a single notification by id', async () => {
    const id = await scheduleDailyAlarm({ medicineId: 'm1', medicineName: 'A', hour: 8, minute: 0 });
    await cancelNotification(id);
    expect(scheduled()).toHaveLength(0);
  });

  it('ignores a falsy id instead of calling through', async () => {
    await cancelNotification(null);
    await cancelNotification(undefined);
    await cancelNotification('');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('swallows errors from an already-cancelled notification', async () => {
    Notifications.cancelScheduledNotificationAsync.mockRejectedValueOnce(
      new Error('not found')
    );
    await expect(cancelNotification('gone')).resolves.toBeUndefined();
  });

  it('cancels a batch and tolerates a null list', async () => {
    const a = await scheduleDailyAlarm({ medicineId: 'm1', medicineName: 'A', hour: 8, minute: 0 });
    const b = await scheduleDailyAlarm({ medicineId: 'm2', medicineName: 'B', hour: 9, minute: 0 });
    await cancelManyNotifications([a, b]);
    expect(scheduled()).toHaveLength(0);
    await expect(cancelManyNotifications(null)).resolves.toBeUndefined();
  });
});

describe('listScheduled', () => {
  it('reports everything currently armed', async () => {
    await scheduleForMedicine({ id: 'm1', name: 'A', times: ['08:00', '20:00'] });
    expect(await listScheduled()).toHaveLength(2);
  });
});

describe('notification handler', () => {
  it('is installed at module load and shows an alert with sound', async () => {
    expect(Notifications.setNotificationHandler).toBeDefined();
    // The handler is registered when the module is first imported; re-import to
    // capture the config it was given.
    jest.isolateModules(() => {
      require('../../src/utils/notifications');
    });
    const handler = Notifications.setNotificationHandler.mock.calls.at(-1)[0];
    const result = await handler.handleNotification();
    expect(result.shouldShowAlert).toBe(true);
    expect(result.shouldPlaySound).toBe(true);
    expect(result.priority).toBe(Notifications.AndroidNotificationPriority.MAX);
  });
});
