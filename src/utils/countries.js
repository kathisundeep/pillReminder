// Country dialling codes, and a guess at which one to preselect.
//
// Deliberately dependency-free. expo-localization would give a cleaner region
// lookup, but it is a native module — adding it means a new APK and a new
// install for everyone, and this is a JS-only change that ships over the air.
// Everything below reads sources that already exist in the runtime.

// code|dial|name. Compact because it is data, not logic.
const RAW = [
  'AF|93|Afghanistan', 'AL|355|Albania', 'DZ|213|Algeria', 'AD|376|Andorra',
  'AO|244|Angola', 'AG|1268|Antigua and Barbuda', 'AR|54|Argentina',
  'AM|374|Armenia', 'AW|297|Aruba', 'AU|61|Australia', 'AT|43|Austria',
  'AZ|994|Azerbaijan', 'BS|1242|Bahamas', 'BH|973|Bahrain', 'BD|880|Bangladesh',
  'BB|1246|Barbados', 'BY|375|Belarus', 'BE|32|Belgium', 'BZ|501|Belize',
  'BJ|229|Benin', 'BM|1441|Bermuda', 'BT|975|Bhutan', 'BO|591|Bolivia',
  'BA|387|Bosnia and Herzegovina', 'BW|267|Botswana', 'BR|55|Brazil',
  'BN|673|Brunei', 'BG|359|Bulgaria', 'BF|226|Burkina Faso', 'BI|257|Burundi',
  'KH|855|Cambodia', 'CM|237|Cameroon', 'CA|1|Canada', 'CV|238|Cape Verde',
  'KY|1345|Cayman Islands', 'CF|236|Central African Republic', 'TD|235|Chad',
  'CL|56|Chile', 'CN|86|China', 'CO|57|Colombia', 'KM|269|Comoros',
  'CG|242|Congo', 'CD|243|Congo (DRC)', 'CR|506|Costa Rica', 'CI|225|Côte d’Ivoire',
  'HR|385|Croatia', 'CU|53|Cuba', 'CW|599|Curaçao', 'CY|357|Cyprus',
  'CZ|420|Czechia', 'DK|45|Denmark', 'DJ|253|Djibouti', 'DM|1767|Dominica',
  'DO|1809|Dominican Republic', 'EC|593|Ecuador', 'EG|20|Egypt',
  'SV|503|El Salvador', 'GQ|240|Equatorial Guinea', 'ER|291|Eritrea',
  'EE|372|Estonia', 'SZ|268|Eswatini', 'ET|251|Ethiopia', 'FJ|679|Fiji',
  'FI|358|Finland', 'FR|33|France', 'GA|241|Gabon', 'GM|220|Gambia',
  'GE|995|Georgia', 'DE|49|Germany', 'GH|233|Ghana', 'GI|350|Gibraltar',
  'GR|30|Greece', 'GL|299|Greenland', 'GD|1473|Grenada', 'GU|1671|Guam',
  'GT|502|Guatemala', 'GN|224|Guinea', 'GW|245|Guinea-Bissau', 'GY|592|Guyana',
  'HT|509|Haiti', 'HN|504|Honduras', 'HK|852|Hong Kong', 'HU|36|Hungary',
  'IS|354|Iceland', 'IN|91|India', 'ID|62|Indonesia', 'IR|98|Iran',
  'IQ|964|Iraq', 'IE|353|Ireland', 'IL|972|Israel', 'IT|39|Italy',
  'JM|1876|Jamaica', 'JP|81|Japan', 'JO|962|Jordan', 'KZ|7|Kazakhstan',
  'KE|254|Kenya', 'KI|686|Kiribati', 'KW|965|Kuwait', 'KG|996|Kyrgyzstan',
  'LA|856|Laos', 'LV|371|Latvia', 'LB|961|Lebanon', 'LS|266|Lesotho',
  'LR|231|Liberia', 'LY|218|Libya', 'LI|423|Liechtenstein', 'LT|370|Lithuania',
  'LU|352|Luxembourg', 'MO|853|Macao', 'MG|261|Madagascar', 'MW|265|Malawi',
  'MY|60|Malaysia', 'MV|960|Maldives', 'ML|223|Mali', 'MT|356|Malta',
  'MH|692|Marshall Islands', 'MR|222|Mauritania', 'MU|230|Mauritius',
  'MX|52|Mexico', 'FM|691|Micronesia', 'MD|373|Moldova', 'MC|377|Monaco',
  'MN|976|Mongolia', 'ME|382|Montenegro', 'MA|212|Morocco', 'MZ|258|Mozambique',
  'MM|95|Myanmar', 'NA|264|Namibia', 'NR|674|Nauru', 'NP|977|Nepal',
  'NL|31|Netherlands', 'NZ|64|New Zealand', 'NI|505|Nicaragua', 'NE|227|Niger',
  'NG|234|Nigeria', 'KP|850|North Korea', 'MK|389|North Macedonia',
  'NO|47|Norway', 'OM|968|Oman', 'PK|92|Pakistan', 'PW|680|Palau',
  'PS|970|Palestine', 'PA|507|Panama', 'PG|675|Papua New Guinea',
  'PY|595|Paraguay', 'PE|51|Peru', 'PH|63|Philippines', 'PL|48|Poland',
  'PT|351|Portugal', 'PR|1787|Puerto Rico', 'QA|974|Qatar', 'RO|40|Romania',
  'RU|7|Russia', 'RW|250|Rwanda', 'WS|685|Samoa', 'SM|378|San Marino',
  'SA|966|Saudi Arabia', 'SN|221|Senegal', 'RS|381|Serbia', 'SC|248|Seychelles',
  'SL|232|Sierra Leone', 'SG|65|Singapore', 'SK|421|Slovakia', 'SI|386|Slovenia',
  'SB|677|Solomon Islands', 'SO|252|Somalia', 'ZA|27|South Africa',
  'KR|82|South Korea', 'SS|211|South Sudan', 'ES|34|Spain', 'LK|94|Sri Lanka',
  'KN|1869|St Kitts and Nevis', 'LC|1758|St Lucia', 'VC|1784|St Vincent',
  'SD|249|Sudan', 'SR|597|Suriname', 'SE|46|Sweden', 'CH|41|Switzerland',
  'SY|963|Syria', 'TW|886|Taiwan', 'TJ|992|Tajikistan', 'TZ|255|Tanzania',
  'TH|66|Thailand', 'TL|670|Timor-Leste', 'TG|228|Togo', 'TO|676|Tonga',
  'TT|1868|Trinidad and Tobago', 'TN|216|Tunisia', 'TR|90|Türkiye',
  'TM|993|Turkmenistan', 'TV|688|Tuvalu', 'UG|256|Uganda', 'UA|380|Ukraine',
  'AE|971|United Arab Emirates', 'GB|44|United Kingdom', 'US|1|United States',
  'UY|598|Uruguay', 'UZ|998|Uzbekistan', 'VU|678|Vanuatu', 'VA|379|Vatican City',
  'VE|58|Venezuela', 'VN|84|Vietnam', 'YE|967|Yemen', 'ZM|260|Zambia',
  'ZW|263|Zimbabwe',
];

