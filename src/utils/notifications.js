import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { TONES, toneById } from './tones';
import { ensureChannelForSound, isDeviceSound } from './sounds';

const CHANNEL_ID = 'pill-alarm-v2';
export const SNOOZE_TITLE = 'Snoozed reminder';
const ALARM_SOUND = 'alarm';

// Selectable, bundled alarm tones. `sound` is the res/raw file name (no ext);
// each tone gets its own Android channel because a channel's sound is fixed.
export { TONES, toneById } from './tones';

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

// Everything an alarm needs to know about its medicines. One alarm can carry
// several: medicines due at the same minute share a single notification, so
// the phone rings once and the buttons act on all of them together.
function alarmContent(meds, { title = 'Time for your medicine', sound = ALARM_SOUND, slot = null } = {}) {
  const names = meds.map((m) => m.name || 'medicine');
  const many = meds.length > 1;
  return {
    title: many && title === 'Time for your medicine' ? `Time for ${meds.length} medicines` : title,
    body: many ? `Take ${names.join(', ')}` : `Take ${names[0]} now`,
    // `slot` is the scheduled "HH:MM" this alarm belongs to. Doses are keyed by
    // it, so acting on the notification must know which dose it was.
    // medicineId/medicineName stay for single-medicine readers.
    data: {
      medicineIds: meds.map((m) => m.id),
      medicineNames: names,
      medicineId: meds[0]?.id ?? null,
      medicineName: names.join(', '),
      slot,
      type: 'pill-alarm',
    },
    sound,
    priority: Notifications.AndroidNotificationPriority.MAX,
    categoryIdentifier: 'pill-alarm-actions',
    vibrate: [0, 800, 400, 800, 400, 800],
    sticky: true,
    autoDismiss: false,
  };
}

// A shared alarm can only ring one tone; the first medicine's wins.
async function toneFor(toneId) {
  const tone = toneById(toneId);
  // A device sound lives on its own channel, created on demand. The channel
  // carries the sound on Android O+, so the content sound is left off for one
  // — setting both makes the two disagree, and the channel wins silently.
  const channelId = (await ensureChannelForSound(toneId)) || tone.channelId;
  const sound = isDeviceSound(toneId) ? undefined : tone.sound;
  return { channelId, sound };
}

function medsOf({ medicines, medicineId, medicineName, toneId }) {
  if (medicines?.length) return medicines;
  return [{ id: medicineId, name: medicineName, toneId }];
}

// weekday: 1-based (expo's convention), or null for every day.
async function scheduleSlotAlarm({ meds, hour, minute, weekday = null }) {
  const { channelId, sound } = await toneFor(meds[0]?.toneId);
  const slot = `${pad2(hour)}:${pad2(minute)}`;
  return Notifications.scheduleNotificationAsync({
    content: alarmContent(meds, { sound, slot }),
    trigger: {
      ...(weekday ? { weekday } : {}),
      hour,
      minute,
      repeats: true,
      channelId,
    },
  });
}

export async function scheduleDailyAlarm({ hour, minute, ...who }) {
  return scheduleSlotAlarm({ meds: medsOf(who), hour, minute });
}

export async function scheduleWeeklyAlarm({ weekday, hour, minute, ...who }) {
  return scheduleSlotAlarm({ meds: medsOf(who), hour, minute, weekday });
}

// `medicines` ([{ id, name }]) snoozes several doses as one alarm; the single
// medicineId/medicineName form still works.
export async function scheduleSnooze({ minutes, toneId, slot, ...who }) {
  const meds = medsOf({ ...who, toneId });
  const { channelId, sound } = await toneFor(toneId ?? meds[0]?.toneId);
  // Guard the arithmetic: an absent or non-numeric `minutes` used to produce a
  // NaN delay, i.e. an alarm that never fires. "Not specified" falls back to the
  // 10-minute default; "specified but too small" is floored at 60 seconds.
  const mins = minutes == null ? NaN : Number(minutes);
  const seconds = Number.isFinite(mins) ? Math.max(60, mins * 60) : 600;
  const id = await Notifications.scheduleNotificationAsync({
    content: alarmContent(meds, { title: SNOOZE_TITLE, sound, slot: slot ?? null }),
    trigger: {
      seconds,
      repeats: false,
      channelId,
    },
  });
  return id;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function daysOf(med) {
  return med.frequency === 'weekly' && med.daysOfWeek?.length ? med.daysOfWeek : ALL_DAYS;
}

// Which alarms to arm: one per time of day, carrying every medicine due then.
// When all of them ring daily that is a single daily alarm; otherwise it is
// split per weekday, so a Monday-only medicine joins the daily ones on Monday
// instead of ringing on top of them.
export function groupAlarms(medicines) {
  const byTime = new Map();
  for (const med of medicines || []) {
    for (const t of med.times || []) {
      if (!byTime.has(t)) byTime.set(t, []);
      if (!byTime.get(t).includes(med)) byTime.get(t).push(med);
    }
  }
  const groups = [];
  for (const [time, meds] of byTime) {
    const [hour, minute] = time.split(':').map(Number);
    if (meds.every((m) => daysOf(m).length === 7)) {
      groups.push({ hour, minute, weekday: null, meds });
      continue;
    }
    for (const dow of ALL_DAYS) {
      const due = meds.filter((m) => daysOf(m).includes(dow));
      if (due.length) groups.push({ hour, minute, weekday: dow + 1, meds: due });
    }
  }
  return groups;
}

// Arms the grouped alarms and returns medicine id -> ids of the alarms it rides
// on. A shared alarm's id appears under each of its medicines.
async function scheduleGroups(medicines) {
  const idMap = {};
  for (const med of medicines || []) idMap[med.id] = [];
  for (const g of groupAlarms(medicines)) {
    const meds = g.meds.map((m) => ({ id: m.id, name: m.name, toneId: m.toneId }));
    const id = await scheduleSlotAlarm({ meds, hour: g.hour, minute: g.minute, weekday: g.weekday });
    for (const m of g.meds) idMap[m.id].push(id);
  }
  return idMap;
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

  return scheduleGroups(medicines);
}

export async function scheduleForMedicine(med) {
  return (await scheduleGroups([med]))[med.id] || [];
}
