import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as Ringtones from '../../modules/ringtones';
import {
  resyncAlarms,
  scheduleSnooze,
  ensureNotificationSetup,
} from '../../src/utils/notifications';
import { parseAlarmUrl } from '../../src/utils/alarmActions';

const alarms = () => Ringtones.__state.alarms;

// An APK that has the PillAlarms native module.
beforeEach(() => {
  alarms().available = true;
  Platform.OS = 'android';
});

const daily = (id, name, times, extra = {}) => ({ id, name, times, frequency: 'daily', ...extra });

describe('native alarms — scheduling', () => {
  it('hands the phone one alarm per time, carrying every medicine due then', async () => {
    await resyncAlarms([daily('m1', 'Aspirin', ['08:00', '20:00']), daily('m2', 'Metformin', ['08:00'])]);

    const list = alarms().repeating;
    expect(list.map((a) => a.id)).toEqual(['slot-0800-0', 'slot-2000-0']);
    expect(list[0]).toMatchObject({
      hour: 8, minute: 0, weekday: 0, title: 'Time for 2 medicines', body: 'Take Aspirin, Metformin',
    });
    expect(JSON.parse(list[0].data)).toMatchObject({
      type: 'pill-alarm', slot: '08:00', medicineIds: ['m1', 'm2'],
    });
  });

  it('maps each medicine to the alarms it rides on', async () => {
    const idMap = await resyncAlarms([daily('m1', 'A', ['08:00', '20:00']), daily('m2', 'B', ['08:00'])]);
    expect(idMap).toEqual({ m1: ['slot-0800-0', 'slot-2000-0'], m2: ['slot-0800-0'] });
  });

  it('keeps a weekly medicine to its own weekdays', async () => {
    await resyncAlarms([
      { id: 'm1', name: 'Vit D', times: ['09:00'], frequency: 'weekly', daysOfWeek: [1, 4] },
    ]);
    expect(alarms().repeating.map((a) => a.weekday)).toEqual([2, 5]);
  });

  it('clears anything the old notification path had armed, so nothing rings twice', async () => {
    await Notifications.scheduleNotificationAsync({ content: { title: 'old' }, trigger: { seconds: 60 } });
    await resyncAlarms([daily('m1', 'A', ['08:00'])]);
    expect(Notifications.__state.scheduled).toHaveLength(0);
  });

  it('snoozes as a one-shot alarm at the right moment', async () => {
    const before = Date.now();
    const id = await scheduleSnooze({
      medicines: [{ id: 'm1', name: 'Aspirin' }], minutes: 10, slot: '08:00',
    });
    const [snooze] = alarms().oneShots;
    expect(snooze.id).toBe(id);
    expect(snooze.oneShotAt - before).toBeGreaterThanOrEqual(600000);
    expect(snooze.oneShotAt - before).toBeLessThan(605000);
    expect(snooze.title).toBe('Snoozed reminder');
    expect(JSON.parse(snooze.data).slot).toBe('08:00');
    expect(Notifications.__state.scheduled).toHaveLength(0);
  });

  it('uses the old path when the APK has no native alarms', async () => {
    alarms().available = false;
    await resyncAlarms([daily('m1', 'A', ['08:00'])]);
    expect(alarms().repeating).toEqual([]);
    expect(Notifications.__state.scheduled).toHaveLength(1);
  });
});

describe('native alarms — channels', () => {
  it('drops the old per-tone channels and still makes the guardian channel', async () => {
    Ringtones.__state.channels = {
      'pill-alarm-classic': { id: 'pill-alarm-classic' },
      'pill-alarm-dev-abc': { id: 'pill-alarm-dev-abc' },
      'guardian-alerts': { id: 'guardian-alerts' },
    };
    await ensureNotificationSetup();

    expect(Object.keys(Ringtones.__state.channels)).toEqual(['guardian-alerts']);
    const made = Notifications.setNotificationChannelAsync.mock.calls.map((c) => c[0]);
    expect(made).toEqual(['guardian-alerts']);
  });
});

describe('parseAlarmUrl', () => {
  const data = { type: 'pill-alarm', medicineIds: ['m1', 'm2'], slot: '08:00' };
  const url = (extra = '') =>
    `pillreminder://alarm?alarmId=slot-0800-0&nid=1234&data=${encodeURIComponent(JSON.stringify(data))}${extra}`;

  it('reads the alarm, its notification and its medicines', () => {
    expect(parseAlarmUrl(url())).toEqual({ alarmId: 'slot-0800-0', nid: 1234, action: null, data });
  });

  it('reads the button pressed', () => {
    expect(parseAlarmUrl(url('&action=TAKEN')).action).toBe('TAKEN');
  });

  it('ignores any other link', () => {
    expect(parseAlarmUrl('https://example.com')).toBeNull();
    expect(parseAlarmUrl(null)).toBeNull();
  });

  it('survives a broken data field', () => {
    expect(parseAlarmUrl('pillreminder://alarm?nid=5&data=%7Bnot-json').data).toEqual({});
  });
});
