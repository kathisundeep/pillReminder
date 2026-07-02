import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// Cloud-backed repository. Auth + medicines + history live in Supabase; the
// exported function signatures are unchanged so screens don't need rewrites.
// Guardian profile / push token / alert dedup stay device-local for now
// (Phase 1 migrates the guardian flow to the cloud).

const KEYS = {
  GUARDIAN: (user) => `@pr_guardian_${user}`,
  ALERTS: (user) => `@pr_alerts_${user}`,
  PUSH_TOKEN: '@pr_push_token',
  MEDS_CACHE: '@pr_meds_cache',   // offline cache of medicines (for alarms)
  NOTIF_IDS: '@pr_notif_ids',     // { [medId]: [notificationId,...] } device-local
};

// ---------------------------------------------------------------------------
// Auth (Supabase). Username+password via a synthetic email so no real inbox is
// needed; the unique email enforces unique usernames.
// ---------------------------------------------------------------------------
const session = { uid: null, username: null };

function synthEmail(username) {
  return `${String(username).trim().toLowerCase()}@pillreminder.app`;
}

function validUsername(username) {
  return /^[a-zA-Z0-9_.]{3,30}$/.test(String(username).trim());
}

export async function registerUser(username, password) {
  const u = String(username).trim();
  if (!validUsername(u))
    return { ok: false, error: '3-30 chars: letters, numbers, _ or . only' };
  const { error } = await supabase.auth.signUp({
    email: synthEmail(u),
    password,
    options: { data: { username: u, is_guardian: false } },
  });
  if (error) {
    const msg = /already|exists|registered/i.test(error.message)
      ? 'User already exists'
      : error.message;
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export async function loginUser(username, password) {
  const u = String(username).trim();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: synthEmail(u),
    password,
  });
  if (error) return { ok: false, error: 'Invalid credentials' };
  session.uid = data.user.id;
  session.username = u;
  return { ok: true };
}

export async function logoutUser() {
  await supabase.auth.signOut();
  session.uid = null;
  session.username = null;
}

// Returns the logged-in username (for display) or null. Reads the locally
// persisted Supabase session — no network round-trip.
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;
  if (!user) {
    session.uid = null;
    session.username = null;
    return null;
  }
  session.uid = user.id;
  session.username = user.user_metadata?.username || null;
  return session.username;
}

async function currentUid() {
  if (session.uid) return session.uid;
  const { data } = await supabase.auth.getSession(); // local read, no network
  const user = data?.session?.user;
  session.uid = user?.id || null;
  if (user) session.username = user.user_metadata?.username || session.username;
  return session.uid;
}

// ---------------------------------------------------------------------------
// Device-local notification IDs (per medicine) — not stored in the cloud.
// ---------------------------------------------------------------------------
async function getNotifMap() {
  const raw = await AsyncStorage.getItem(KEYS.NOTIF_IDS);
  return raw ? JSON.parse(raw) : {};
}
async function setNotifIds(medId, ids) {
  const map = await getNotifMap();
  map[medId] = ids || [];
  await AsyncStorage.setItem(KEYS.NOTIF_IDS, JSON.stringify(map));
}

// ---------------------------------------------------------------------------
// Medicines (Supabase + offline cache)
// ---------------------------------------------------------------------------
function rowToMed(r, notifMap = {}) {
  return {
    id: r.id,
    name: r.name,
    form: r.form,
    color: r.color,
    times: r.times || [],
    snoozeMinutes: r.snooze_minutes,
    frequency: r.frequency,
    daysOfWeek: r.days_of_week || [],
    toneId: r.tone_id,
    alertGuardian: r.alert_guardian,
    notificationIds: notifMap[r.id] || [],
    createdAt: r.created_at,
  };
}

