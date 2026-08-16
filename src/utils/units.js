// Units and date formatting for the profile.
//
// One rule throughout: the STORED value never changes with the unit. Height is
// always centimetres in the database and weight always kilograms; the unit is
// only how it is typed and shown. Storing whatever the user last picked would
// mean a height of 70 that is either a tall adult or a small child depending on
// a preference recorded somewhere else — and every later comparison silently
// wrong.

export const HEIGHT_UNITS = [
  { id: 'cm', label: 'cm' },
  { id: 'in', label: 'inches' },
];

export const WEIGHT_UNITS = [
  { id: 'kg', label: 'kg' },
  { id: 'lb', label: 'lbs' },
];

const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.45359237;

function round(value, places) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

// ---------------------------------------------------------------------------
// Height — stored in cm
// ---------------------------------------------------------------------------

export function heightToDisplay(cm, unit) {
  const n = Number(cm);
  if (!Number.isFinite(n) || n <= 0) return '';
  return unit === 'in' ? String(round(n / CM_PER_INCH, 1)) : String(round(n, 1));
}

export function heightToCm(value, unit) {
  const n = Number(String(value ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return unit === 'in' ? round(n * CM_PER_INCH, 1) : round(n, 1);
}

// Bounds are generous on purpose. They exist to catch a unit mix-up — 70 typed
// as centimetres, or 175 typed as inches — not to police real human variation.
export function heightError(value, unit) {
  if (!String(value ?? '').trim()) return null; // optional
  const cm = heightToCm(value, unit);
  if (cm == null) return 'Enter a number.';
  if (cm < 50 || cm > 260) {
    return unit === 'in'
      ? 'That looks off — expected roughly 20 to 102 inches.'
      : 'That looks off — expected roughly 50 to 260 cm.';
  }
  return null;
}

// 175 cm -> 5' 9" for display alongside the number.
export function cmToFeetInches(cm) {
  const n = Number(cm);
  if (!Number.isFinite(n) || n <= 0) return null;
  const totalInches = Math.round(n / CM_PER_INCH);
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

// ---------------------------------------------------------------------------
// Weight — stored in kg
// ---------------------------------------------------------------------------

export function weightToDisplay(kg, unit) {
  const n = Number(kg);
  if (!Number.isFinite(n) || n <= 0) return '';
  return unit === 'lb' ? String(round(n / KG_PER_LB, 1)) : String(round(n, 1));
}

export function weightToKg(value, unit) {
  const n = Number(String(value ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return unit === 'lb' ? round(n * KG_PER_LB, 1) : round(n, 1);
}

export function weightError(value, unit) {
  if (!String(value ?? '').trim()) return null; // optional
  const kg = weightToKg(value, unit);
  if (kg == null) return 'Enter a number.';
  if (kg < 2 || kg > 400) {
    return unit === 'lb'
      ? 'That looks off — expected roughly 4 to 880 lbs.'
      : 'That looks off — expected roughly 2 to 400 kg.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dates — shown as DD/MM/YYYY, stored as YYYY-MM-DD
// ---------------------------------------------------------------------------

export function isoToDisplay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// Accepts 28/01/2000 and the partially typed forms in between. Returns null
// until the whole thing is a real date, so a half-typed entry is never saved.
export function displayToIso(display) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(display ?? '').trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  // Rejects 31/02/2000, which Date would happily roll into 2 March.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Inserts the slashes while typing, so the field reads 28/01/2000 without the
// user having to enter them.
export function formatDateInput(text, previous = '') {
  const raw = String(text ?? '');
  const digitsOnly = raw.replace(/\D/g, '').slice(0, 8);

  // Deleting through a slash must remove the digit before it, not re-add the
  // slash and trap the cursor.
  if (raw.length < previous.length && previous.endsWith('/')) {
    const trimmed = digitsOnly.slice(0, -1);
    return formatDateInput(trimmed);
  }

  const parts = [digitsOnly.slice(0, 2), digitsOnly.slice(2, 4), digitsOnly.slice(4, 8)]
    .filter((p) => p.length > 0);
  let out = parts.join('/');
  // Trailing slash once a section is complete, so typing flows on.
  if (digitsOnly.length === 2 || digitsOnly.length === 4) out += '/';
  return out;
}

export function dateOfBirthError(display) {
  const text = String(display ?? '').trim();
  if (!text) return null; // optional
  const iso = displayToIso(text);
  if (!iso) return 'Use DD/MM/YYYY, e.g. 28/01/2000.';

  const date = new Date(`${iso}T00:00:00`);
  const now = new Date();
  if (date > now) return 'That date is in the future.';
  if (now.getFullYear() - date.getFullYear() > 120) return 'Check the year.';
  return null;
}

export function ageFromIso(iso, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  if (!m) return null;
  const birth = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let age = now.getFullYear() - birth.getFullYear();
  const before =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (before) age -= 1;
  return age >= 0 ? age : null;
}
