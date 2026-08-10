import {
  formatTime,
  formatClock,
  doseDateOn,
  latestPassedTime,
  isDueToday,
  medState,
  slotStatus,
  computeDoseDeadline,
} from '../../src/utils/doseState';

// Local-time helper: builds a Date for today-ish at a given wall clock.
const at = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2025, 5, day, h, m, 0, 0); // June 2025
  return d;
};

const entry = (status, date) => ({ status, at: date.toISOString() });

describe('formatTime (HH:MM -> 12h)', () => {
  it.each([
    ['00:00', '12:00 AM'],
    ['00:05', '12:05 AM'],
    ['01:00', '1:00 AM'],
    ['09:07', '9:07 AM'],
    ['11:59', '11:59 AM'],
    ['12:00', '12:00 PM'],
    ['12:30', '12:30 PM'],
    ['13:00', '1:00 PM'],
    ['20:05', '8:05 PM'],
    ['23:59', '11:59 PM'],
  ])('%s -> %s', (input, expected) => {
    expect(formatTime(input)).toBe(expected);
  });

  it('pads minutes to two digits', () => {
    expect(formatTime('08:00')).toBe('8:00 AM');
    expect(formatTime('08:05')).toBe('8:05 AM');
  });
});

describe('formatClock (Date -> 12h)', () => {
  it('renders midnight as 12 AM and noon as 12 PM', () => {
    expect(formatClock(at(10, '00:00'))).toBe('12:00 AM');
    expect(formatClock(at(10, '12:00'))).toBe('12:00 PM');
  });

  it('agrees with formatTime for the same wall clock', () => {
    for (const t of ['00:00', '07:30', '12:00', '13:45', '23:59']) {
      expect(formatClock(at(10, t))).toBe(formatTime(t));
    }
  });
});

describe('doseDateOn', () => {
  it('anchors HH:MM to the same local day as `now`', () => {
    const now = at(10, '15:00');
    const d = doseDateOn('08:30', now);
    expect(d.getFullYear()).toBe(now.getFullYear());
    expect(d.getMonth()).toBe(now.getMonth());
    expect(d.getDate()).toBe(now.getDate());
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(30);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });
});

describe('latestPassedTime', () => {
  const med = { times: ['08:00', '14:00', '20:00'] };

  it('returns null before the first dose of the day', () => {
    expect(latestPassedTime(med, at(10, '07:59'))).toBeNull();
  });

  it('returns the dose time exactly at the dose minute', () => {
    expect(latestPassedTime(med, at(10, '08:00'))).toEqual(at(10, '08:00'));
  });

  it('returns the most recent passed time, not the first', () => {
    expect(latestPassedTime(med, at(10, '15:00'))).toEqual(at(10, '14:00'));
    expect(latestPassedTime(med, at(10, '23:00'))).toEqual(at(10, '20:00'));
  });

  it('is order-independent for unsorted times', () => {
    const unsorted = { times: ['20:00', '08:00', '14:00'] };
    expect(latestPassedTime(unsorted, at(10, '15:00'))).toEqual(at(10, '14:00'));
  });

  it('returns null for a medicine with no times', () => {
    expect(latestPassedTime({ times: [] }, at(10, '12:00'))).toBeNull();
    expect(latestPassedTime({}, at(10, '12:00'))).toBeNull();
  });
});

describe('isDueToday', () => {
  // 2025-06-08 is a Sunday (getDay() === 0); 2025-06-11 is a Wednesday (3).
  const sunday = at(8, '10:00');
  const wednesday = at(11, '10:00');

  it('matches an explicit day list', () => {
    expect(isDueToday({ daysOfWeek: [0] }, sunday)).toBe(true);
    expect(isDueToday({ daysOfWeek: [0] }, wednesday)).toBe(false);
    expect(isDueToday({ daysOfWeek: [1, 3, 5] }, wednesday)).toBe(true);
  });

  it('treats an empty or missing day list as every day', () => {
    expect(isDueToday({ daysOfWeek: [] }, sunday)).toBe(true);
    expect(isDueToday({}, wednesday)).toBe(true);
  });

  it('covers every weekday index 0..6', () => {
    for (let i = 0; i < 7; i += 1) {
      const day = at(8 + i, '10:00');
      expect(isDueToday({ daysOfWeek: [day.getDay()] }, day)).toBe(true);
    }
  });
});