function medToRow(med, uid) {
  const row = {
    user_id: uid,
    name: med.name,
    form: med.form || 'Tablet',
    color: med.color || '#FFFFFF',
    times: med.times || [],
    snooze_minutes: med.snoozeMinutes ?? 10,
    frequency: med.frequency || 'daily',
    days_of_week: med.daysOfWeek || [0, 1, 2, 3, 4, 5, 6],
    tone_id: med.toneId || 'classic',
    alert_guardian: med.alertGuardian !== false,
  };
  // Only include id if it's a real DB uuid (edits); new meds let DB generate it.
  if (med.id && /^[0-9a-f-]{36}$/i.test(med.id)) row.id = med.id;
  return row;
}

export async function getMedicines() {
  try {
    const uid = await currentUid();
    if (!uid) return [];
    const { data, error } = await supabase
      .from('medicines')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const notifMap = await getNotifMap();
    const meds = (data || []).map((r) => rowToMed(r, notifMap));
    await AsyncStorage.setItem(KEYS.MEDS_CACHE, JSON.stringify(meds));
    return meds;
  } catch (e) {
    // Offline / error → fall back to the last cached list (keeps alarms working).
    const raw = await AsyncStorage.getItem(KEYS.MEDS_CACHE);
    return raw ? JSON.parse(raw) : [];
  }
}

export async function addMedicine(user, med) {
  const uid = await currentUid();
  const { data, error } = await supabase
    .from('medicines')
    .insert(medToRow(med, uid))
    .select()
    .single();
  if (error) throw error;
  return data?.id;
}

export async function saveMedicines() {
  // No-op in the cloud model; medicines are persisted individually.
}

export async function deleteMedicine(user, id) {
  const uid = await currentUid();
  await supabase.from('medicines').delete().eq('id', id).eq('user_id', uid);
  const map = await getNotifMap();
  delete map[id];
  await AsyncStorage.setItem(KEYS.NOTIF_IDS, JSON.stringify(map));
}

export async function updateMedicine(user, id, patch) {
  // Notification IDs are device-local; never sent to the cloud.
  if (patch.notificationIds !== undefined) {
    await setNotifIds(id, patch.notificationIds);
    const { notificationIds, ...rest } = patch;
    patch = rest;
    if (Object.keys(patch).length === 0) return;
  }
  const uid = await currentUid();
  const row = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.form !== undefined) row.form = patch.form;
  if (patch.color !== undefined) row.color = patch.color;
  if (patch.times !== undefined) row.times = patch.times;
  if (patch.snoozeMinutes !== undefined) row.snooze_minutes = patch.snoozeMinutes;
  if (patch.frequency !== undefined) row.frequency = patch.frequency;
  if (patch.daysOfWeek !== undefined) row.days_of_week = patch.daysOfWeek;
  if (patch.toneId !== undefined) row.tone_id = patch.toneId;
  if (patch.alertGuardian !== undefined) row.alert_guardian = patch.alertGuardian;
  if (Object.keys(row).length === 0) return;
  await supabase.from('medicines').update(row).eq('id', id).eq('user_id', uid);
}

export async function getMedicine(user, id) {
  const list = await getMedicines();
  return list.find((m) => m.id === id) || null;
}

