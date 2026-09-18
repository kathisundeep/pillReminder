import { supabase, localUser } from './supabase';
import { addReading } from './health';

// The user's own details: who they are, not what they take.
//
// Two deliberate absences:
//
//   * There is no `age`. An age is wrong within a year and carries no record of
//     when it was true, so date of birth is stored and age is derived.
//   * There is no `weight`. Weight already lives in health_readings with a full
//     history and trend; a second copy here would disagree with it within a
//     month. A weight given at signup seeds the first reading instead.

export const GENDERS = [
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
  { id: 'other', label: 'Other' },
  { id: 'undisclosed', label: 'Prefer not to say' },
];

// Fields the user may change after registration. Everything else on the
// profile row is pinned by the guard_profile_columns trigger.
export const EDITABLE_FIELDS = [
  'full_name',
  'gender',
  'date_of_birth',
  'height_cm',
  'country',
];

export function ageFrom(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export function heightError(raw) {
  if (raw === '' || raw === null || raw === undefined) return null; // optional
  const n = Number(raw);
  if (Number.isNaN(n)) return 'Enter your height in centimetres.';
  if (n <= 30 || n >= 280) return 'That height looks wrong. Enter it in centimetres.';
  return null;
}

export function dateOfBirthError(raw) {
  if (!raw) return null; // optional
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return 'Enter a date as YYYY-MM-DD.';
  if (d > new Date()) return 'A date of birth cannot be in the future.';
  if (d < new Date('1900-01-01')) return 'That date looks wrong.';
  return null;
}

export async function getMyDetails() {
  const { data: u } = await localUser();
  if (!u?.user) return null;
  const { data } = await supabase
    .from('profiles')
    .select(
      'id, username, is_guardian, phone, full_name, gender, date_of_birth, height_cm, country, onboarded_at'
    )
    .eq('id', u.user.id)
    .maybeSingle();
  if (!data) return null;
  return { ...data, age: ageFrom(data.date_of_birth) };
}

// Has the user been through the details step — by completing OR skipping it?
export async function needsOnboarding() {
  const details = await getMyDetails();
  if (!details) return false; // signed out: nothing to ask
  return !details.onboarded_at;
}

export async function updateMyDetails(patch) {
  const { data: u } = await localUser();
  if (!u?.user) return { ok: false, error: 'not signed in' };

  const heightProblem = heightError(patch.height_cm);
  if (heightProblem) return { ok: false, error: heightProblem };
  const dobProblem = dateOfBirthError(patch.date_of_birth);
  if (dobProblem) return { ok: false, error: dobProblem };

  // Only ever send the editable columns. The trigger would reject the rest
  // anyway; not sending them keeps the intent obvious at the call site.
  const row = {};
  for (const field of EDITABLE_FIELDS) {
    if (patch[field] === undefined) continue;
    row[field] =
      field === 'height_cm'
        ? patch.height_cm === '' || patch.height_cm === null
          ? null
          : Number(patch.height_cm)
        : patch[field] || null;
  }
  if (Object.keys(row).length === 0) return { ok: true };

  const { error } = await supabase
    .from('profiles')
    .update(row)
    .eq('id', u.user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Completing or skipping both count: the point is never to ask twice.
export async function markOnboarded() {
  const { data: u } = await localUser();
  if (!u?.user) return { ok: false };
  const { error } = await supabase
    .from('profiles')
    .update({ onboarded_at: new Date().toISOString() })
    .eq('id', u.user.id);
  return { ok: !error };
}

// Save the details step. A weight given here becomes the first tracker
// reading rather than a second, competing copy on the profile.
export async function completeOnboarding({ weightKg, ...details } = {}) {
  const saved = await updateMyDetails(details);
  if (!saved.ok) return saved;

  const weight = Number(weightKg);
  if (weightKg !== undefined && weightKg !== '' && !Number.isNaN(weight)) {
    if (weight <= 0 || weight > 500) {
      return { ok: false, error: 'That weight looks wrong. Enter it in kilograms.' };
    }
    try {
      await addReading('weight', { value: weight });
    } catch (e) {
      // The details are already saved; a failed seed reading is not worth
      // losing them over. The user can add it in Trackers.
    }
  }

  await markOnboarded();
  return { ok: true };
}

export async function skipOnboarding() {
  return markOnboarded();
}
