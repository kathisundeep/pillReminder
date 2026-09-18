import { supabase, localUser } from './supabase';

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

// User's device reads its active guardian's push token (RLS lets the user read
// the linked guardian's profile). Returns { token, settings } or null.
export async function getActiveGuardianTarget() {
  const { data: u } = await localUser();
  if (!u?.user) return null;
  const { data: link } = await supabase
    .from('guardian_links')
    .select('guardian_id')
    .eq('user_id', u.user.id) // never match a link where WE are the guardian
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (!link) return null;
  const { data: gprof } = await supabase
    .from('profiles')
    .select('push_token, username')
    .eq('id', link.guardian_id)
    .maybeSingle();
  return gprof?.push_token ? { token: gprof.push_token, username: gprof.username } : null;
}

// ---- Guardian reading a linked user's data ----
export async function getUserMedicines(userId) {
  const { data } = await supabase
    .from('medicines')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  return data || [];
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
