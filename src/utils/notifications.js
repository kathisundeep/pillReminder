import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

const CHANNEL_ID = 'pill-alarm';

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
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Pill Alarms',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500],
      lightColor: '#4CAF50',
      sound: 'default',
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableVibrate: true,
    });

    await Notifications.setNotificationCategoryAsync('pill-alarm-actions', [
      {
        identifier: 'TOOK',
        buttonTitle: 'Took it',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'SKIP',
        buttonTitle: 'Snooze',
        options: { opensAppToForeground: true },
      },
    ]);
  }

  return true;
}

export async function getPermissionStatus() {
  const p = await Notifications.getPermissionsAsync();
  return p.status;
}

function alarmContent(medicineId, medicineName, titlePrefix = 'Time for your medicine') {
  return {
    title: titlePrefix,
    body: `Take ${medicineName} now`,
    data: { medicineId, medicineName, type: 'pill-alarm' },
    sound: 'default',
    priority: Notifications.AndroidNotificationPriority.MAX,
    categoryIdentifier: 'pill-alarm-actions',
    vibrate: [0, 500, 250, 500],
    sticky: false,
    autoDismiss: false,
  };
}

export async function scheduleDailyAlarm({ medicineId, medicineName, hour, minute }) {
  const id = await Notifications.scheduleNotificationAsync({
    content: alarmContent(medicineId, medicineName),
    trigger: {
      hour,
      minute,
      repeats: true,
      channelId: CHANNEL_ID,
    },
  });
  return id;
}

export async function scheduleWeeklyAlarm({ medicineId, medicineName, weekday, hour, minute }) {
  const id = await Notifications.scheduleNotificationAsync({
    content: alarmContent(medicineId, medicineName),
    trigger: {
      weekday,
      hour,
      minute,
      repeats: true,
      channelId: CHANNEL_ID,
    },
  });
  return id;
}

export async function scheduleSnooze({ medicineId, medicineName, minutes }) {
  const id = await Notifications.scheduleNotificationAsync({
    content: alarmContent(medicineId, medicineName, 'Snoozed reminder'),
    trigger: {
      seconds: Math.max(60, minutes * 60),
      repeats: false,
      channelId: CHANNEL_ID,
    },
  });
  return id;
}

export async function scheduleTestAlarm({ seconds = 30 } = {}) {
  const id = await Notifications.scheduleNotificationAsync({
    content: alarmContent('TEST', 'Test Medicine', 'Test alarm'),
    trigger: {
      seconds,
      repeats: false,
      channelId: CHANNEL_ID,
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
        });
        ids.push(id);
      }
    } else {
      const id = await scheduleDailyAlarm({
        medicineId: med.id,
        medicineName: med.name,
        hour: h,
        minute: m,
      });
      ids.push(id);
    }
  }
  return ids;
}
