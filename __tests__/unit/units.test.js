import {
  heightToDisplay, heightToCm, heightError, cmToFeetInches,
  weightToDisplay, weightToKg, weightError,
  isoToDisplay, displayToIso, formatDateInput, dateOfBirthError, ageFromIso,
} from '../../src/utils/units';

describe('height', () => {
  it('shows centimetres unchanged', () => {
    expect(heightToDisplay(175, 'cm')).toBe('175');
  });

  it('converts to inches for display', () => {
    expect(heightToDisplay(175, 'in')).toBe('68.9');
  });

  it('stores centimetres whatever unit was typed', () => {
    expect(heightToCm('175', 'cm')).toBe(175);
    expect(heightToCm('68.9', 'in')).toBe(175);
  });

  // The stored value must not depend on a preference recorded elsewhere.
  it('round-trips through both units', () => {
    for (const cm of [150, 165, 180.5, 200]) {
      expect(heightToCm(heightToDisplay(cm, 'in'), 'in')).toBeCloseTo(cm, 0);
      expect(heightToCm(heightToDisplay(cm, 'cm'), 'cm')).toBeCloseTo(cm, 1);
    }
  });

  it('rejects nothing when left blank, since it is optional', () => {
    expect(heightError('', 'cm')).toBeNull();
    expect(heightError(null, 'cm')).toBeNull();
  });

  it('catches a unit mix-up in either direction', () => {
    expect(heightError('70', 'cm')).toBeNull();          // a small child, allowed
    expect(heightError('20', 'cm')).toMatch(/looks off/); // 20cm is not a person
    expect(heightError('175', 'in')).toMatch(/looks off/); // typed cm as inches
  });

  it('rejects text', () => {
    expect(heightError('tall', 'cm')).toBe('Enter a number.');
  });

  it('renders feet and inches', () => {
    expect(cmToFeetInches(175)).toEqual({ feet: 5, inches: 9 });
    expect(cmToFeetInches(0)).toBeNull();
  });
});

describe('weight', () => {
  it('converts between kg and lbs', () => {
    expect(weightToDisplay(70, 'kg')).toBe('70');
    expect(weightToDisplay(70, 'lb')).toBe('154.3');
    expect(weightToKg('154.3', 'lb')).toBeCloseTo(70, 0);
  });

  it('round-trips', () => {
    for (const kg of [50, 70, 88.5, 120]) {
      expect(weightToKg(weightToDisplay(kg, 'lb'), 'lb')).toBeCloseTo(kg, 0);
    }
  });

  it('catches an implausible figure', () => {
    expect(weightError('700', 'kg')).toMatch(/looks off/);
    expect(weightError('0.5', 'kg')).toMatch(/looks off/);
    expect(weightError('70', 'kg')).toBeNull();
  });

  it('is optional', () => {
    expect(weightError('', 'kg')).toBeNull();
  });
});

describe('date of birth', () => {
  it('shows a stored date as DD/MM/YYYY', () => {
    expect(isoToDisplay('2000-01-28')).toBe('28/01/2000');
  });

  it('parses DD/MM/YYYY back to storage form', () => {
    expect(displayToIso('28/01/2000')).toBe('2000-01-28');
    expect(displayToIso('5/3/1990')).toBe('1990-03-05');
  });

  // Date() would roll this into 2 March and store a birthday nobody has.
  it('rejects a day that does not exist in that month', () => {
    expect(displayToIso('31/02/2000')).toBeNull();
    expect(displayToIso('31/04/2000')).toBeNull();
  });

  it('accepts a real leap day and rejects a fake one', () => {
    expect(displayToIso('29/02/2000')).toBe('2000-02-29');
    expect(displayToIso('29/02/2001')).toBeNull();
  });

  it('returns null until the whole date is typed', () => {
    for (const partial of ['28', '28/01', '28/01/20', '', 'nonsense']) {
      expect(displayToIso(partial)).toBeNull();
    }
  });

  it('is unambiguous about which number is the day', () => {
    // 01/02 is 1 February, not 2 January.
    expect(displayToIso('01/02/2000')).toBe('2000-02-01');
  });
});

describe('formatDateInput', () => {
  it('adds the slashes as you type', () => {
    expect(formatDateInput('2')).toBe('2');
    expect(formatDateInput('28')).toBe('28/');
    expect(formatDateInput('2801')).toBe('28/01/');
    expect(formatDateInput('28012000')).toBe('28/01/2000');
  });

  it('ignores anything that is not a digit', () => {
    expect(formatDateInput('28/01/2000')).toBe('28/01/2000');
    expect(formatDateInput('28-01-2000')).toBe('28/01/2000');
    expect(formatDateInput('ab28')).toBe('28/');
  });

  it('stops at eight digits', () => {
    expect(formatDateInput('280120001234')).toBe('28/01/2000');
  });

  // Backspacing over an auto-inserted slash must delete the digit before it,
  // not re-add the slash and trap the cursor.
  it('lets a backspace through a slash actually delete', () => {
    expect(formatDateInput('28/', '28/')).toBe('28/');
    expect(formatDateInput('28', '28/')).toBe('2');
  });
});

describe('dateOfBirthError', () => {
  it('accepts a valid date', () => {
    expect(dateOfBirthError('28/01/2000')).toBeNull();
  });

  it('is optional', () => {
    expect(dateOfBirthError('')).toBeNull();
  });

  it('explains the expected format', () => {
    expect(dateOfBirthError('2000-01-28')).toMatch(/DD\/MM\/YYYY/);
    expect(dateOfBirthError('31/02/2000')).toMatch(/DD\/MM\/YYYY/);
  });

  it('rejects the future and implausible years', () => {
    expect(dateOfBirthError('01/01/2099')).toMatch(/future/);
    expect(dateOfBirthError('01/01/1850')).toMatch(/year/);
  });
});

describe('ageFromIso', () => {
  const now = new Date('2026-08-16T12:00:00');

  it('counts completed years', () => {
    expect(ageFromIso('2000-01-28', now)).toBe(26);
  });

  it('does not count a birthday that has not happened yet', () => {
    expect(ageFromIso('2000-12-25', now)).toBe(25);
  });

  it('counts the birthday itself', () => {
    expect(ageFromIso('2000-08-16', now)).toBe(26);
  });

  it('returns null for junk', () => {
    expect(ageFromIso('')).toBeNull();
    expect(ageFromIso('28/01/2000')).toBeNull();
  });
});
