import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import Constants from 'expo-constants';

import { supabase } from './supabase';

import {
  getSession,
  getMedicines,
  getDoseEntriesForDay,
  entriesForSlot,
  recordDose,
  hasAlertedGuardian,
  markAlertedGuardian,
  setOwnPushToken,
} from './storage';
import {
  getActiveGuardianTargets,
  getMyProfile,
  saveMyPushToken,
} from './guardianCloud';
import {
  formatClock,
  passedSlots,
  computeDoseDeadline,
} from './doseState';

export const SWEEP_TASK = 'guardian-missed-dose-sweep';
const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

// Why the last registerForPushTokenAsync() came back empty, in words a user
// can act on — or null once a token is issued and saved. Registration used to
// fail silently, which left a guardian believing alerts would reach them.
let lastPushError = null;
export function getPushRegistrationError() {
  return lastPushError;
}

// Register this device for Expo push so it can act as a guardian.
// Returns the ExponentPushToken[...] string, or null if unavailable.
export async function registerForPushTokenAsync() {
  if (!Device.isDevice) {
    lastPushError = 'Push alerts need a real phone, not an emulator.';
    return null;
  }
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') {
      lastPushError =
        'Notifications are turned off for PillReminder. Allow them in the phone settings.';
      return null;
    }

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;
    const resp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = resp?.data || null;
    if (!token) {
      lastPushError = 'This phone could not get a push address.';
      return null;
    }
    await setOwnPushToken(token);
    // Also store on the cloud profile so a paired guardian can be reached.
    try {
      await saveMyPushToken(token);
    } catch (e) {
      lastPushError = 'Could not save this phone for alerts. Check the internet connection.';
      return token;
    }
    lastPushError = null;
    return token;
  } catch (e) {
    // On Android this is almost always a build without Firebase (FCM) set up.
    lastPushError = `This phone cannot receive push alerts: ${e?.message || e}`;
    return null;
  }
}

// What the patient has chosen to send their guardian.
//   'missed' — only late/skipped doses (default)
//   'intake' — only doses actually taken
//   'both'   — everything
export const NOTIFY_MODES = [
  { id: 'missed', label: 'When I miss a dose' },
  { id: 'intake', label: 'When I take a dose' },
  { id: 'both', label: 'Both' },
];

export function notifyModeOf(profile) {
  const mode = profile?.settings?.notifyMode;
  return NOTIFY_MODES.some((m) => m.id === mode) ? mode : 'missed';
}

export const wantsIntakeAlerts = (mode) => mode === 'intake' || mode === 'both';
export const wantsMissedAlerts = (mode) => mode === 'missed' || mode === 'both';

// Send a push to an Expo token. Returns true on accepted delivery.
export async function sendPush(pushToken, { title, body, data } = {}) {
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

// Let the guardian know a dose was taken, when the patient asked for that.
export async function notifyGuardianTaken(user, medicineName) {
  try {
    if (!user) return;
    const profile = await getMyProfile();
    if (!wantsIntakeAlerts(notifyModeOf(profile))) return;
    const targets = await getActiveGuardianTargets();
    await Promise.all(
      targets.map((t) =>
        sendPush(t.token, {
          title: 'Medicine taken',
          body: `${user} just took ${medicineName || 'their medicine'}.`,
          data: { type: 'guardian-taken', medicineName, who: user },
        })
      )
    );
  } catch (e) {
    // best-effort
  }
}

// Guardian -> patient. Tell the patient a medicine is waiting for their
// approval, so they find out before they next happen to open the app.
//
// RLS (profiles_select, via is_linked_guardian) lets an active guardian read
// the patient's profile, which is where the push token lives. Best-effort: the
// request row is already saved, so a failed push only delays the in-app banner.
export async function notifyPatientOfRequest(userId, medicineName) {
  try {
    if (!userId) return false;
    const { data: profile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', userId)
      .maybeSingle();
    if (!profile?.push_token) return false;

    return await sendPush(profile.push_token, {
      title: 'Your guardian added a medicine',
      body: `${medicineName || 'A medicine'} is waiting for your approval.`,
      data: { type: 'guardian-request', medicineName },
    });
  } catch (e) {
    return false;
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

    const profile = await getMyProfile();
    const grace = Number(profile?.settings?.graceMinutes) || 30;

    // A guardian is needed to SEND an alert, not to DETECT a missed dose.
    // Detection runs either way, so a user without a guardian still gets an
    // accurate adherence history — which is what the health report is built on.
    const targets = await getActiveGuardianTargets();
    const canPush = targets.length > 0 && wantsMissedAlerts(notifyModeOf(profile));

    const meds = await getMedicines(user);
    const now = new Date();
    // The whole day's log for every medicine, in one query.
    const dayLog = await getDoseEntriesForDay(user);
    const todayDow = now.getDay(); // 0 (Sun) .. 6 (Sat)

    for (const med of meds) {
      const days =
        med.daysOfWeek && med.daysOfWeek.length
          ? med.daysOfWeek
          : [0, 1, 2, 3, 4, 5, 6];
      if (!days.includes(todayDow)) continue;

      const slots = passedSlots(med, now);
      if (slots.length === 0) continue; // nothing due yet today

      // The whole day's log for this medicine, fetched once.
      const dayEntries = dayLog[med.id] || [];

      // Every dose that has come around today, not just the most recent one.
      for (const { slot, due } of slots) {
        const entries = entriesForSlot(dayEntries, slot);
        if (entries.some((e) => e.status === 'taken')) continue;

        // Deadline precedence: explicit Skip > Snooze re-alarm > the dose time.
        const { deadline, skipped, insideSnoozeWindow } = computeDoseDeadline({
          lastPassed: due,
          entries,
          grace,
          snoozeMinutes: med.snoozeMinutes,
          now,
        });
        // Still inside the snooze window — the re-alarm hasn't fired yet.
        if (insideSnoozeWindow) continue;
        if (now < deadline) continue;

        // Record the miss regardless of whether anyone can be told about it —
        // but only once. This is deliberately separate from the alert dedup
        // below: history must not gain duplicate rows, while a failed push
        // must still be retried on the next sweep.
        if (!entries.some((e) => e.status === 'missed')) {
          await recordDose(user, med.id, 'missed', slot);
        }

        if (!canPush) continue;
        if (med.alertGuardian === false) continue;

        // Alert at most once per dose per day.
        const key = `${med.id}:${slot}`;
        if (await hasAlertedGuardian(user, key)) continue;

        const alert = {
          title: skipped ? 'Skipped medicine alert' : 'Missed medicine alert',
          body: skipped
            ? `${user} skipped ${med.name} (due ${formatClock(
                due
              )}) and has not taken it. Please check on them.`
            : `${user} has not taken ${med.name} (due ${formatClock(
                due
              )}). Please check on them.`,
          data: {
            type: 'guardian-alert', medicineName: med.name, who: user, slot,
          },
        };
        // Every linked guardian; counted as reached if any of them was.
        const results = await Promise.all(targets.map((t) => sendPush(t.token, alert)));
        const delivered = results.some(Boolean);
        // Only suppress future attempts once the guardian has actually been
        // reached. Marking on a failed send loses the alert for the whole day.
        if (delivered) await markAlertedGuardian(user, key);
      }
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
