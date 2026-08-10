import { isDueToday } from './doseState';

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
  FULL: 'full',       // every dose taken
  PARTIAL: 'partial', // some taken, some not
  MISSED: 'missed',   // due, none taken
  FUTURE: 'future',   // hasn't happened yet
};

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

// Weeks run Monday–Sunday: a pill routine is lived weekly, and splitting the
// weekend across two rows makes "I always miss Saturdays" hard to see.
export function startOfWeek(date) {
  const d = startOfDay(date);
  const shift = (d.getDay() + 6) % 7;
  return addDays(d, -shift);
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

// One day's verdict. `entriesByMed` is history[day] — { medicineId: [{status, slot}] }.
export function dayAdherence(medicines, entriesByMed, date, now = new Date()) {
  const isFuture = startOfDay(date) > startOfDay(now);

  let due = 0;
  let taken = 0;

  for (const med of medicines || []) {
    const owed = dosesDueOn(med, date);
    if (owed === 0) continue;
    due += owed;

    const entries = entriesByMed?.[med.id] || [];
    // Count DISTINCT slots taken, so two taps on the same dose do not read as
    // two doses, and an 08:00 tablet taken twice cannot cover the 20:00 one.
    const takenSlots = new Set(
      entries.filter((e) => e.status === 'taken').map((e) => e.slot ?? '_')
    );
    taken += Math.min(takenSlots.size, owed);
  }

  if (due === 0) return { state: DAY_STATE.NONE, due: 0, taken: 0, date };
  if (isFuture) return { state: DAY_STATE.FUTURE, due, taken: 0, date };
  if (taken >= due) return { state: DAY_STATE.FULL, due, taken, date };
  if (taken === 0) return { state: DAY_STATE.MISSED, due, taken, date };
  return { state: DAY_STATE.PARTIAL, due, taken, date };
}

// A run of days, oldest first.
export function rangeAdherence(medicines, history, from, to, now = new Date()) {
  const days = [];
  let cursor = startOfDay(from);
  const end = startOfDay(to);
  // Bounded so a bad range cannot spin forever.
  let guard = 0;
  while (cursor <= end && guard < 800) {
    const key = dayKey(cursor);
    days.push({ key, ...dayAdherence(medicines, history?.[key], cursor, now) });
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
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
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
