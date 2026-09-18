// A medicine's schedule as it is entered: how often, which days, for how long.
// Shared by the Add screen and its per-medicine cards.

function pad(n) {
  return String(n).padStart(2, '0');
}

// "Twice a day" is how a prescription is written and how people think, so it
// is offered as a starting point that fills in sensible times. They stay fully
// editable afterwards — this sets the times, it does not lock them.
export const DOSES_PER_DAY = [
  { n: 1, label: 'Once', times: ['09:00'] },
  { n: 2, label: 'Twice', times: ['09:00', '21:00'] },
  { n: 3, label: '3 times', times: ['08:00', '14:00', '20:00'] },
  { n: 4, label: '4 times', times: ['08:00', '12:00', '16:00', '20:00'] },
];

// A course length, as a doctor states it. `days` null means ongoing.
export const DURATIONS = [
  { days: null, label: 'Ongoing' },
  { days: 3, label: '3 days' },
  { days: 5, label: '5 days' },
  { days: 7, label: '1 week' },
  { days: 10, label: '10 days' },
  { days: 15, label: '15 days' },
  { days: 30, label: '1 month' },
];

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A stored start/end pair shown back as a length — how it was entered, and how
// the prescription reads. Null for an ongoing medicine.
export function durationOf(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const from = new Date(`${startDate}T00:00:00`);
  const to = new Date(`${endDate}T00:00:00`);
  return Math.round((to - from) / 86400000) + 1;
}

export function durationLabel(days) {
  if (days == null) return 'Ongoing';
  return DURATIONS.find((d) => d.days === days)?.label || `${days} days`;
}

export function daysLabel(frequency, daysOfWeek) {
  if (frequency !== 'weekly') return 'Daily';
  if (!daysOfWeek?.length) return 'No days picked';
  return [...daysOfWeek].sort().map((d) => DAY_SHORT[d]).join(', ');
}
