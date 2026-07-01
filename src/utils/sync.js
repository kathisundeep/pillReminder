import { getMedicines, updateMedicine } from './storage';
import { resyncAlarms } from './notifications';

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
    const idMap = await resyncAlarms(meds);
    for (const m of meds) {
      await updateMedicine(null, m.id, { notificationIds: idMap[m.id] || [] });
    }
    return meds.length;
  } catch (e) {
    return 0;
  }
}
