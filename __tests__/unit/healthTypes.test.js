import { READING_TYPES, ADDABLE_TYPES, typeById } from '../../src/utils/health';

describe('READING_TYPES', () => {
  it('knows every measurement it can render', () => {
    expect(READING_TYPES.map((t) => t.id)).toEqual([
      'bp',
      'sugar',
      'cholesterol',
      'hemoglobin',
      'weight',
    ]);
  });

  // Weight is entered on the profile so there is one figure to trust. The type
  // survives so existing history still lists and charts.
  it('does not offer weight as something to add from Trackers', () => {
    expect(ADDABLE_TYPES.map((t) => t.id)).not.toContain('weight');
    expect(ADDABLE_TYPES.map((t) => t.id)).toContain('hemoglobin');
  });

  it('gives every type a label, unit, fields and a formatter', () => {
    for (const t of READING_TYPES) {
      expect(t.label).toBeTruthy();
      expect(t.unit).toBeTruthy();
      expect(Array.isArray(t.fields)).toBe(true);
      expect(t.fields.length).toBeGreaterThan(0);
      for (const f of t.fields) {
        expect(typeof f.key).toBe('string');
        expect(typeof f.label).toBe('string');
      }
      expect(typeof t.format).toBe('function');
    }
  });

  it('uses medically conventional units', () => {
    expect(typeById('bp').unit).toBe('mmHg');
    expect(typeById('sugar').unit).toBe('mg/dL');
    expect(typeById('cholesterol').unit).toBe('mg/dL');
    expect(typeById('weight').unit).toBe('kg');
  });
});

describe('typeById', () => {
  it('resolves each known id', () => {
    for (const t of READING_TYPES) expect(typeById(t.id)).toBe(t);
  });

  it('falls back to blood pressure for unknown ids', () => {
    for (const bad of [undefined, null, '', 'heartrate']) {
      expect(typeById(bad).id).toBe('bp');
    }
  });
});

describe('format()', () => {
  it('renders blood pressure as systolic/diastolic', () => {
    expect(typeById('bp').format({ systolic: 120, diastolic: 80 })).toBe('120/80');
  });

  it('renders a single-value reading as the bare number', () => {
    expect(typeById('sugar').format({ value: 96 })).toBe('96');
    expect(typeById('weight').format({ value: 71.5 })).toBe('71.5');
  });

  it('renders cholesterol with only the parts that were entered', () => {
    const chol = typeById('cholesterol');
    expect(chol.format({ total: 180, hdl: 55, ldl: 100 })).toBe(
      'Total 180 · HDL 55 · LDL 100'
    );
    expect(chol.format({ total: 180 })).toBe('Total 180');
    expect(chol.format({ total: 180, hdl: 55 })).toBe('Total 180 · HDL 55');
    expect(chol.format({ total: 180, ldl: 100 })).toBe('Total 180 · LDL 100');
  });

  // Was BUG-17: a truthiness check dropped a legitimately recorded 0.
  it('keeps an HDL/LDL of exactly 0', () => {
    expect(typeById('cholesterol').format({ total: 180, hdl: 0 })).toBe(
      'Total 180 · HDL 0'
    );
    expect(typeById('cholesterol').format({ total: 180, ldl: 0 })).toBe(
      'Total 180 · LDL 0'
    );
  });

  it('still omits an HDL/LDL that was never entered', () => {
    expect(typeById('cholesterol').format({ total: 180, hdl: undefined })).toBe('Total 180');
    expect(typeById('cholesterol').format({ total: 180, ldl: null })).toBe('Total 180');
  });

  it('does not throw on missing values, it renders undefined', () => {
    expect(typeById('bp').format({})).toBe('undefined/undefined');
  });
});

describe('reference bands', () => {
  const { bandOf, chartValue, BANDS } = require('../../src/utils/health');

  it('bands a hemoglobin reading', () => {
    expect(bandOf('hemoglobin', { value: 9 })).toBe(BANDS.LOW);
    expect(bandOf('hemoglobin', { value: 14 })).toBe(BANDS.NORMAL);
    expect(bandOf('hemoglobin', { value: 19 })).toBe(BANDS.HIGH);
  });

  // 120/95 is not a normal reading just because the systolic looks fine.
  it('lets the worse half of a blood pressure decide the band', () => {
    expect(bandOf('bp', { systolic: 120, diastolic: 95 })).toBe(BANDS.HIGH);
    expect(bandOf('bp', { systolic: 145, diastolic: 80 })).toBe(BANDS.HIGH);
    expect(bandOf('bp', { systolic: 118, diastolic: 76 })).toBe(BANDS.NORMAL);
  });

  it('returns unknown rather than guessing', () => {
    expect(bandOf('hemoglobin', { value: 'abc' })).toBe(BANDS.UNKNOWN);
    expect(bandOf('hemoglobin', null)).toBe(BANDS.UNKNOWN);
    expect(bandOf('weight', { value: 70 })).toBe(BANDS.UNKNOWN);
  });

  it('picks the number worth charting per type', () => {
    expect(chartValue('bp', { systolic: 120, diastolic: 80 })).toBe(120);
    expect(chartValue('cholesterol', { total: 190, hdl: 50 })).toBe(190);
    expect(chartValue('hemoglobin', { value: 13.5 })).toBe(13.5);
    expect(chartValue('hemoglobin', { value: 'x' })).toBeNull();
    expect(chartValue('hemoglobin', null)).toBeNull();
  });
});
