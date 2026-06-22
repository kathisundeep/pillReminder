import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  USERS: '@pr_users',
  SESSION: '@pr_session',
  MEDICINES: (user) => `@pr_meds_${user}`,
  HISTORY: (user) => `@pr_history_${user}`,
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
