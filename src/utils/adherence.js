import { isDueToday, doseDateOn } from './doseState';

// Turning dose history into "how am I doing".
//
// The unit throughout is a SLOT, not a medicine and not a day: a medicine at
// 08:00 and 20:00 owes two doses a day. Counting per medicine would call a day
// complete after the morning dose, which is exactly the failure this app is
// supposed to catch.
//
// A day is only ever judged against what was actually DUE that day. A weekly
// medicine contributes nothing on the days it is not scheduled, so a Tuesday
// with no Tuesday medicines is "nothing due" rather than a perfect score or a
// total miss — both of which would be lies.

export const DAY_STATE = {
  NONE: 'none',       // nothing was due
  FULL: 'full',       // every dose judged so far was taken
  PARTIAL: 'partial', // some taken, some missed
  MISSED: 'missed',   // doses missed, none taken
  FUTURE: 'future',   // nothing can be judged yet
};

// One scheduled dose. Only TAKEN and MISSED are verdicts; the rest are a dose
// whose time has not run out, and count neither for nor against.
export const DOSE = {
  TAKEN: 'taken',
  MISSED: 'missed',     // skipped, or its time plus grace ran out untaken
  SNOOZED: 'snoozed',   // re-alarm pending
  DUE: 'due',           // its time has come, still inside the grace period
  FUTURE: 'future',     // its time has not come
};

// The calendar splits each day into three bars, as the reference does.
export const BANDS = [
  { id: 'morning', label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'night', label: 'Night' },
];

export function bandFor(hhmm) {
  const hour = Number(String(hhmm).split(':')[0]);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'night';
}