// Regional indicator symbols: 'IN' -> 🇮🇳. No flag images to ship or scale.
export function flagFor(code) {
  const c = String(code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '🏳';
  return String.fromCodePoint(
    ...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)
  );
}

export const COUNTRIES = RAW.map((row) => {
  const [code, dial, name] = row.split('|');
  return { code, dial: `+${dial}`, name, flag: flagFor(code) };
}).sort((a, b) => a.name.localeCompare(b.name));

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export const DEFAULT_COUNTRY = 'IN';

export function countryByCode(code) {
  return BY_CODE.get(String(code || '').toUpperCase()) || BY_CODE.get(DEFAULT_COUNTRY);
}

// A few dial codes are shared outright, with no way to tell the countries apart
// from the number alone. Naming a winner keeps the guess stable instead of
// leaving it to sort order — and it only affects which flag is shown, since the
// number dials identically either way.
const SHARED_DIAL_WINNER = { '+1': 'US', '+7': 'RU', '+599': 'CW' };

// Longest first, so +1 cannot shadow +1868 (Trinidad).
const BY_DIAL = [...COUNTRIES].sort((a, b) => {
  if (a.dial.length !== b.dial.length) return b.dial.length - a.dial.length;
  const winner = SHARED_DIAL_WINNER[a.dial];
  if (winner === a.code) return -1;
  if (winner === b.code) return 1;
  return 0;
});

