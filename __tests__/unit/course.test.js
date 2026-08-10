import {
  isWithinCourse,
  isCourseFinished,
  daysRemaining,
  isDueToday,
} from '../../src/utils/doseState';

const WED = new Date('2026-08-05T09:00:00'); // Wednesday
const everyDay = { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], times: ['08:00'] };

describe('isWithinCourse', () => {
  it('treats a medicine with no dates as ongoing', () => {
    expect(isWithinCourse({}, WED)).toBe(true);
    expect(isWithinCourse({ startDate: null, endDate: null }, WED)).toBe(true);
  });

  it('is true on the first day', () => {
    expect(isWithinCourse({ startDate: '2026-08-05' }, WED)).toBe(true);
  });

  it('is false before the course starts', () => {
    expect(isWithinCourse({ startDate: '2026-08-06' }, WED)).toBe(false);
  });

  // "Take it for 7 days" means the seventh day counts. Off-by-one here is a
  // dose the doctor prescribed and the app refused to remind anyone about.
  it('is true ON the end date, not just before it', () => {
    expect(isWithinCourse({ startDate: '2026-08-01', endDate: '2026-08-05' }, WED)).toBe(true);
  });

  it('is false the day after the course ends', () => {
    expect(isWithinCourse({ startDate: '2026-08-01', endDate: '2026-08-04' }, WED)).toBe(false);
  });

  it('handles a single-day course', () => {
    const oneDay = { startDate: '2026-08-05', endDate: '2026-08-05' };
    expect(isWithinCourse(oneDay, WED)).toBe(true);
    expect(isWithinCourse(oneDay, new Date('2026-08-06T09:00:00'))).toBe(false);
  });
});

describe('isCourseFinished', () => {
  it('is false for an ongoing medicine', () => {
    expect(isCourseFinished({}, WED)).toBe(false);
  });

  it('is false on the last day', () => {
    expect(isCourseFinished({ endDate: '2026-08-05' }, WED)).toBe(false);
  });

  it('is true once the end date has passed', () => {
    expect(isCourseFinished({ endDate: '2026-08-04' }, WED)).toBe(true);
  });

  it('is not "finished" merely because it has not started', () => {
    expect(isCourseFinished({ startDate: '2026-09-01' }, WED)).toBe(false);
  });
});

describe('daysRemaining', () => {
  it('is null for an ongoing medicine', () => {
    expect(daysRemaining({}, WED)).toBeNull();
  });

  it('counts today as one of the remaining days', () => {
    expect(daysRemaining({ endDate: '2026-08-05' }, WED)).toBe(1);
    expect(daysRemaining({ endDate: '2026-08-11' }, WED)).toBe(7);
  });

  it('never goes negative once the course is over', () => {
    expect(daysRemaining({ endDate: '2026-07-01' }, WED)).toBe(0);
  });
});

describe('isDueToday with a course', () => {
  it('is due inside the window on a scheduled weekday', () => {
    expect(isDueToday({ ...everyDay, endDate: '2026-08-10' }, WED)).toBe(true);
  });

  // The whole point: a repeating daily alarm that outlives its course trains
  // people to ignore alarms.
  it('is not due after the course ends, whatever the weekday says', () => {
    expect(isDueToday({ ...everyDay, endDate: '2026-08-04' }, WED)).toBe(false);
  });

  it('is not due before the course starts', () => {
    expect(isDueToday({ ...everyDay, startDate: '2026-08-06' }, WED)).toBe(false);
  });

  it('still respects the weekday schedule inside the window', () => {
    // Monday only; Wednesday is 3.
    expect(isDueToday({ daysOfWeek: [1], times: ['08:00'], endDate: '2026-12-31' }, WED))
      .toBe(false);
  });

  it('is unaffected for a medicine with no course dates', () => {
    expect(isDueToday(everyDay, WED)).toBe(true);
  });
});
