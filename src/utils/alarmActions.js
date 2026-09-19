import { getMedicines, getDoseEntries, recordDose } from './storage';
import { scheduleSnooze } from './notifications';
import { notifyGuardianTaken, sweepMissedDoses } from './guardian';

// What one alarm is about, whichever way it arrives: a grouped notification
// carries medicineIds, one armed by an older build only medicineId.
export function alarmMedicineIds(data = {}) {
  if (Array.isArray(data.medicineIds) && data.medicineIds.length) return data.medicineIds;
  return data.medicineId ? [data.medicineId] : [];
}

// The medicines an alarm names that still exist, in the alarm's order. An
// alarm is armed ahead of time, so one may have been deleted since.
export async function medicinesForAlarm(ids) {
  const all = await getMedicines();
  return ids.map((id) => all.find((m) => m.id === id)).filter(Boolean);
}

// Drops doses already settled for this slot today, so pressing a button on a
// notification after dealing with some doses in the app cannot record twice.
async function stillPending(user, meds, slot) {
  const out = [];
  for (const med of meds) {
    const entries = await getDoseEntries(user, med.id, null, slot);
    if (!entries.some((e) => e.status === 'taken' || e.status === 'skipped')) out.push(med);
  }
  return out;
}

export async function takeDoses(user, meds, slot) {
  if (!user || !meds.length) return;
  for (const med of meds) await recordDose(user, med.id, 'taken', slot);
  await notifyGuardianTaken(user, meds.map((m) => m.name).join(', '));
}

// One re-alarm for the lot, after the shortest of their snooze times.
export async function snoozeDoses(user, meds, slot, minutes) {
  if (!user || !meds.length) return;
  for (const med of meds) await recordDose(user, med.id, 'snoozed', slot);
  await scheduleSnooze({
    medicines: meds.map((m) => ({ id: m.id, name: m.name, toneId: m.toneId })),
    minutes: minutes ?? Math.min(...meds.map((m) => m.snoozeMinutes || 10)),
    toneId: meds[0].toneId,
    slot,
  });
}

// Explicit skip — the guardian is alerted by the missed-dose sweep.
export async function skipDoses(user, meds, slot) {
  if (!user || !meds.length) return;
  for (const med of meds) await recordDose(user, med.id, 'skipped', slot);
  sweepMissedDoses();
}

const ACTIONS = { TAKEN: takeDoses, RESCHEDULE: snoozeDoses, SKIP: skipDoses };

// A button pressed on the notification: applies to every medicine it carries
// that has not been dealt with yet.
export async function applyAlarmAction(user, action, data) {
  const run = ACTIONS[action];
  if (!run || !user) return;
  const meds = await stillPending(user, await medicinesForAlarm(alarmMedicineIds(data)), data.slot ?? null);
  await run(user, meds, data.slot ?? null);
}

// A native alarm opens the app with its details in a link:
//   pillreminder://alarm?alarmId=…&nid=…&data=<json>[&action=TAKEN]
// Returns { alarmId, nid, action, data } or null for any other link.
export function parseAlarmUrl(url) {
  const m = /^pillreminder:\/\/alarm\/?\?(.*)$/.exec(String(url || ''));
  if (!m) return null;
  const params = {};
  for (const part of m[1].split('&')) {
    const [k, v = ''] = part.split('=');
    try {
      params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch (e) {
      params[k] = v;
    }
  }
  let data = {};
  try {
    data = JSON.parse(params.data || '{}');
  } catch (e) {
    data = {};
  }
  return {
    alarmId: params.alarmId || null,
    nid: params.nid != null && params.nid !== '' ? Number(params.nid) : null,
    action: params.action || null,
    data,
  };
}