export function countryByDial(dial) {
  const d = String(dial || '');
  return BY_DIAL.find((c) => d.startsWith(c.dial)) || null;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

// The phone's own timezone is the most reliable signal available without a
// native module: locale is often just "en" with no region, but a timezone is
// always set and is nearly always the country the SIM is in. Only zones whose
// country is unambiguous are listed — a wrong guess is worse than none, since
// the user then has to notice it and undo it.
const ZONE_COUNTRY = {
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD', 'Asia/Colombo': 'LK', 'Asia/Kathmandu': 'NP',
  'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA',
  'Asia/Kuwait': 'KW', 'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY',
  'Asia/Jakarta': 'ID', 'Asia/Manila': 'PH', 'Asia/Bangkok': 'TH',
  'Asia/Ho_Chi_Minh': 'VN', 'Asia/Seoul': 'KR', 'Asia/Tokyo': 'JP',
  'Asia/Shanghai': 'CN', 'Asia/Hong_Kong': 'HK', 'Asia/Taipei': 'TW',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Lisbon': 'PT',
  'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT', 'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Athens': 'GR',
  'Europe/Istanbul': 'TR', 'Europe/Moscow': 'RU', 'Europe/Kyiv': 'UA',
  'Africa/Lagos': 'NG', 'Africa/Nairobi': 'KE', 'Africa/Cairo': 'EG',
  'Africa/Johannesburg': 'ZA', 'Africa/Accra': 'GH', 'Africa/Casablanca': 'MA',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Mexico_City': 'MX',
  'America/Sao_Paulo': 'BR', 'America/Buenos_Aires': 'AR', 'America/Bogota': 'CO',
  'America/Lima': 'PE', 'America/Santiago': 'CL',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Perth': 'AU',
  'Pacific/Auckland': 'NZ',
};

// US zones are many and all map to one country, so match by prefix rather than
// listing every city.
const ZONE_PREFIX = [
  ['America/New_York', 'US'], ['America/Chicago', 'US'], ['America/Denver', 'US'],
  ['America/Los_Angeles', 'US'], ['America/Phoenix', 'US'], ['America/Anchorage', 'US'],
  ['US/', 'US'], ['Pacific/Honolulu', 'US'],
];

function regionFromLocale(tag) {
  // en-IN, en_IN, en-Latn-IN — take a standalone two-letter uppercase subtag.
  const parts = String(tag || '').replace(/_/g, '-').split('-');
  const region = parts.slice(1).find((p) => /^[A-Z]{2}$/.test(p));
  return region && BY_CODE.has(region) ? region : null;
}

function currentZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch (e) {
    return null;
  }
}

function currentLocale() {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    if (tag) return tag;
  } catch (e) {
    /* fall through */
  }
  return null;
}

// Returns an ISO country code, always — falls back to DEFAULT_COUNTRY.
// `sources` is injectable so tests can drive it without touching the runtime.
export function detectCountryCode(sources = {}) {
  const locale = 'locale' in sources ? sources.locale : currentLocale();
  const zone = 'zone' in sources ? sources.zone : currentZone();

  const fromLocale = regionFromLocale(locale);
  if (fromLocale) return fromLocale;

  if (zone) {
    if (ZONE_COUNTRY[zone]) return ZONE_COUNTRY[zone];
    const hit = ZONE_PREFIX.find(([prefix]) => zone.startsWith(prefix));
    if (hit) return hit[1];
  }

  return DEFAULT_COUNTRY;
}

export function detectCountry(sources) {
  return countryByCode(detectCountryCode(sources));
}

// ---------------------------------------------------------------------------
// Splitting and joining
// ---------------------------------------------------------------------------

// Digits only. The national part must never carry a leading zero: several
// countries write numbers as 0xx locally, but E.164 has no room for a trunk
// prefix and the SMS silently goes nowhere.
export function nationalDigits(raw) {
  return String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

export function composePhone(country, national) {
  const dial = (country && country.dial) || countryByCode(DEFAULT_COUNTRY).dial;
  const digits = nationalDigits(national);
  return digits ? `${dial}${digits}` : '';
}

// For a pasted or stored E.164 number: which country is it, and what is left.
export function splitPhone(e164) {
  const s = String(e164 ?? '').replace(/[\s()-]/g, '');
  if (!s.startsWith('+')) return null;
  const country = countryByDial(s);
  if (!country) return null;
  return { country, national: s.slice(country.dial.length) };
}
