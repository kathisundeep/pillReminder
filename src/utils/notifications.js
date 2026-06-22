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
        buttonTitle: 'Skip',
        options: { opensAppToForeground: true },
      },
    ]);
  }

  return true;
}

function nextOccurrence(hour, minute) {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

export async function scheduleDailyAlarm({ medicineId, medicineName, hour, minute }) {
  const trigger = {
    hour,
    minute,
    repeats: true,
    channelId: CHANNEL_ID,
  };
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Time for your medicine',
      body: `Take ${medicineName} now`,
      data: { medicineId, medicineName, type: 'pill-alarm' },
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
      categoryIdentifier: 'pill-alarm-actions',
      sticky: false,
      vibrate: [0, 500, 250, 500],
    },
    trigger,
  });
  return id;
}

export async function scheduleSnooze({ medicineId, medicineName, minutes }) {
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Snoozed reminder',
      body: `Take ${medicineName} now`,
      data: { medicineId, medicineName, type: 'pill-alarm' },
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
      categoryIdentifier: 'pill-alarm-actions',
      vibrate: [0, 500, 250, 500],
    },
    trigger: { seconds: Math.max(60, minutes * 60), channelId: CHANNEL_ID },
  });
  return id;
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
