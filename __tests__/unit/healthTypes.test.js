import { READING_TYPES, typeById } from '../../src/utils/health';

describe('READING_TYPES', () => {
  it('offers the four tracked measurements', () => {
    expect(READING_TYPES.map((t) => t.id)).toEqual([
      'bp',
      'sugar',
      'cholesterol',
      'weight',
    ]);
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