describe('medState', () => {
  const med = { times: ['08:00', '20:00'], snoozeMinutes: 10 };

  it('is upcoming before the first dose time', () => {
    expect(medState(med, [], at(10, '07:00'))).toBe('upcoming');
  });

  it('is pending once a dose time has passed and nothing was logged', () => {
    expect(medState(med, [], at(10, '08:30'))).toBe('pending');
  });

  it('is taken when any taken entry exists', () => {
    const entries = [entry('taken', at(10, '08:05'))];
    expect(medState(med, entries, at(10, '09:00'))).toBe('taken');
  });

  it('is skipped when a skip exists and no taken entry does', () => {
    const entries = [entry('skipped', at(10, '08:05'))];
    expect(medState(med, entries, at(10, '09:00'))).toBe('skipped');
  });

  it('prefers taken over skipped when both exist', () => {
    const entries = [
      entry('skipped', at(10, '08:05')),
      entry('taken', at(10, '08:30')),
    ];
    expect(medState(med, entries, at(10, '09:00'))).toBe('taken');
  });

  it('is snoozed while the snooze window is still open', () => {
    const entries = [entry('snoozed', at(10, '08:05'))];
    expect(medState(med, entries, at(10, '08:10'))).toBe('snoozed');
  });

  it('falls back to pending once the snooze window has elapsed', () => {
    const entries = [entry('snoozed', at(10, '08:05'))];
    expect(medState(med, entries, at(10, '08:16'))).toBe('pending');
  });

  it('uses the LAST snooze to compute the window', () => {
    const entries = [
      entry('snoozed', at(10, '08:05')),
      entry('snoozed', at(10, '08:20')),
    ];
    // First window ended 08:15; the second runs to 08:30.
    expect(medState(med, entries, at(10, '08:25'))).toBe('snoozed');
    expect(medState(med, entries, at(10, '08:31'))).toBe('pending');
  });

  it('honours a custom snoozeMinutes', () => {
    const slow = { ...med, snoozeMinutes: 30 };
    const entries = [entry('snoozed', at(10, '08:00'))];
    expect(medState(slow, entries, at(10, '08:20'))).toBe('snoozed');
    expect(medState(slow, entries, at(10, '08:31'))).toBe('pending');
  });

  it('defaults snoozeMinutes to 10 when unset or non-numeric', () => {
    const noSnooze = { times: ['08:00'] };
    const entries = [entry('snoozed', at(10, '08:00'))];
    expect(medState(noSnooze, entries, at(10, '08:05'))).toBe('snoozed');
    expect(medState(noSnooze, entries, at(10, '08:11'))).toBe('pending');
  });

  it('reports upcoming (not pending) when snoozed before any dose time passed', () => {
    // No dose time has passed yet and the snooze window has closed.
    const entries = [entry('snoozed', at(10, '06:00'))];
    expect(medState(med, entries, at(10, '07:00'))).toBe('upcoming');
  });

  // Documents current behaviour: dose history is keyed per DAY, not per dose.
  // See docs/audit-report.md — BUG-06.
  it('marks the whole day taken after a single morning dose (per-day keying)', () => {
    const entries = [entry('taken', at(10, '08:05'))];
    expect(medState(med, entries, at(10, '20:30'))).toBe('taken');
  });
});

describe('slotStatus', () => {
  const item = (state) => ({ state });

  it('is done only when every medicine in the slot is taken', () => {
    expect(slotStatus([item('taken'), item('taken')])).toBe('done');
    expect(slotStatus([item('taken'), item('pending')])).not.toBe('done');
  });

  it('is due when any medicine is pending', () => {
    expect(slotStatus([item('taken'), item('pending')])).toBe('due');
    expect(slotStatus([item('snoozed'), item('pending')])).toBe('due');
  });

  it('is upcoming when nothing is pending and not all are taken', () => {
    expect(slotStatus([item('upcoming'), item('upcoming')])).toBe('upcoming');
    expect(slotStatus([item('snoozed'), item('taken')])).toBe('upcoming');
    expect(slotStatus([item('skipped')])).toBe('upcoming');
  });

  it('treats an empty slot as done (every() on [] is true)', () => {
    expect(slotStatus([])).toBe('done');
  });
});

