import {
  validUsername,
  synthEmail,
  rowToMed,
  medToRow,
  todayKey,
} from '../../src/utils/storage';

describe('validUsername', () => {
  it.each(['abc', 'sundeep', 'a_b.c', 'User123', '___', 'a'.repeat(30)])(
    'accepts %s',
    (u) => expect(validUsername(u)).toBe(true)
  );

  it.each([
    ['', 'empty'],
    ['ab', 'too short (2)'],
    ['a'.repeat(31), 'too long (31)'],
    ['has space', 'contains a space'],
    ['user@host', 'contains @'],
    ['user-name', 'contains a hyphen'],
    ['naïve', 'non-ascii'],
    ["bobby'; drop table--", 'sql-injection shaped'],
    ['<script>x</script>', 'html shaped'],
  ])('rejects %s (%s)', (u) => expect(validUsername(u)).toBe(false));

  it('trims before validating, so padded names are accepted', () => {
    expect(validUsername('  abc  ')).toBe(true);
  });

  it('coerces non-strings rather than throwing', () => {
    expect(validUsername(12345)).toBe(true);
  });

  // Was BUG-16: String(null) is 'null' and String(undefined) is 'undefined',
  // both of which matched the pattern.
  it('rejects null, undefined and other non-string types', () => {
    for (const bad of [null, undefined, {}, [], true, () => {}]) {
      expect(validUsername(bad)).toBe(false);
    }
  });
});

describe('synthEmail', () => {
  it('lowercases and trims so usernames are case-insensitive at signup', () => {
    expect(synthEmail('Sundeep')).toBe('sundeep@pillreminder.app');
    expect(synthEmail('  MiXeD  ')).toBe('mixed@pillreminder.app');
  });

  it('maps names differing only by case to the same address', () => {
    expect(synthEmail('Alice')).toBe(synthEmail('alice'));
    expect(synthEmail('ALICE')).toBe(synthEmail('alice'));
  });
});

describe('medToRow', () => {
  const uid = 'user-1';

  it('maps camelCase fields onto snake_case columns', () => {
    const row = medToRow(
      {
        name: 'Aspirin',
        form: 'Capsule',
        color: '#E53935',
        times: ['08:00', '20:00'],
        snoozeMinutes: 15,
        frequency: 'weekly',
        daysOfWeek: [1, 3, 5],
        toneId: 'bell',
        alertGuardian: false,
        photo: 'base64data',
      end_date: null,
      },
      uid
    );
    expect(row).toEqual({
      user_id: uid,
      name: 'Aspirin',
      form: 'Capsule',
      color: '#E53935',
      times: ['08:00', '20:00'],
      snooze_minutes: 15,
      frequency: 'weekly',
      days_of_week: [1, 3, 5],
      tone_id: 'bell',
      alert_guardian: false,
      photo: 'base64data',
      // Always sent, so making a medicine ongoing clears a previous end date
      // rather than leaving a stale one behind.
      end_date: null,
    });
  });

  it('applies the documented defaults for a bare medicine', () => {
    const row = medToRow({ name: 'X' }, uid);
    expect(row.form).toBe('Tablet');
    expect(row.color).toBe('#FFFFFF');
    expect(row.times).toEqual([]);
    expect(row.snooze_minutes).toBe(10);
    expect(row.frequency).toBe('daily');
    expect(row.days_of_week).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(row.tone_id).toBe('classic');
    expect(row.alert_guardian).toBe(true);
    expect(row.photo).toBeNull();
  });

  it('keeps an explicit snoozeMinutes of 0 (?? not ||)', () => {
    expect(medToRow({ name: 'X', snoozeMinutes: 0 }, uid).snooze_minutes).toBe(0);
  });

  it('treats alertGuardian as true unless it is exactly false', () => {
    expect(medToRow({ name: 'X' }, uid).alert_guardian).toBe(true);
    expect(medToRow({ name: 'X', alertGuardian: undefined }, uid).alert_guardian).toBe(true);
    expect(medToRow({ name: 'X', alertGuardian: false }, uid).alert_guardian).toBe(false);
  });

  it('forwards a real uuid id (an edit) but drops a client-generated one', () => {
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(medToRow({ id: uuid, name: 'X' }, uid).id).toBe(uuid);
    // AddMedicineScreen builds ids like `1717...._0_ab12` for new medicines;
    // those must not be sent, so Postgres generates the real uuid.
    expect(medToRow({ id: '1717000000000_0_ab12', name: 'X' }, uid).id).toBeUndefined();
    expect(medToRow({ name: 'X' }, uid).id).toBeUndefined();
  });
});