// One-time import: if this cloud account has no medicines yet, upload any
// medicines left in the old on-device storage (@pr_meds_<username>). Best-effort.
export async function importLocalMedicinesOnce() {
  try {
    const uid = await currentUid();
    if (!uid) return 0;
    const existing = await getMedicines();
    if (existing.length > 0) return 0; // cloud already has data — don't duplicate
    const keys = await AsyncStorage.getAllKeys();
    const medKeys = keys.filter(
      (k) => k.startsWith('@pr_meds_') && k !== KEYS.MEDS_CACHE
    );
    let imported = 0;
    for (const k of medKeys) {
      const raw = await AsyncStorage.getItem(k);
      const list = raw ? JSON.parse(raw) : [];
      for (const med of list) {
        try {
          await addMedicine(null, med);
          imported += 1;
        } catch (e) {}
      }
    }
    return imported;
  } catch (e) {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Dose history (Supabase)
// ---------------------------------------------------------------------------
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export async function recordDose(user, medicineId, status) {
  const uid = await currentUid();
  if (!uid) return;
  await supabase.from('dose_history').insert({
    user_id: uid,
    medicine_id: medicineId,
    day: todayKey(),
    status,
    at: new Date().toISOString(),
  });
}

export async function getDoseEntries(user, medicineId, dateKey) {
  const uid = await currentUid();
  if (!uid) return [];
  const day = dateKey || todayKey();
  const { data, error } = await supabase
    .from('dose_history')
    .select('status, at')
    .eq('user_id', uid)
    .eq('medicine_id', medicineId)
    .eq('day', day)
    .order('at', { ascending: true });
  if (error) return [];
  return data || [];
}

export async function isTakenToday(user, medicineId) {
  const entries = await getDoseEntries(user, medicineId);
  return entries.some((e) => e.status === 'taken');
}

export async function setTakenToday(user, medicineId, taken) {
  const uid = await currentUid();
  if (!uid) return;
  const day = todayKey();
  if (taken) {
    const already = await isTakenToday(user, medicineId);
    if (!already) await recordDose(user, medicineId, 'taken');
  } else {
    await supabase
      .from('dose_history')
      .delete()
      .eq('user_id', uid)
      .eq('medicine_id', medicineId)
      .eq('day', day)
      .eq('status', 'taken');
  }
}

// Delete this user's dose history older than 2 years (client-side fallback for
// the server pg_cron retention job).
export async function pruneOldHistory() {
  try {
    const uid = await currentUid();
    if (!uid) return;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 2);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    await supabase
      .from('dose_history')
      .delete()
      .eq('user_id', uid)
      .lt('day', cutoffKey);
  } catch (e) {}
}

// Assemble a { day: { medId: [{status, at}] } } map (kept for compatibility).
export async function getHistory(user) {
  const uid = await currentUid();
  if (!uid) return {};
  const { data, error } = await supabase
    .from('dose_history')
    .select('medicine_id, day, status, at')
    .eq('user_id', uid);
  if (error) return {};
  const hist = {};
  for (const r of data || []) {
    if (!hist[r.day]) hist[r.day] = {};
    if (!hist[r.day][r.medicine_id]) hist[r.day][r.medicine_id] = [];
    hist[r.day][r.medicine_id].push({ status: r.status, at: r.at });
  }
  return hist;
}

// ---------------------------------------------------------------------------
// Guardian profile / push token / alert dedup — DEVICE-LOCAL (Phase 1 migrates)
// ---------------------------------------------------------------------------
export async function getGuardian(user) {
  const raw = await AsyncStorage.getItem(KEYS.GUARDIAN(user));
  return raw ? JSON.parse(raw) : null;
}

export async function setGuardian(user, guardian) {
  await AsyncStorage.setItem(KEYS.GUARDIAN(user), JSON.stringify(guardian));
}

export async function clearGuardian(user) {
  await AsyncStorage.removeItem(KEYS.GUARDIAN(user));
}

export async function getOwnPushToken() {
  return AsyncStorage.getItem(KEYS.PUSH_TOKEN);
}

export async function setOwnPushToken(token) {
  if (token) await AsyncStorage.setItem(KEYS.PUSH_TOKEN, token);
}

export async function hasAlertedGuardian(user, key, dateKey) {
  const raw = await AsyncStorage.getItem(KEYS.ALERTS(user));
  const map = raw ? JSON.parse(raw) : {};
  const day = dateKey || todayKey();
  return !!map[day]?.[key];
}

export async function markAlertedGuardian(user, key, dateKey) {
  const raw = await AsyncStorage.getItem(KEYS.ALERTS(user));
  const map = raw ? JSON.parse(raw) : {};
  const day = dateKey || todayKey();
  if (!map[day]) map[day] = {};
  map[day][key] = true;
  const days = Object.keys(map).sort();
  while (days.length > 7) delete map[days.shift()];
  await AsyncStorage.setItem(KEYS.ALERTS(user), JSON.stringify(map));
}