describe('computeDoseDeadline', () => {
  const lastPassed = at(10, '08:00');

  it('defaults to dose time + grace', () => {
    const r = computeDoseDeadline({
      lastPassed,
      entries: [],
      grace: 30,
      now: at(10, '08:10'),
    });
    expect(r.deadline).toEqual(at(10, '08:30'));
    expect(r.skipped).toBe(false);
    expect(r.insideSnoozeWindow).toBe(false);
  });

  it('an explicit skip moves the deadline to skip time + grace and flags skipped', () => {
    const r = computeDoseDeadline({
      lastPassed,
      entries: [entry('skipped', at(10, '08:20'))],
      grace: 30,
      now: at(10, '08:25'),
    });
    expect(r.deadline).toEqual(at(10, '08:50'));
    expect(r.skipped).toBe(true);
  });

  it('skip takes precedence over snooze', () => {
    const r = computeDoseDeadline({
      lastPassed,
      entries: [
        entry('snoozed', at(10, '08:05')),
        entry('skipped', at(10, '08:20')),
      ],
      grace: 15,
      snoozeMinutes: 10,
      now: at(10, '09:00'),
    });
    expect(r.skipped).toBe(true);
    expect(r.deadline).toEqual(at(10, '08:35')); // 08:20 + 15
  });

  it('reports insideSnoozeWindow before the snooze re-alarm fires', () => {
    const r = computeDoseDeadline({
      lastPassed,
      entries: [entry('snoozed', at(10, '08:05'))],
      grace: 30,
      snoozeMinutes: 10,
      now: at(10, '08:10'),
    });
    expect(r.insideSnoozeWindow).toBe(true);
    expect(r.deadline).toBeNull();
  });

  it('after the snooze fires, the deadline is re-alarm + grace', () => {
    const r = computeDoseDeadline({
      lastPassed,
      entries: [entry('snoozed', at(10, '08:05'))],
      grace: 30,
      snoozeMinutes: 10,
      now: at(10, '08:20'),
    });
    expect(r.insideSnoozeWindow).toBe(false);
    expect(r.deadline).toEqual(at(10, '08:45')); // 08:15 + 30
  });

  it('uses the LAST snooze when several exist', () => {
    const r = computeDoseDeadline({
      lastPassed,
      entries: [
        entry('snoozed', at(10, '08:05')),
        entry('snoozed', at(10, '08:40')),
      ],
      grace: 10,
      snoozeMinutes: 10,
      now: at(10, '09:00'),
    });
    expect(r.deadline).toEqual(at(10, '09:00')); // 08:50 + 10
  });

  it('sorts snoozes by time, not array order', () => {
    const r = computeDoseDeadline({
      lastPassed,
      entries: [
        entry('snoozed', at(10, '08:40')),
        entry('snoozed', at(10, '08:05')),
      ],
      grace: 10,
      snoozeMinutes: 10,
      now: at(10, '09:00'),
    });
    expect(r.deadline).toEqual(at(10, '09:00'));
  });

  it('defaults snoozeMinutes to 10 when missing or zero', () => {
    for (const snoozeMinutes of [undefined, 0, null, 'abc']) {
      const r = computeDoseDeadline({
        lastPassed,
        entries: [entry('snoozed', at(10, '08:00'))],
        grace: 0,
        snoozeMinutes,
        now: at(10, '09:00'),
      });
      expect(r.deadline).toEqual(at(10, '08:10'));
    }
  });

  it('a zero grace makes the deadline the dose time itself', () => {
    const r = computeDoseDeadline({
      lastPassed,
      entries: [],
      grace: 0,
      now: at(10, '08:00'),
    });
    expect(r.deadline).toEqual(at(10, '08:00'));
  });

  it('ignores taken/missed entries when picking the deadline', () => {
    const r = computeDoseDeadline({
      lastPassed,
      entries: [entry('missed', at(10, '08:40')), entry('taken', at(10, '08:50'))],
      grace: 30,
      now: at(10, '09:00'),
    });
    expect(r.deadline).toEqual(at(10, '08:30')); // dose time + grace
  });
});
