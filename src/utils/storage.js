import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  USERS: '@pr_users',
  SESSION: '@pr_session',
  MEDICINES: (user) => `@pr_meds_${user}`,
  HISTORY: (user) => `@pr_history_${user}`,
  GUARDIAN: (user) => `@pr_guardian_${user}`,
  ALERTS: (user) => `@pr_alerts_${user}`,
  PUSH_TOKEN: '@pr_push_token',
};

export async function registerUser(username, password) {
  const raw = await AsyncStorage.getItem(KEYS.USERS);
  const users = raw ? JSON.parse(raw) : {};
  if (users[username]) return { ok: false, error: 'User already exists' };
  users[username] = password;
  await AsyncStorage.setItem(KEYS.USERS, JSON.stringify(users));
  return { ok: true };
}

export async function loginUser(username, password) {
  const raw = await AsyncStorage.getItem(KEYS.USERS);
  const users = raw ? JSON.parse(raw) : {};
  if (users[username] !== password) return { ok: false, error: 'Invalid credentials' };
  await AsyncStorage.setItem(KEYS.SESSION, username);
  return { ok: true };
}

export async function logoutUser() {
  await AsyncStorage.removeItem(KEYS.SESSION);
}

export async function getSession() {
  return AsyncStorage.getItem(KEYS.SESSION);
}

export async function getMedicines(user) {
  const raw = await AsyncStorage.getItem(KEYS.MEDICINES(user));
  return raw ? JSON.parse(raw) : [];
}

export async function saveMedicines(user, list) {
  await AsyncStorage.setItem(KEYS.MEDICINES(user), JSON.stringify(list));
}

export async function addMedicine(user, med) {
  const list = await getMedicines(user);
  list.push(med);
  await saveMedicines(user, list);
}

export async function deleteMedicine(user, id) {
  const list = await getMedicines(user);
  await saveMedicines(user, list.filter((m) => m.id !== id));
}

export async function updateMedicine(user, id, patch) {
  const list = await getMedicines(user);
  const next = list.map((m) => (m.id === id ? { ...m, ...patch } : m));
  await saveMedicines(user, next);
}

export async function getMedicine(user, id) {
  const list = await getMedicines(user);
  return list.find((m) => m.id === id) || null;
}

export async function getHistory(user) {
  const raw = await AsyncStorage.getItem(KEYS.HISTORY(user));
  return raw ? JSON.parse(raw) : {};
}

export async function recordDose(user, medicineId, status) {
  const history = await getHistory(user);
  const today = new Date().toISOString().slice(0, 10);
  if (!history[today]) history[today] = {};
  if (!history[today][medicineId]) history[today][medicineId] = [];
  history[today][medicineId].push({
    status,
    at: new Date().toISOString(),
  });
  await AsyncStorage.setItem(KEYS.HISTORY(user), JSON.stringify(history));
}

export async function isTakenToday(user, medicineId) {
  const history = await getHistory(user);
  const today = new Date().toISOString().slice(0, 10);
  const entries = history[today]?.[medicineId] || [];
  return entries.some((e) => e.status === 'taken');
}

// Toggle a medicine's "taken" state for today (used by the grouped Home UI).
export async function setTakenToday(user, medicineId, taken) {
  const history = await getHistory(user);
  const today = new Date().toISOString().slice(0, 10);
  if (!history[today]) history[today] = {};
  const entries = history[today][medicineId] || [];
  const hasTaken = entries.some((e) => e.status === 'taken');
  if (taken) {
    history[today][medicineId] = hasTaken
      ? entries
      : [...entries, { status: 'taken', at: new Date().toISOString() }];
  } else {
    history[today][medicineId] = entries.filter((e) => e.status !== 'taken');
  }
  await AsyncStorage.setItem(KEYS.HISTORY(user), JSON.stringify(history));
}

// All dose log entries for a medicine on a given day (default: today).
export async function getDoseEntries(user, medicineId, dateKey) {
  const history = await getHistory(user);
  const day = dateKey || new Date().toISOString().slice(0, 10);
  return history[day]?.[medicineId] || [];
}

// ---- Guardian profile ----
// Shape: { name, pushToken, graceMinutes, enabled }
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

// ---- This device's own Expo push token (so it can be a guardian) ----
export async function getOwnPushToken() {
  return AsyncStorage.getItem(KEYS.PUSH_TOKEN);
}

export async function setOwnPushToken(token) {
  if (token) await AsyncStorage.setItem(KEYS.PUSH_TOKEN, token);
}

// ---- Per-day dedup so a guardian is alerted at most once per dose ----
export async function hasAlertedGuardian(user, key, dateKey) {
  const raw = await AsyncStorage.getItem(KEYS.ALERTS(user));
  const map = raw ? JSON.parse(raw) : {};
  const day = dateKey || new Date().toISOString().slice(0, 10);
  return !!map[day]?.[key];
}

export async function markAlertedGuardian(user, key, dateKey) {
  const raw = await AsyncStorage.getItem(KEYS.ALERTS(user));
  const map = raw ? JSON.parse(raw) : {};
  const day = dateKey || new Date().toISOString().slice(0, 10);
  if (!map[day]) map[day] = {};
  map[day][key] = true;
  // Keep only the last few days to avoid unbounded growth.
  const days = Object.keys(map).sort();
  while (days.length > 7) delete map[days.shift()];
  await AsyncStorage.setItem(KEYS.ALERTS(user), JSON.stringify(map));
}
