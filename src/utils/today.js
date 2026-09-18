import { doseOutcome, DOSE } from './adherence';
import { medState, isDueToday } from './doseState';

// Shared by the patient's Home and the guardian's view of that person, so the
// two can never disagree about what today looks like.

// Home's picture of today: one card per time, each dose with its state.
export function buildDay(list, entriesByMedicine, now, grace) {
  const slotMap = {}; // time -> [{med, slot, state}]
  const off = [];
  for (const med of list) {
    if (!isDueToday(med, now)) {
      off.push(med);
      continue;
    }
    const entries = entriesByMedicine[med.id] || [];
    // Each scheduled time is its own dose, so a morning dose being taken
    // leaves the evening one still pending.
    for (const t of med.times || []) {
      if (!slotMap[t]) slotMap[t] = [];
      let state = medState(med, entries, now, t);
      // A dose left unanswered past its time and grace is missed, not due.
      if (state === 'pending' && doseOutcome(med, entries, t, now, now, grace) === DOSE.MISSED) {
        state = 'missed';
      }
      slotMap[t].push({ med, slot: t, state });
    }
  }
  const slots = Object.keys(slotMap)
    .sort()
    .map((t) => ({ time: t, items: slotMap[t] }));
  return { slots, off };
}

