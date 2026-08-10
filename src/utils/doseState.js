// Pure dose/schedule logic, shared by the Home screen and the guardian sweep.
//
// This lived inline in HomeScreen.js and guardian.js, which meant the rules
// that decide "is this dose taken / late / missed" could not be tested and were
// duplicated. Everything here is side-effect free and time is always passed in
// so it can be exercised deterministically.

function pad(n) {
  return String(n).padStart(2, '0');
}

// "20:05" -> "8:05 PM"
export function formatTime(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad(m)} ${ampm}`;
}

// Date -> "8:05 PM"
export function formatClock(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad(m)} ${ampm}`;
}

// A Date for "HH:MM" on the same local day as `now`.
export function doseDateOn(hhmm, now = new Date()) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
}

// The most recent of the medicine's scheduled times that has already passed
// today, or null if none has.
export function latestPassedTime(med, now) {
  let latest = null;
  for (const t of med.times || []) {
    const d = doseDateOn(t, now);
    if (d <= now && (!latest || d > latest)) latest = d;
  }
  return latest;
}

// EVERY scheduled time that has already passed today, oldest first, as
// { slot, due } pairs. The sweep must look at all of them: checking only the
// latest means a dose missed this morning becomes invisible the moment this
// evening's dose time arrives.
export function passedSlots(med, now) {
  const out = [];
  for (const slot of med.times || []) {
    const due = doseDateOn(slot, now);
    if (due <= now) out.push({ slot, due });
  }
  return out.sort((a, b) => a.due - b.due);
}

export function isDueToday(med, now) {
  const days =
    med.daysOfWeek && med.daysOfWeek.length
      ? med.daysOfWeek
      : [0, 1, 2, 3, 4, 5, 6];
  return days.includes(now.getDay());
}

// Display state for ONE dose of a medicine — the dose scheduled at `slot`.
//
// `entries` may hold the whole day's log for the medicine; anything belonging
// to another slot is filtered out, so marking the 08:00 dose taken leaves the
// 20:00 dose still pending.
export function medState(med, entries, now, slot) {
  const mine =
    slot === undefined || slot === null
      ? entries || []
      : (entries || []).filter((e) => e.slot === slot);

  if (mine.some((e) => e.status === 'taken')) return 'taken';
  if (mine.some((e) => e.status === 'skipped')) return 'skipped';

  // Without a slot, fall back to "has any dose time passed"; with one, this
  // dose is only live once its own time has come around.
  const latestPassed =
    slot === undefined || slot === null
      ? latestPassedTime(med, now)
      : doseDateOn(slot, now) <= now
      ? doseDateOn(slot, now)
      : null;

  const snoozes = mine
    .filter((e) => e.status === 'snoozed')
    .map((e) => new Date(e.at))
    .sort((a, b) => a - b);
  if (snoozes.length) {
    const snoozeMin = Number(med.snoozeMinutes) || 10;
    const fire = new Date(
      snoozes[snoozes.length - 1].getTime() + snoozeMin * 60000
    );
    if (now < fire) return 'snoozed';
  }
  return latestPassed ? 'pending' : 'upcoming';
}

// Aggregate state for a time slot that may hold several medicines.
export function slotStatus(items) {
  if (items.every((i) => i.state === 'taken')) return 'done';
  if (items.some((i) => i.state === 'pending')) return 'due';
  return 'upcoming';
}

// When does a not-yet-taken dose become "missed" and worth alerting a guardian?
//
// Precedence: an explicit Skip wins, then the pending snooze re-alarm, then the
// scheduled dose time. Each pushes the deadline out by the user's grace period.
//
// Returns { deadline, skipped, insideSnoozeWindow }. `insideSnoozeWindow` means
// the snooze re-alarm has not fired yet, so no judgement can be made at all.
export function computeDoseDeadline({
  lastPassed,
  entries = [],
  grace = 30,
  snoozeMinutes = 10,
  now,
}) {
  const latestOf = (status) => {
    const times = entries
      .filter((e) => e.status === status)
      .map((e) => new Date(e.at))
      .sort((a, b) => a - b);
    return times.length ? times[times.length - 1] : null;
  };

  const lastSkip = latestOf('skipped');
  const lastSnooze = latestOf('snoozed');
  const snoozeMin = Number(snoozeMinutes) || 10;

  if (lastSkip) {
    return {
      deadline: new Date(lastSkip.getTime() + grace * 60000),
      skipped: true,
      insideSnoozeWindow: false,
    };
  }

  if (lastSnooze) {
    const snoozeFire = new Date(lastSnooze.getTime() + snoozeMin * 60000);
    if (now < snoozeFire) {
      return { deadline: null, skipped: false, insideSnoozeWindow: true };
    }
    return {
      deadline: new Date(snoozeFire.getTime() + grace * 60000),
      skipped: false,
      insideSnoozeWindow: false,
    };
  }

  return {
    deadline: new Date(lastPassed.getTime() + grace * 60000),
    skipped: false,
    insideSnoozeWindow: false,
  };
}