describe('rowToMed', () => {
  const row = {
    id: 'med-1',
    name: 'Aspirin',
    form: 'Tablet',
    color: '#FFFFFF',
    times: ['08:00'],
    snooze_minutes: 10,
    frequency: 'daily',
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    tone_id: 'chime',
    alert_guardian: true,
    photo: 'b64',
    created_at: '2025-01-01T00:00:00.000Z',
  };

  it('maps snake_case columns back to camelCase fields', () => {
    const med = rowToMed(row);
    expect(med.snoozeMinutes).toBe(10);
    expect(med.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(med.toneId).toBe('chime');
    expect(med.alertGuardian).toBe(true);
    expect(med.photo).toBe('b64');
    expect(med.createdAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('substitutes empty arrays for null times / days', () => {
    const med = rowToMed({ ...row, times: null, days_of_week: null });
    expect(med.times).toEqual([]);
    expect(med.daysOfWeek).toEqual([]);
  });

  it('nulls a missing photo rather than leaving it undefined', () => {
    expect(rowToMed({ ...row, photo: undefined }).photo).toBeNull();
  });

  it('attaches device-local notification ids from the map', () => {
    expect(rowToMed(row, { 'med-1': ['n1', 'n2'] }).notificationIds).toEqual(['n1', 'n2']);
    expect(rowToMed(row, {}).notificationIds).toEqual([]);
    expect(rowToMed(row).notificationIds).toEqual([]);
  });

  it('round-trips through medToRow without losing user-visible fields', () => {
    const med = rowToMed(row);
    const back = medToRow(med, 'user-1');
    expect(back.name).toBe(row.name);
    expect(back.times).toEqual(row.times);
    expect(back.snooze_minutes).toBe(row.snooze_minutes);
    expect(back.days_of_week).toEqual(row.days_of_week);
    expect(back.tone_id).toBe(row.tone_id);
    expect(back.alert_guardian).toBe(row.alert_guardian);
    expect(back.photo).toBe(row.photo);
  });
});

// Was BUG-05: todayKey used toISOString(), i.e. the UTC date, while every
// other piece of dose logic worked in local time. In IST the two disagreed for
// five and a half hours every night.
describe('todayKey', () => {
  afterEach(() => jest.useRealTimers());

  it('runs under a pinned IST timezone', () => {
    // Guards the rest of this block: these assertions only mean something if
    // the suite really is UTC+5:30 (see jest.config.js).
    expect(new Date(Date.UTC(2025, 5, 10, 0, 0)).getHours()).toBe(5);
  });

  it('returns the LOCAL calendar date', () => {
    jest.useFakeTimers();
    // 02:00 IST on 10 June is 20:30 UTC on 9 June. The local day is what counts.
    jest.setSystemTime(new Date('2025-06-09T20:30:00.000Z'));
    expect(new Date().getDate()).toBe(10);
    expect(todayKey()).toBe('2025-06-10');
  });

  it('agrees with the local date during the middle of the day', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-10T09:00:00.000Z')); // 14:30 IST
    expect(todayKey()).toBe('2025-06-10');
  });

  it('rolls over at local midnight, not 05:30', () => {
    jest.useFakeTimers();

    jest.setSystemTime(new Date('2025-06-09T18:29:00.000Z')); // 23:59 IST 9 Jun
    expect(todayKey()).toBe('2025-06-09');

    jest.setSystemTime(new Date('2025-06-09T18:31:00.000Z')); // 00:01 IST 10 Jun
    expect(todayKey()).toBe('2025-06-10'); // rolls with the local day

    jest.setSystemTime(new Date('2025-06-10T00:01:00.000Z')); // 05:31 IST 10 Jun
    expect(todayKey()).toBe('2025-06-10');
  });

  it('accepts an explicit date, for retention cutoffs', () => {
    expect(todayKey(new Date(2023, 0, 5))).toBe('2023-01-05');
    expect(todayKey(new Date(2023, 11, 31))).toBe('2023-12-31');
  });

  it('always produces a zero-padded YYYY-MM-DD string', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 0, 5, 12, 0, 0));
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayKey()).toBe('2025-01-05');
  });
});

describe('course dates round-trip', () => {
  it('sends both dates when a course is set', () => {
    const row = medToRow(
      { name: 'Amoxil', startDate: '2026-08-05', endDate: '2026-08-19' },
      'u1'
    );
    expect(row.start_date).toBe('2026-08-05');
    expect(row.end_date).toBe('2026-08-19');
  });

  // Sending start_date: undefined would travel as a no-op key; omitting it
  // lets the column default (today) apply.
  it('omits start_date entirely when unset', () => {
    expect('start_date' in medToRow({ name: 'X' }, 'u1')).toBe(false);
  });

  it('reads the dates back off a row', () => {
    const med = rowToMed({
      id: 'm1', name: 'X', times: [], start_date: '2026-08-05', end_date: '2026-08-19',
    });
    expect(med).toMatchObject({ startDate: '2026-08-05', endDate: '2026-08-19' });
  });

  it('reports an ongoing medicine as having no end', () => {
    const med = rowToMed({ id: 'm1', name: 'X', times: [], end_date: null });
    expect(med.endDate).toBeNull();
  });
});
