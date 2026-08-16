import { supabase } from './supabase';

// Health trackers stored in public.health_readings (RLS: owner + linked guardian
// read). `values` is a jsonb blob shaped per type.

export const BANDS = { LOW: 'low', NORMAL: 'normal', HIGH: 'high', UNKNOWN: 'unknown' };

// Below `low` is low, above `high` is high, anything between is normal.
function bandFor(value, low, high) {
  if (!Number.isFinite(value)) return BANDS.UNKNOWN;
  if (value < low) return BANDS.LOW;
  if (value > high) return BANDS.HIGH;
  return BANDS.NORMAL;
}

export const READING_TYPES = [
  {
    id: 'bp',
    label: 'Blood pressure',
    unit: 'mmHg',
    fields: [
      { key: 'systolic', label: 'Systolic' },
      { key: 'diastolic', label: 'Diastolic' },
    ],
    format: (v) => `${v.systolic}/${v.diastolic}`,
    // Whichever number is worse decides the band: 120/95 is not a normal
    // reading just because the systolic looks fine.
    band: (v) => {
      const sys = bandFor(Number(v.systolic), 90, 130);
      const dia = bandFor(Number(v.diastolic), 60, 85);
      if (sys === BANDS.HIGH || dia === BANDS.HIGH) return BANDS.HIGH;
      if (sys === BANDS.LOW || dia === BANDS.LOW) return BANDS.LOW;
      if (sys === BANDS.UNKNOWN || dia === BANDS.UNKNOWN) return BANDS.UNKNOWN;
      return BANDS.NORMAL;
    },
  },
  {
    id: 'sugar',
    label: 'Blood sugar',
    unit: 'mg/dL',
    fields: [{ key: 'value', label: 'Reading' }],
    format: (v) => `${v.value}`,
    // Non-fasting range; the app does not ask which it was.
    band: (v) => bandFor(Number(v.value), 70, 140),
  },
  {
    id: 'cholesterol',
    label: 'Cholesterol',
    unit: 'mg/dL',
    fields: [
      { key: 'total', label: 'Total' },
      { key: 'hdl', label: 'HDL' },
      { key: 'ldl', label: 'LDL' },
    ],
    // Check for presence, not truthiness: a recorded HDL/LDL of 0 is data.
    format: (v) =>
      `Total ${v.total}` +
      (v.hdl != null ? ` · HDL ${v.hdl}` : '') +
      (v.ldl != null ? ` · LDL ${v.ldl}` : ''),
    band: (v) => bandFor(Number(v.total), 0, 200),
  },
  {
    id: 'hemoglobin',
    label: 'Hemoglobin',
    unit: 'g/dL',
    fields: [{ key: 'value', label: 'Hemoglobin' }],
    format: (v) => `${v.value}`,
    // Adult reference range. Deliberately wide and sex-neutral: the app does
    // not know enough to be precise, and a band that is too tight would flag
    // healthy people. It is an observation aid, not a diagnosis.
    band: (v) => bandFor(Number(v.value), 12, 17),
  },
  {
    id: 'weight',
    label: 'Weight',
    unit: 'kg',
    fields: [{ key: 'value', label: 'Weight' }],
    format: (v) => `${v.value}`,
    // Recorded on the profile, not here: one figure, one place. Kept as a type
    // so existing history still renders and charts.
    enteredInProfile: true,
  },
];

// The reading types a user can ADD from the trackers screen.
export const ADDABLE_TYPES = READING_TYPES.filter((t) => !t.enteredInProfile);

// The band for a reading, or 'unknown' when the type has no reference range
// or the value cannot be read as a number.
export function bandOf(type, values) {
  const t = typeById(type);
  if (typeof t.band !== 'function' || !values) return BANDS.UNKNOWN;
  try {
    return t.band(values) || BANDS.UNKNOWN;
  } catch (e) {
    return BANDS.UNKNOWN;
  }
}

// A single number per reading, for charting. Multi-field types chart the one
// that matters most.
export function chartValue(type, values) {
  if (!values) return null;
  const pick =
    type === 'bp' ? values.systolic
    : type === 'cholesterol' ? values.total
    : values.value;
  const n = Number(pick);
  return Number.isFinite(n) ? n : null;
}

export function typeById(id) {
  return READING_TYPES.find((t) => t.id === id) || READING_TYPES[0];
}

export async function addReading(type, values, note) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new Error('not signed in');
  const t = typeById(type);
  const { error } = await supabase.from('health_readings').insert({
    user_id: u.user.id,
    type,
    reading_values: values,
    unit: t.unit,
    note: note || null,
    measured_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// Normalise the row shape for callers: the column is reading_values in the
// database (`values` is a reserved SQL keyword), `values` in the app.
function rowToReading(r) {
  return { ...r, values: r.reading_values ?? r.values ?? {} };
}

async function fetchReadings(userId, type, limit) {
  let q = supabase
    .from('health_readings')
    .select('*')
    .eq('user_id', userId)
    .order('measured_at', { ascending: false })
    .limit(limit);
  if (type) q = q.eq('type', type);
  const { data } = await q;
  return (data || []).map(rowToReading);
}

// Recent readings, `limit` PER TYPE rather than across all of them. A single
// shared cap meant someone logging weight daily pushed their blood-pressure
// history out of the report entirely, with no indication anything was missing.
async function readingsFor(userId, type, limit) {
  if (!userId) return [];
  if (type) return fetchReadings(userId, type, limit);

  const perType = await Promise.all(
    READING_TYPES.map((t) => fetchReadings(userId, t.id, limit))
  );
  return perType
    .flat()
    .sort((a, b) => new Date(b.measured_at) - new Date(a.measured_at));
}

// Recent readings for the signed-in user (optionally filtered by type).
export async function getReadings(type, limit = 60) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return [];
  return readingsFor(u.user.id, type, limit);
}

// Readings for a linked user (guardian view — RLS allows the read).
export async function getUserReadings(userId, type, limit = 60) {
  return readingsFor(userId, type, limit);
}

export async function deleteReading(id) {
  await supabase.from('health_readings').delete().eq('id', id);
}
