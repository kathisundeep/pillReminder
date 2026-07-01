import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import Constants from 'expo-constants';

import {
  getSession,
  getGuardian,
  getMedicines,
  getDoseEntries,
  isTakenToday,
  recordDose,
  hasAlertedGuardian,
  markAlertedGuardian,
  setOwnPushToken,
} from './storage';

export const SWEEP_TASK = 'guardian-missed-dose-sweep';
const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatTime(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad(m)} ${ampm}`;
}

// Build a Date for today at "HH:MM" in local time.
function doseDateToday(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

// Register this device for Expo push so it can act as a guardian.
// Returns the ExponentPushToken[...] string, or null if unavailable.
export async function registerForPushTokenAsync() {
  if (!Device.isDevice) return null;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return null;

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;
    const resp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = resp?.data || null;
    if (token) await setOwnPushToken(token);
    return token;
  } catch (e) {
    return null;
  }
}

// Send a push to a guardian's Expo token. Returns true on accepted delivery.
export async function sendGuardianPush(pushToken, { title, body, data } = {}) {
  if (!pushToken) return false;
  try {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        title: title || 'PillReminder',
        body: body || '',
        sound: 'default',
        priority: 'high',
        channelId: 'guardian-alerts',
        data: data || { type: 'guardian-alert' },
      }),
    });
    const json = await res.json().catch(() => null);
    const status = json?.data?.status;
    return status !== 'error';
  } catch (e) {
    return false;
  }
}

// When notifyMode is "both", let the guardian know a dose was taken too.
export async function notifyGuardianTaken(user, medicineName) {
  try {
    if (!user) return;
    const guardian = await getGuardian(user);
    if (!guardian || !guardian.enabled || !guardian.pushToken) return;
    if (guardian.notifyMode !== 'both') return;
    await sendGuardianPush(guardian.pushToken, {
      title: 'Medicine taken',
      body: `${user} just took ${medicineName || 'their medicine'}.`,
      data: { type: 'guardian-taken', medicineName, who: user },
    });
  } catch (e) {
    // best-effort
  }
}

// Core detection. Best-effort and never throws (safe for background task).
// Rule: alert the guardian if a medicine due earlier today is still not
// marked "taken" once `grace` minutes have passed since the dose was due —
// and each snooze pushes that deadline to (last snooze re-alarm + grace).
export async function sweepMissedDoses() {
  try {
    const user = await getSession();
    if (!user) return;

    const guardian = await getGuardian(user);
    if (!guardian || !guardian.enabled || !guardian.pushToken) return;

    const grace = Number(guardian.graceMinutes) || 30;
    const meds = await getMedicines(user);
    const now = new Date();
    const todayDow = now.getDay(); // 0 (Sun) .. 6 (Sat)

    for (const med of meds) {
      if (med.alertGuardian === false) continue;

      const days =
        med.daysOfWeek && med.daysOfWeek.length
          ? med.daysOfWeek
          : [0, 1, 2, 3, 4, 5, 6];
      if (!days.includes(todayDow)) continue;

      // Most recent scheduled time today that has already passed.
      let lastPassed = null;
      for (const t of med.times || []) {
        const dt = doseDateToday(t);
        if (dt <= now && (!lastPassed || dt > lastPassed)) lastPassed = dt;
      }
      if (!lastPassed) continue; // nothing due yet today

      if (await isTakenToday(user, med.id)) continue; // they took it

      const entries = await getDoseEntries(user, med.id);
      const snoozeMin = Number(med.snoozeMinutes) || 10;
      const latestOf = (status) => {
        const times = entries
          .filter((e) => e.status === status)
          .map((e) => new Date(e.at))
          .sort((a, b) => a - b);
        return times.length ? times[times.length - 1] : null;
      };
      const lastSkip = latestOf('skipped');
      const lastSnooze = latestOf('snoozed');

      // Deadline precedence: explicit Skip > Snooze re-alarm > the dose time.
      let deadline;
      let skipped = false;
      if (lastSkip) {
        deadline = new Date(lastSkip.getTime() + grace * 60000);
        skipped = true;
      } else if (lastSnooze) {
        const snoozeFire = new Date(lastSnooze.getTime() + snoozeMin * 60000);
        // Still inside the snooze window — the re-alarm hasn't fired yet.
        if (now < snoozeFire) continue;
        deadline = new Date(snoozeFire.getTime() + grace * 60000);
      } else {
        deadline = new Date(lastPassed.getTime() + grace * 60000);
      }
      if (now < deadline) continue;

      // Alert at most once per medicine per day.
      const key = med.id;
      if (await hasAlertedGuardian(user, key)) continue;

      await sendGuardianPush(guardian.pushToken, {
        title: skipped ? 'Skipped medicine alert' : 'Missed medicine alert',
        body: skipped
          ? `${user} skipped ${med.name} (due ${formatTime(
              lastPassed
            )}) and has not taken it. Please check on them.`
          : `${user} has not taken ${med.name} (due ${formatTime(
              lastPassed
            )}). Please check on them.`,
        data: { type: 'guardian-alert', medicineName: med.name, who: user },
      });
      await markAlertedGuardian(user, key);
      await recordDose(user, med.id, 'missed');
    }
  } catch (e) {
    // Swallow — this runs in the background and must not crash the task.
  }
}

// Defined at module load so the OS can run it after a background relaunch.
TaskManager.defineTask(SWEEP_TASK, async () => {
  try {
    await sweepMissedDoses();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Register the periodic background sweep (Android floors the interval ~15 min).
export async function registerBackgroundSweep() {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      return false;
    }
    const already = await TaskManager.isTaskRegisteredAsync(SWEEP_TASK);
    if (!already) {
      await BackgroundFetch.registerTaskAsync(SWEEP_TASK, {
        minimumInterval: 15 * 60, // seconds
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
    return true;
  } catch (e) {
    return false;
  }
}
