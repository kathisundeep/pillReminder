import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

const CHANNEL_ID = 'pill-alarm-v2';
export const SNOOZE_TITLE = 'Snoozed reminder';
const ALARM_SOUND = 'alarm';

// Selectable, bundled alarm tones. `sound` is the res/raw file name (no ext);
// each tone gets its own Android channel because a channel's sound is fixed.
export const TONES = [
  { id: 'classic', label: 'Classic', sound: 'alarm', channelId: 'pill-alarm-classic' },
  { id: 'chime', label: 'Chime', sound: 'chime', channelId: 'pill-alarm-chime' },
  { id: 'bell', label: 'Bell', sound: 'bell', channelId: 'pill-alarm-bell' },
  { id: 'siren', label: 'Siren', sound: 'siren', channelId: 'pill-alarm-siren' },
  { id: 'gentle', label: 'Gentle', sound: 'gentle', channelId: 'pill-alarm-gentle' },
];

export function toneById(id) {
  return TONES.find((t) => t.id === id) || TONES[0];
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

export async function ensureNotificationSetup() {
  if (!Device.isDevice) return false;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const req = await Notifications.requestPermissionsAsync({
      android: {},
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    status = req.status;
  }
  if (status !== 'granted') return false;

  if (Platform.OS === 'android') {
    try {
      await Notifications.deleteNotificationChannelAsync('pill-alarm');
    } catch (e) {}
    // One channel per selectable tone (a channel's sound can't change later).
    for (const tone of TONES) {
      await Notifications.setNotificationChannelAsync(tone.channelId, {
        name: `Pill Alarms – ${tone.label}`,
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 800, 400, 800, 400, 800],
        lightColor: '#4CAF50',
        sound: tone.sound,
        bypassDnd: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        enableVibrate: true,
      });
    }

    // Channel for incoming guardian alerts (when this device is a guardian).
    await Notifications.setNotificationChannelAsync('guardian-alerts', {
      name: 'Guardian Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 500, 250, 500],
      lightColor: '#e53935',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableVibrate: true,
    });

  }

  // Cross-platform: notification categories are how iOS gets action buttons at
  // all. Registering this inside the Android block left iOS with none.
  await Notifications.setNotificationCategoryAsync('pill-alarm-actions', [
    {
      identifier: 'TAKEN',
      buttonTitle: 'Taken',
      options: { opensAppToForeground: true },
    },
    {
      identifier: 'RESCHEDULE',
      buttonTitle: 'Reschedule',
      options: { opensAppToForeground: true },
    },
    {
      identifier: 'SKIP',
      buttonTitle: 'Skip',
      options: { opensAppToForeground: true },
    },
  ]);

  return true;
}

export async function getPermissionStatus() {
  const p = await Notifications.getPermissionsAsync();
  return p.status;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function alarmContent(
  medicineId,
  medicineName,
  titlePrefix = 'Time for your medicine',
  sound = ALARM_SOUND,
  slot = null
) {
  return {
    title: titlePrefix,
    body: `Take ${medicineName} now`,
    // `slot` is the scheduled "HH:MM" this alarm belongs to. Doses are keyed by
    // it, so acting on the notification must know which dose it was.
    data: { medicineId, medicineName, slot, type: 'pill-alarm' },
    sound,
    priority: Notifications.AndroidNotificationPriority.MAX,
    categoryIdentifier: 'pill-alarm-actions',
    vibrate: [0, 800, 400, 800, 400, 800],
    sticky: true,
    autoDismiss: false,
  };
}

export async function scheduleDailyAlarm({ medicineId, medicineName, hour, minute, toneId }) {
  const tone = toneById(toneId);
  const slot = `${pad2(hour)}:${pad2(minute)}`;
  const id = await Notifications.scheduleNotificationAsync({
    content: alarmContent(medicineId, medicineName, undefined, tone.sound, slot),
    trigger: {
      hour,
      minute,
      repeats: true,
      channelId: tone.channelId,
    },
  });
  return id;
}

export async function scheduleWeeklyAlarm({ medicineId, medicineName, weekday, hour, minute, toneId }) {
  const tone = toneById(toneId);
  const slot = `${pad2(hour)}:${pad2(minute)}`;
  const id = await Notifications.scheduleNotificationAsync({
    content: alarmContent(medicineId, medicineName, undefined, tone.sound, slot),
    trigger: {
      weekday,
      hour,
      minute,
      repeats: true,
      channelId: tone.channelId,
    },
  });
  return id;
}

export async function scheduleSnooze({ medicineId, medicineName, minutes, toneId, slot }) {
  const tone = toneById(toneId);
  // Guard the arithmetic: an absent or non-numeric `minutes` used to produce a
  // NaN delay, i.e. an alarm that never fires. "Not specified" falls back to the
  // 10-minute default; "specified but too small" is floored at 60 seconds.
  const mins = minutes == null ? NaN : Number(minutes);
  const seconds = Number.isFinite(mins) ? Math.max(60, mins * 60) : 600;
  const id = await Notifications.scheduleNotificationAsync({
    content: alarmContent(
      medicineId, medicineName, SNOOZE_TITLE, tone.sound, slot ?? null
    ),
    trigger: {
      seconds,
      repeats: false,
      channelId: tone.channelId,
    },
  });
  return id;
}

export async function listScheduled() {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all;
}

export async function cancelNotification(id) {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch (e) {}
}

export async function cancelManyNotifications(ids) {
  for (const id of ids || []) await cancelNotification(id);
}

// Re-arm the repeating alarms for the given medicines, clearing any stale or
// duplicate ones first.
//
// Pending SNOOZES are deliberately preserved. They are one-shot reminders the
// user explicitly asked for, and this runs on every app launch — cancelling
// everything meant snoozing a dose and switching apps silently lost the
// re-alarm.
export async function resyncAlarms(medicines) {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  const pendingSnoozes = (existing || []).filter(
    (n) => n.content?.title === SNOOZE_TITLE
  );

  await Notifications.cancelAllScheduledNotificationsAsync();

  // Put the snoozes back exactly as they were.
  for (const snooze of pendingSnoozes) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: snooze.content,
        trigger: snooze.trigger,
      });
    } catch (e) {
      /* a snooze that cannot be re-armed is not worth failing the resync for */
    }
  }

  const idMap = {};
  for (const med of medicines || []) {
    idMap[med.id] = await scheduleForMedicine(med);
  }
  return idMap;
}

export async function scheduleForMedicine(med) {
  const ids = [];
  for (const t of med.times) {
    const [h, m] = t.split(':').map(Number);
    if (med.frequency === 'weekly' && med.daysOfWeek?.length) {
      for (const dow of med.daysOfWeek) {
        const id = await scheduleWeeklyAlarm({
          medicineId: med.id,
          medicineName: med.name,
          weekday: dow + 1,
          hour: h,
          minute: m,
          toneId: med.toneId,
        });
        ids.push(id);
      }
    } else {
      const id = await scheduleDailyAlarm({
        medicineId: med.id,
        medicineName: med.name,
        hour: h,
        minute: m,
        toneId: med.toneId,
      });
      ids.push(id);
    }
  }
  return ids;
}
