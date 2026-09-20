import { supabase, localUser } from './supabase';
import { rowToMed, todayKey } from './storage';

// Phase 1 guardian pairing — thin wrappers over the Postgres RPC functions in
// supabase/pairing.sql. RLS + security-definer functions enforce all rules.

// User: create a fresh 6-digit code to hand to a guardian (shown once).
export async function generatePairingCode() {
  const { data, error } = await supabase.rpc('generate_pairing_code');
  if (error) throw error;
  return data; // '048213'
}

// Guardian: consume a user's username + code to link. { ok, user?, error? }
export async function pairWithCode(username, code) {
  const { data, error } = await supabase.rpc('pair_with_code', {
    target_username: String(username).trim(),
    code: String(code).trim(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, user: data };
}

// User: drop the current guardian and invalidate outstanding codes.
export async function revokeGuardian() {
  const { error } = await supabase.rpc('revoke_guardian');
  if (error) throw error;
}

// User: their currently-active guardian link (or null).
//
// The user_id filter is load-bearing. RLS on guardian_links returns rows where
// the caller is EITHER the patient or the guardian, so without it an account
// that also guards someone else matches the wrong row and reports itself as its
// own guardian.
export async function getMyActiveGuardian() {
  const { data: u } = await localUser();
  if (!u?.user) return null;
  const { data, error } = await supabase
    .from('guardian_links')
    .select('guardian_id, status, created_at')
    .eq('user_id', u.user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  const { data: prof } = await supabase
    .from('profiles')
    .select('username, display_name')
    .eq('id', data.guardian_id)
    .maybeSingle();
  return { ...data, guardianUsername: prof?.username, guardianName: prof?.display_name };
}

// ---- Profile settings (grace / notifyMode / approvalRequired) ----
export async function getMyProfile() {
  const { data: u } = await localUser();
  if (!u?.user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('username, display_name, settings, is_guardian')
    .eq('id', u.user.id)
    .maybeSingle();
  return data;
}

export async function updateMySettings(patch) {
  const { data: u } = await localUser();
  if (!u?.user) return;
  const { data } = await supabase
    .from('profiles')
    .select('settings')
    .eq('id', u.user.id)
    .maybeSingle();
  const settings = { ...(data?.settings || {}), ...patch };
  await supabase.from('profiles').update({ settings }).eq('id', u.user.id);
  return settings;
}

// Store THIS device's Expo push token on the profile so the user's paired
// guardian can be reached for missed-dose alerts.
export async function saveMyPushToken(token) {
  if (!token) return;
  const { data: u } = await localUser();
  if (!u?.user) return;
  await supabase.from('profiles').update({ push_token: token }).eq('id', u.user.id);
}

// User's device reads its guardians' push tokens (RLS lets the user read a
// linked guardian's profile). A plan can allow several guardians, and every
// one of them is alerted. Guardians without a token (not signed in anywhere,
// or signed out by another phone) are skipped.
export async function getActiveGuardianTargets() {
  const guardians = await getMyGuardians();
  if (!guardians.length) return [];
  const { data } = await supabase
    .from('profiles')
    .select('id, push_token, username')
    .in('id', guardians.map((g) => g.guardianId));
  return (data || [])
    .filter((p) => p.push_token)
    .map((p) => ({ token: p.push_token, username: p.username }));
}

// The first of them, for callers that only need to know one exists.
export async function getActiveGuardianTarget() {
  return (await getActiveGuardianTargets())[0] || null;
}

// User: every guardian currently linked to them.
export async function getMyGuardians() {
  const { data: u } = await localUser();
  if (!u?.user) return [];
  const { data: links } = await supabase
    .from('guardian_links')
    .select('guardian_id, created_at')
    .eq('user_id', u.user.id) // never match a link where WE are the guardian
    .eq('status', 'active');
  if (!links?.length) return [];
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('id', links.map((l) => l.guardian_id));
  return links.map((l) => {
    const p = (profs || []).find((x) => x.id === l.guardian_id);
    return { guardianId: l.guardian_id, username: p?.username, name: p?.display_name };
  });
}

// User: remove one guardian, leaving any others linked.
export async function removeGuardian(guardianId) {
  const { error } = await supabase.rpc('remove_guardian', { guardian: guardianId });
  if (error) throw error;
}

// User: how many guardians their plan allows, and how many are linked.
export async function getMyGuardianAllowance() {
  const { data: u } = await localUser();
  if (!u?.user) return { limit: 0, used: 0 };
  const [{ data: limit }, guardians] = await Promise.all([
    supabase.rpc('guardian_limit', { target_user: u.user.id }),
    getMyGuardians(),
  ]);
  return { limit: Number(limit) || 0, used: guardians.length };
}

// ---- One phone per guardian account (guardian_session.sql) ----

// At sign-in: this phone takes the guardian account over. Other phones stop
// seeing data and alerts at once, and their logins cannot be renewed.
export async function claimGuardianSession() {
  const { error } = await supabase.rpc('claim_guardian_session');
  if (error) return false;
  try {
    await supabase.auth.signOut({ scope: 'others' });
  } catch (e) {}
  return true;
}

// 'ok', or 'replaced' when another phone has signed in to this guardian
// account since. Anything unexpected (offline, older server) reads as 'ok' —
// the server still refuses a replaced phone's data either way.
export async function checkGuardianSession() {
  try {
    const { data, error } = await supabase.rpc('guardian_session_check');
    if (error) return 'ok';
    return data === 'replaced' ? 'replaced' : 'ok';
  } catch (e) {
    return 'ok';
  }
}

// ---- Guardian reading a linked user's data ----
// Read-only by design: RLS lets a linked guardian SELECT these, never write.

// In the same shape the patient's own screens use (rowToMed), so the Today
// list and the calendar can be drawn by the same code for either.
export async function getUserMedicines(userId, { includeDeleted = false } = {}) {
  let q = supabase
    .from('medicines')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (!includeDeleted) q = q.is('deleted_at', null);
  const { data } = await q;
  return (data || []).map((r) => rowToMed(r));
}

// One day's dose log for a linked user, grouped by medicine id.
export async function getUserDayEntries(userId, day = todayKey()) {
  const { data } = await supabase
    .from('dose_history')
    .select('medicine_id, status, at, slot')
    .eq('user_id', userId)
    .eq('day', day)
    .order('at', { ascending: true });
  const byMedicine = {};
  for (const row of data || []) {
    if (!byMedicine[row.medicine_id]) byMedicine[row.medicine_id] = [];
    byMedicine[row.medicine_id].push(row);
  }
  return byMedicine;
}

// A linked user's whole dose log as { day: { medicineId: [entries] } } —
// the shape the calendar reads.
export async function getUserHistory(userId) {
  const { data } = await supabase
    .from('dose_history')
    .select('medicine_id, day, status, at, slot')
    .eq('user_id', userId);
  const hist = {};
  for (const r of data || []) {
    if (!hist[r.day]) hist[r.day] = {};
    if (!hist[r.day][r.medicine_id]) hist[r.day][r.medicine_id] = [];
    hist[r.day][r.medicine_id].push({ status: r.status, at: r.at, slot: r.slot });
  }
  return hist;
}

// How late the person lets a dose run before it counts as missed. Their
// setting, so the guardian sees exactly what the person sees.
export async function getUserGraceMinutes(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('settings')
    .eq('id', userId)
    .maybeSingle();
  return Number(data?.settings?.graceMinutes) || 30;
}

// ---- Action requests (guardian add-medicine → user approval) ----
export async function createAddMedicineRequest(userId, medPayload) {
  const { data: u } = await localUser();
  const { error } = await supabase.from('action_requests').insert({
    user_id: userId,
    guardian_id: u.user.id,
    kind: 'add_medicine',
    payload: medPayload,
  });
  return { ok: !error, error: error?.message };
}

// Requests awaiting THIS user's approval.
//
// The user_id filter is load-bearing. RLS also lets a guardian read the
// requests they created, so without it a guardian sees their own outgoing
// request as one to approve — and approving it writes the medicine into the
// guardian's own account instead of the patient's.
export async function getPendingRequests() {
  const { data: u } = await localUser();
  if (!u?.user) return [];
  const { data } = await supabase
    .from('action_requests')
    .select('*')
    .eq('user_id', u.user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return data || [];
}

// Requests this guardian has filed, so their own screens can show progress
// without ever being offered as approvable.
export async function getMyOutgoingRequests() {
  const { data: u } = await localUser();
  if (!u?.user) return [];
  const { data } = await supabase
    .from('action_requests')
    .select('*')
    .eq('guardian_id', u.user.id)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function setRequestStatus(id, status) {
  await supabase.from('action_requests').update({ status }).eq('id', id);
}

// Guardian: users this guardian is linked to (with usernames).
export async function getLinkedUsers() {
  const { data: u } = await localUser();
  if (!u?.user) return [];
  const { data, error } = await supabase
    .from('guardian_links')
    .select('user_id, status, created_at')
    .eq('guardian_id', u.user.id) // only links where WE are the guardian
    .eq('status', 'active');
  if (error || !data) return [];
  const out = [];
  for (const link of data) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('username, display_name')
      .eq('id', link.user_id)
      .maybeSingle();
    out.push({ userId: link.user_id, username: prof?.username, name: prof?.display_name });
  }
  return out;
}
