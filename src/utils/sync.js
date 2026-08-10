import { getMedicines, updateMedicine } from './storage';
import { resyncAlarms } from './notifications';
import { isCourseFinished } from './doseState';

// Pull the medicine list (cloud, with offline cache fallback) and re-arm all
// local alarms from it, persisting the device-local notification IDs. Safe to
// call on login and on app start so alarms work on any device / after reboot.
export async function resyncAlarmsFromCloud() {
  try {
    const meds = await getMedicines();
    if (!meds || meds.length === 0) {
      await resyncAlarms([]); // clear stale alarms if the account has no meds
      return 0;
    }

    // A repeating daily alarm does not expire by itself, so a finished course
    // would go on ringing forever. Re-arming happens on every launch and
    // foreground, which is what actually retires them.
    const active = meds.filter((m) => !isCourseFinished(m));

    const idMap = await resyncAlarms(active);
    // Every medicine is written back, not just the active ones: a finished
    // course must have its stale notification ids CLEARED, or a later edit
    // would try to cancel alarms that no longer exist.
    for (const m of meds) {
      await updateMedicine(null, m.id, { notificationIds: idMap[m.id] || [] });
    }
    return active.length;
  } catch (e) {
    return 0;
  }
}
