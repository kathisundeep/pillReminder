import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  flagFor,
  countryByCode,
  countryByDial,
  detectCountryCode,
  detectCountry,
  nationalDigits,
  composePhone,
  splitPhone,
} from '../../src/utils/countries';

describe('country data', () => {
  it('has no duplicate ISO codes', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every entry a +dial and a flag', () => {
    for (const c of COUNTRIES) {
      expect(c.dial).toMatch(/^\+\d{1,4}$/);
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(c.flag.length).toBeGreaterThan(0);
    }
  });

  it('is sorted by name so the list is scannable', () => {
    const names = COUNTRIES.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('builds flags from regional indicators', () => {
    expect(flagFor('IN')).toBe('🇮🇳');
    expect(flagFor('US')).toBe('🇺🇸');
    expect(flagFor('GB')).toBe('🇬🇧');
  });

  it('falls back to a neutral flag for junk', () => {
    expect(flagFor('')).toBe('🏳');
    expect(flagFor('XYZ')).toBe('🏳');
    expect(flagFor(null)).toBe('🏳');
  });
});

describe('countryByCode', () => {
  it('finds a country and is case-insensitive', () => {
    expect(countryByCode('in').dial).toBe('+91');
    expect(countryByCode('IN').name).toBe('India');
  });

  it('falls back to the default rather than returning undefined', () => {
    expect(countryByCode('ZZ').code).toBe(DEFAULT_COUNTRY);
    expect(countryByCode(null).code).toBe(DEFAULT_COUNTRY);
  });
});

describe('countryByDial', () => {
  // The reason BY_DIAL is sorted longest-first. +1 would otherwise swallow
  // every North American country and send the SMS to the wrong place.
  it('prefers the longest matching dial code', () => {
    expect(countryByDial('+18683334444').code).toBe('TT');
    expect(countryByDial('+12125551234').code).toBe('US');
  });

  it('returns null when nothing matches', () => {
    expect(countryByDial('+9999999')).toBeNull();
    expect(countryByDial('')).toBeNull();
  });
});

describe('detectCountryCode', () => {
  it('reads the region from a locale tag', () => {
    expect(detectCountryCode({ locale: 'en-IN', zone: null })).toBe('IN');
    expect(detectCountryCode({ locale: 'en_US', zone: null })).toBe('US');
    expect(detectCountryCode({ locale: 'zh-Hant-TW', zone: null })).toBe('TW');
  });

  it('falls back to the timezone when the locale carries no region', () => {
    expect(detectCountryCode({ locale: 'en', zone: 'Asia/Kolkata' })).toBe('IN');
    expect(detectCountryCode({ locale: null, zone: 'Europe/London' })).toBe('GB');
    expect(detectCountryCode({ locale: '', zone: 'Asia/Dubai' })).toBe('AE');
  });

  it('matches US zones by prefix rather than listing every city', () => {
    expect(detectCountryCode({ locale: null, zone: 'America/Los_Angeles' })).toBe('US');
    expect(detectCountryCode({ locale: null, zone: 'US/Eastern' })).toBe('US');
  });

  it('ignores a region that is not a country we list', () => {
    expect(detectCountryCode({ locale: 'en-ZZ', zone: null })).toBe(DEFAULT_COUNTRY);
  });

  it('never returns nothing', () => {
    expect(detectCountryCode({ locale: null, zone: null })).toBe(DEFAULT_COUNTRY);
    expect(detectCountryCode({ locale: undefined, zone: 'Mars/Olympus' })).toBe(DEFAULT_COUNTRY);
  });

  it('uses the real runtime when given no sources', () => {
    // jest.config pins TZ to Asia/Kolkata, so this is deterministic.
    expect(detectCountry().code).toBe('IN');
    expect(detectCountry().dial).toBe('+91');
  });
});

describe('nationalDigits', () => {
  it('strips formatting', () => {
    expect(nationalDigits('98765 43210')).toBe('9876543210');
    expect(nationalDigits('(987) 654-3210')).toBe('9876543210');
  });

  // Locally people write 098765..., but E.164 has no trunk prefix and the SMS
  // silently goes nowhere if the zero survives.
  it('drops the trunk zero', () => {
    expect(nationalDigits('09876543210')).toBe('9876543210');
    expect(nationalDigits('007911123456')).toBe('7911123456');
  });

  it('handles empty input', () => {
    expect(nationalDigits('')).toBe('');
    expect(nationalDigits(null)).toBe('');
    expect(nationalDigits('0000')).toBe('');
  });
});

describe('composePhone', () => {
  const india = countryByCode('IN');

  it('joins the dial code to the national part', () => {
    expect(composePhone(india, '98765 43210')).toBe('+919876543210');
    expect(composePhone(india, '098765 43210')).toBe('+919876543210');
  });

  it('returns empty when there is no number yet, not a bare dial code', () => {
    expect(composePhone(india, '')).toBe('');
    expect(composePhone(india, '   ')).toBe('');
  });

  it('falls back to the default country when none is given', () => {
    expect(composePhone(null, '9876543210')).toBe('+919876543210');
  });
});

describe('splitPhone', () => {
  it('splits a stored E.164 number back into its parts', () => {
    const split = splitPhone('+919876543210');
    expect(split.country.code).toBe('IN');
    expect(split.national).toBe('9876543210');
  });

  it('tolerates formatting', () => {
    expect(splitPhone('+44 7911 123456').country.code).toBe('GB');
  });

  it('rejects a number with no country code', () => {
    expect(splitPhone('9876543210')).toBeNull();
    expect(splitPhone('')).toBeNull();
    expect(splitPhone(null)).toBeNull();
  });

  it('round-trips with composePhone', () => {
    for (const e164 of ['+919876543210', '+12125551234', '+447911123456']) {
      const split = splitPhone(e164);
      expect(composePhone(split.country, split.national)).toBe(e164);
    }
  });
});