export function dayKey(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  // Local, deliberately: the whole app treats a "day" as the user's day.
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Weeks run Sunday–Saturday, matching the calendar's S M T W T F S header.
export function startOfWeek(date) {
  const d = startOfDay(date);
  return addDays(d, -d.getDay());
}

export function startOfMonth(date) {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

// How many doses a medicine owes on a given date.
export function dosesDueOn(med, date) {
  if (!isDueToday(med, date)) return 0;
  return Array.isArray(med?.times) ? med.times.length : 0;
}

// What became of one dose: the medicine's `slot` on `date`, judged at `now`.
// `grace` is the minutes a dose may run late before it counts as missed — the
// same allowance the guardian alert gives.
export function doseOutcome(med, entries, slot, date, now = new Date(), grace = 30) {
  // Entries from before doses were keyed by slot carry none; for a medicine
  // with a single time there is no doubt which dose they meant.
  const mine = (entries || []).filter(
    (e) => e.slot === slot || (e.slot == null && (med.times || []).length === 1)
  );
  if (mine.some((e) => e.status === 'taken')) return DOSE.TAKEN;
  if (mine.some((e) => e.status === 'skipped')) return DOSE.MISSED;

  const at = doseDateOn(slot, date);
  if (at > now) return DOSE.FUTURE;

  const graceMs = grace * 60000;
  const lastSnooze = mine
    .filter((e) => e.status === 'snoozed' && e.at)
    .map((e) => new Date(e.at).getTime())
    .sort((x, y) => x - y)
    .pop();
  if (lastSnooze) {
    const fire = lastSnooze + (Number(med.snoozeMinutes) || 10) * 60000;
    if (now.getTime() < fire + graceMs) return DOSE.SNOOZED;
  }
  if (now.getTime() < at.getTime() + graceMs) return DOSE.DUE;
  return DOSE.MISSED;
}

// The worst state among a bar's doses decides its colour: a missed dose must
// never hide behind a taken one at the same time of day.
const BAR_RANK = [DOSE.MISSED, DOSE.DUE, DOSE.SNOOZED, DOSE.FUTURE, DOSE.TAKEN];

function barState(doses) {
  if (!doses.length) return 'none';
  return BAR_RANK.find((st) => doses.some((d) => d.state === st));
}

// One day's verdict. `entriesByMed` is history[day] — { medicineId: [{status, slot, at}] }.
//
// `due` counts the doses that have a verdict (taken or missed), so a dose
// whose time has not run out neither lowers the score nor breaks a streak.
export function dayAdherence(medicines, entriesByMed, date, now = new Date(), grace = 30) {
  const doses = [];
  for (const med of medicines || []) {
    if (!isDueToday(med, date)) continue;
    for (const slot of med.times || []) {
      doses.push({
        med,
        slot,
        band: bandFor(slot),
        state: doseOutcome(med, entriesByMed?.[med.id], slot, date, now, grace),
      });
    }
  }
  doses.sort((x, y) => (x.slot < y.slot ? -1 : x.slot > y.slot ? 1 : 0));

  const taken = doses.filter((d) => d.state === DOSE.TAKEN).length;
  const missed = doses.filter((d) => d.state === DOSE.MISSED).length;
  const due = taken + missed;
  const bands = {};
  for (const b of BANDS) bands[b.id] = barState(doses.filter((d) => d.band === b.id));

  let state;
  if (!doses.length) state = DAY_STATE.NONE;
  else if (due === 0) state = DAY_STATE.FUTURE;
  else if (missed === 0) state = DAY_STATE.FULL;
  else if (taken === 0) state = DAY_STATE.MISSED;
  else state = DAY_STATE.PARTIAL;

  return { state, due, taken, missed, doses, bands, date };
}

// A run of days, oldest first.
export function rangeAdherence(medicines, history, from, to, now = new Date(), grace = 30) {
  const days = [];
  let cursor = startOfDay(from);
  const end = startOfDay(to);
  // Bounded so a bad range cannot spin forever.
  let guard = 0;
  while (cursor <= end && guard < 800) {
    const key = dayKey(cursor);
    days.push({ key, ...dayAdherence(medicines, history?.[key], cursor, now, grace) });
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return days;
}

// Percentage over days that actually had something due. Days with nothing due
// are excluded rather than counted as perfect — a fortnight of no medicines is
// not 100% adherence.
export function summarise(days) {
  const counted = days.filter(
    (d) => d.state !== DAY_STATE.NONE && d.state !== DAY_STATE.FUTURE
  );
  const due = counted.reduce((sum, d) => sum + d.due, 0);
  const taken = counted.reduce((sum, d) => sum + d.taken, 0);
  return {
    due,
    taken,
    missed: due - taken,
    days: counted.length,
    percent: due === 0 ? null : Math.round((taken / due) * 100),
    perfectDays: counted.filter((d) => d.state === DAY_STATE.FULL).length,
  };
}

// Consecutive days ending today (or the last day with anything due) where
// every dose was taken. Days with nothing due neither break nor extend it —
// breaking a streak because a weekly medicine had an off day would be unfair,
// and extending it would be unearned.
export function currentStreak(days) {
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const d = days[i];
    if (d.state === DAY_STATE.FUTURE || d.state === DAY_STATE.NONE) continue;
    if (d.state === DAY_STATE.FULL) streak += 1;
    else break;
  }
  return streak;
}

// The three views the calendar offers.
export const SEGMENTS = [
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
  { id: 'year', label: 'Yearly' },
];

// The date window for a segment, `offset` steps back from now (0 = current).
export function windowFor(segment, offset = 0, now = new Date()) {
  if (segment === 'week') {
    const from = addDays(startOfWeek(now), offset * 7);
    return { from, to: addDays(from, 6) };
  }
  if (segment === 'month') {
    const base = startOfMonth(now);
    const from = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 0);
    return { from, to };
  }
  // Year: twelve months ending with the current one, so the view is the last
  // year of behaviour rather than a mostly-empty January-to-date.
  const to = new Date(now.getFullYear() + offset, now.getMonth() + 1, 0);
  const from = new Date(to.getFullYear() - 1, to.getMonth() + 1, 1);
  return { from, to };
}

// Year view groups by month rather than drawing 365 cells.
export function groupByMonth(days) {
  const months = new Map();
  for (const d of days) {
    const date = new Date(d.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!months.has(key)) months.set(key, { key, date: startOfMonth(date), days: [] });
    months.get(key).days.push(d);
  }
  return [...months.values()].map((m) => ({ ...m, ...summarise(m.days) }));
}
