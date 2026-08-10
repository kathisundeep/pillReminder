import { supabase } from './supabase';

// Health trackers stored in public.health_readings (RLS: owner + linked guardian
// read). `values` is a jsonb blob shaped per type.

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
  },
  {
    id: 'sugar',
    label: 'Blood sugar',
    unit: 'mg/dL',
    fields: [{ key: 'value', label: 'Reading' }],
    format: (v) => `${v.value}`,
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
  },
  {
    id: 'weight',
    label: 'Weight',
    unit: 'kg',
    fields: [{ key: 'value', label: 'Weight' }],
    format: (v) => `${v.value}`,
  },
];

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
