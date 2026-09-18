import {
  DAY_STATE,
  DOSE,
  PARTIAL,
  bandFor,
  dayKey,
  startOfWeek,
  startOfMonth,
  dosesDueOn,
  dayAdherence,
  rangeAdherence,
  summarise,
  currentStreak,
  windowFor,
  groupByMonth,
} from '../../src/utils/adherence';

const daily = (id, times) => ({ id, times, frequency: 'daily', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
const weekly = (id, times, days) => ({ id, times, frequency: 'weekly', daysOfWeek: days });

const took = (slot) => ({ status: 'taken', slot });

// A Wednesday, so weekday maths is visible rather than accidental.
const WED = new Date('2026-08-05T09:00:00');
// Judging Wednesday once it is over, so every dose has a verdict.
const AFTER = new Date('2026-08-06T09:00:00');

describe('dayKey', () => {
  it('formats a local date', () => {
    expect(dayKey(new Date('2026-08-05T09:00:00'))).toBe('2026-08-05');
  });

  // TZ is pinned to Asia/Kolkata, which is UTC+5:30. A UTC-based key would
  // file anything before 05:30 under the previous day.
  it('uses the local day, not UTC', () => {
    expect(dayKey(new Date('2026-08-05T01:00:00'))).toBe('2026-08-05');
  });
});

describe('week and month boundaries', () => {
  it('starts weeks on Sunday, like the S M T W T F S header', () => {
    expect(dayKey(startOfWeek(WED))).toBe('2026-08-02');
  });

  it('treats Sunday as the start of its week', () => {
    const sunday = new Date('2026-08-09T12:00:00');
    expect(dayKey(startOfWeek(sunday))).toBe('2026-08-09');
  });

  it('starts months on the first', () => {
    expect(dayKey(startOfMonth(WED))).toBe('2026-08-01');
  });
});

describe('bandFor', () => {
  it('splits the day into morning, afternoon and night', () => {
    expect(['06:00', '11:59', '12:00', '16:59', '17:00', '23:30'].map(bandFor)).toEqual([
      'morning', 'morning', 'afternoon', 'afternoon', 'night', 'night',
    ]);
  });
});

describe('dosesDueOn', () => {
  it('counts one per scheduled time, not one per medicine', () => {
    expect(dosesDueOn(daily('a', ['08:00', '20:00']), WED)).toBe(2);
  });

  it('is zero on a day a weekly medicine is not scheduled', () => {
    // Wednesday is 3; schedule only Monday.
    expect(dosesDueOn(weekly('a', ['08:00'], [1]), WED)).toBe(0);
  });

  it('counts a weekly medicine on its own day', () => {
    expect(dosesDueOn(weekly('a', ['08:00'], [3]), WED)).toBe(1);
  });
});

describe('dayAdherence', () => {
  const meds = [daily('a', ['08:00', '20:00']), daily('b', ['09:00'])];

  it('is full when every dose is taken', () => {
    const entries = { a: [took('08:00'), took('20:00')], b: [took('09:00')] };
    expect(dayAdherence(meds, entries, WED, AFTER)).toMatchObject({
      state: DAY_STATE.FULL, due: 3, taken: 3, missed: 0,
    });
  });

  it('is partial when some are missing', () => {
    const entries = { a: [took('08:00')], b: [took('09:00')] };
    expect(dayAdherence(meds, entries, WED, AFTER)).toMatchObject({
      state: DAY_STATE.PARTIAL, due: 3, taken: 2, missed: 1,
    });
  });

  it('is missed when nothing was taken', () => {
    expect(dayAdherence(meds, {}, WED, AFTER)).toMatchObject({
      state: DAY_STATE.MISSED, due: 3, taken: 0, missed: 3,
    });
  });

  // The bug this whole module exists to avoid.
  it('does not let a morning dose cover the evening one', () => {
    const entries = { a: [took('08:00'), took('08:00')] };
    const result = dayAdherence([daily('a', ['08:00', '20:00'])], entries, WED, AFTER);
    expect(result.taken).toBe(1);
    expect(result.state).toBe(DAY_STATE.PARTIAL);
  });

  it('counts a skipped dose as missed', () => {
    const entries = { b: [{ status: 'skipped', slot: '09:00' }] };
    const result = dayAdherence([daily('b', ['09:00'])], entries, WED, WED);
    expect(result).toMatchObject({ taken: 0, missed: 1, state: DAY_STATE.MISSED });
  });

  // Was the visible bug: at 9 AM today already showed red, because the 8 PM
  // dose — hours away — was counted as not taken.
  it('does not count today`s later doses against you', () => {
    const at9 = new Date('2026-08-05T09:00:00');
    const result = dayAdherence(
      [daily('a', ['08:00', '20:00'])], { a: [took('08:00')] }, WED, at9
    );
    expect(result).toMatchObject({ state: DAY_STATE.FULL, due: 1, taken: 1, missed: 0 });
    expect(result.doses.map((d) => d.state)).toEqual([DOSE.TAKEN, DOSE.FUTURE]);
  });

  it('gives a dose its grace period before calling it missed', () => {
    const med = [daily('a', ['08:00'])];
    const inside = dayAdherence(med, {}, WED, new Date('2026-08-05T08:20:00'), 30);
    const after = dayAdherence(med, {}, WED, new Date('2026-08-05T08:31:00'), 30);
    expect(inside.doses[0].state).toBe(DOSE.DUE);
    expect(inside.state).toBe(DAY_STATE.FUTURE);
    expect(after.doses[0].state).toBe(DOSE.MISSED);
  });

  it('holds a snoozed dose open until its re-alarm and grace run out', () => {
    const med = [{ ...daily('a', ['08:00']), snoozeMinutes: 10 }];
    const entries = { a: [{ status: 'snoozed', slot: '08:00', at: '2026-08-05T08:25:00' }] };
    expect(dayAdherence(med, entries, WED, new Date('2026-08-05T08:50:00')).doses[0].state)
      .toBe(DOSE.SNOOZED);
    expect(dayAdherence(med, entries, WED, new Date('2026-08-05T09:10:00')).doses[0].state)
      .toBe(DOSE.MISSED);
  });

  it('files an old entry with no slot under a single-time medicine', () => {
    const result = dayAdherence([daily('a', ['08:00'])], { a: [{ status: 'taken' }] }, WED, AFTER);
    expect(result.state).toBe(DAY_STATE.FULL);
  });

  it('colours each bar by what happened in that part of the day', () => {
    const meds3 = [daily('a', ['08:00', '13:00']), daily('b', ['08:30', '21:00'])];
    const entries = { a: [took('08:00'), took('13:00')], b: [took('21:00')] };
    // Morning: 8:00 taken, 8:30 missed — partly taken, not simply missed.
    expect(dayAdherence(meds3, entries, WED, AFTER).bands).toEqual({
      morning: PARTIAL, afternoon: DOSE.TAKEN, night: DOSE.TAKEN,
    });
  });

  // 8 AM missed + 9 AM taken: neither "missed" nor "taken" is true of the
  // morning, and red would hide the dose that was taken.
  it('marks a bar partial when some doses in it were taken and some missed', () => {
    const med = daily('a', ['08:00', '09:00', '14:00', '20:00', '21:00']);
    const entries = { a: [took('09:00'), took('21:00')] };
    const result = dayAdherence([med], entries, WED, AFTER);
    expect(result.bands).toEqual({ morning: PARTIAL, afternoon: DOSE.MISSED, night: PARTIAL });
    expect(result).toMatchObject({ taken: 2, missed: 3, state: DAY_STATE.PARTIAL });
  });

  it('keeps a bar red when every dose in it was missed', () => {
    const med = daily('a', ['08:00', '09:00']);
    expect(dayAdherence([med], {}, WED, AFTER).bands.morning).toBe(DOSE.MISSED);
  });

  it('does not call taken + still-to-come partial', () => {
    const med = daily('a', ['08:00', '11:00']);
    const at9 = new Date('2026-08-05T09:00:00');
    expect(dayAdherence([med], { a: [took('08:00')] }, WED, at9).bands.morning).toBe(DOSE.FUTURE);
  });

  it('leaves a bar empty when nothing is scheduled then', () => {
    const result = dayAdherence([daily('a', ['08:00'])], { a: [took('08:00')] }, WED, AFTER);
    expect(result.bands).toEqual({ morning: DOSE.TAKEN, afternoon: 'none', night: 'none' });
  });

  it('reports nothing due rather than a perfect or missed day', () => {
    expect(dayAdherence([weekly('a', ['08:00'], [1])], {}, WED, WED).state)
      .toBe(DAY_STATE.NONE);
  });

  it('marks a future day as future, not missed', () => {
    const tomorrow = new Date('2026-08-06T09:00:00');
    expect(dayAdherence(meds, {}, tomorrow, WED).state).toBe(DAY_STATE.FUTURE);
  });

  it('copes with no medicines at all', () => {
    expect(dayAdherence([], {}, WED, WED).state).toBe(DAY_STATE.NONE);
    expect(dayAdherence(null, null, WED, WED).state).toBe(DAY_STATE.NONE);
  });
});

describe('rangeAdherence', () => {
  it('returns one entry per day, oldest first', () => {
    const days = rangeAdherence([daily('a', ['08:00'])], {},
      new Date('2026-08-03T00:00:00'), new Date('2026-08-09T00:00:00'), WED);
    expect(days).toHaveLength(7);
    expect(days[0].key).toBe('2026-08-03');
    expect(days[6].key).toBe('2026-08-09');
  });

  it('reads history keyed by day', () => {
    const history = { '2026-08-04': { a: [took('08:00')] } };
    const days = rangeAdherence([daily('a', ['08:00'])], history,
      new Date('2026-08-03T00:00:00'), new Date('2026-08-05T00:00:00'), WED);
    expect(days.map((d) => d.state)).toEqual([
      DAY_STATE.MISSED, DAY_STATE.FULL, DAY_STATE.MISSED,
    ]);
  });
});

describe('summarise', () => {
  const meds = [daily('a', ['08:00', '20:00'])];

  it('is a percentage of doses, not of days', () => {
    const history = {
      '2026-08-03': { a: [took('08:00'), took('20:00')] },
      '2026-08-04': { a: [took('08:00')] },
    };
    const days = rangeAdherence(meds, history,
      new Date('2026-08-03T00:00:00'), new Date('2026-08-04T00:00:00'), WED);
    expect(summarise(days)).toMatchObject({ due: 4, taken: 3, percent: 75 });
  });

  // A fortnight with no medicines is not 100% adherence.
  it('excludes days with nothing due', () => {
    const days = rangeAdherence([weekly('a', ['08:00'], [1])], {},
      new Date('2026-08-05T00:00:00'), new Date('2026-08-07T00:00:00'), WED);
    expect(summarise(days)).toMatchObject({ percent: null, days: 0 });
  });

  it('does not count future days against you', () => {
    const days = rangeAdherence(meds, {},
      new Date('2026-08-06T00:00:00'), new Date('2026-08-08T00:00:00'), WED);
    expect(summarise(days).days).toBe(0);
  });
});

describe('currentStreak', () => {
  const meds = [daily('a', ['08:00'])];
  const full = (day) => ({ [day]: { a: [took('08:00')] } });

  it('counts consecutive complete days ending now', () => {
    const history = {
      ...full('2026-08-03'), ...full('2026-08-04'), ...full('2026-08-05'),
    };
    const days = rangeAdherence(meds, history,
      new Date('2026-08-03T00:00:00'), new Date('2026-08-05T00:00:00'), WED);
    expect(currentStreak(days)).toBe(3);
  });

  it('breaks on a missed day', () => {
    const history = { ...full('2026-08-03'), ...full('2026-08-05') };
    const days = rangeAdherence(meds, history,
      new Date('2026-08-03T00:00:00'), new Date('2026-08-05T00:00:00'), WED);
    expect(currentStreak(days)).toBe(1);
  });

  // A weekly medicine's off day is not a failure, and not an achievement.
  it('steps over days with nothing due without breaking or extending', () => {
    const meds2 = [weekly('a', ['08:00'], [1, 3])]; // Mon + Wed
    const history = { ...full('2026-08-03'), ...full('2026-08-05') };
    const days = rangeAdherence(meds2, history,
      new Date('2026-08-03T00:00:00'), new Date('2026-08-05T00:00:00'), WED);
    expect(currentStreak(days)).toBe(2);
  });

  it('is zero with no history', () => {
    expect(currentStreak([])).toBe(0);
  });
});

describe('windowFor', () => {
  it('gives the current Sunday-to-Saturday week', () => {
    const { from, to } = windowFor('week', 0, WED);
    expect([dayKey(from), dayKey(to)]).toEqual(['2026-08-02', '2026-08-08']);
  });

  it('steps back a week at a time', () => {
    const { from, to } = windowFor('week', -1, WED);
    expect([dayKey(from), dayKey(to)]).toEqual(['2026-07-26', '2026-08-01']);
  });

  it('gives a whole calendar month, including its real length', () => {
    const { from, to } = windowFor('month', 0, WED);
    expect([dayKey(from), dayKey(to)]).toEqual(['2026-08-01', '2026-08-31']);
  });

  it('handles a short month when stepping back', () => {
    const { to } = windowFor('month', -6, WED); // February 2026
    expect(dayKey(to)).toBe('2026-02-28');
  });

  // Twelve months ending now, not January-to-date, which in January would be
  // a single day's worth of data presented as a year.
  it('gives twelve months ending with the current one', () => {
    const { from, to } = windowFor('year', 0, WED);
    expect([dayKey(from), dayKey(to)]).toEqual(['2025-09-01', '2026-08-31']);
  });
});

describe('groupByMonth', () => {
  it('rolls days up into months with their own percentages', () => {
    const meds = [daily('a', ['08:00'])];
    const history = { '2026-07-31': { a: [took('08:00')] } };
    const days = rangeAdherence(meds, history,
      new Date('2026-07-30T00:00:00'), new Date('2026-08-02T00:00:00'), WED);
    const months = groupByMonth(days);
    expect(months).toHaveLength(2);
    expect(months[0].key).toBe('2026-07');
    expect(months[0].percent).toBe(50); // one of two days
    expect(months[1].key).toBe('2026-08');
  });
});

// Guards the two navigation gaps found alongside the calendar work.
describe('screen reachability', () => {
  const app = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../App.js'), 'utf8'
  );
  const bar = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../src/components/BottomBar.js'), 'utf8'
  );

  it('registers Calendar for patients', () => {
    expect(app).toMatch(/name="Calendar"/);
  });

  // Approvals was registered in the patient stack ONLY, so a guardian's
  // navigate('Approvals') hit a route that did not exist and was silently
  // swallowed by the guard in App.js — they could never see their requests.
  it('registers Approvals in BOTH role stacks', () => {
    expect(app.match(/name="Approvals"/g)).toHaveLength(2);
  });

  it('registers Calendar in both stacks too', () => {
    expect(app.match(/name="Calendar"/g)).toHaveLength(2);
  });

  it('puts Calendar on the bottom bar', () => {
    expect(bar).toMatch(/key: 'Calendar'/);
  });
});
