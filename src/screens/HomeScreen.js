import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getMedicines,
  deleteMedicine,
  getSession,
  logoutUser,
  getDoseEntries,
  recordDose,
} from '../utils/storage';
import { cancelManyNotifications, scheduleSnooze } from '../utils/notifications';
import { sweepMissedDoses, notifyGuardianTaken } from '../utils/guardian';

// A dose is "pending action" if its alarm time already passed today and the
// user hasn't taken/skipped it, and isn't currently waiting on a snooze.
function isPendingAction(med, entries, now) {
  const days =
    med.daysOfWeek && med.daysOfWeek.length
      ? med.daysOfWeek
      : [0, 1, 2, 3, 4, 5, 6];
  if (!days.includes(now.getDay())) return false;

  let latestPassed = null;
  for (const t of med.times || []) {
    const [h, m] = t.split(':').map(Number);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d <= now && (!latestPassed || d > latestPassed)) latestPassed = d;
  }
  if (!latestPassed) return false;
  if (entries.some((e) => e.status === 'taken')) return false;
  if (entries.some((e) => e.status === 'skipped')) return false;

  const snoozes = entries
    .filter((e) => e.status === 'snoozed')
    .map((e) => new Date(e.at))
    .sort((a, b) => a - b);
  if (snoozes.length) {
    const snoozeMin = Number(med.snoozeMinutes) || 10;
    const fire = new Date(snoozes[snoozes.length - 1].getTime() + snoozeMin * 60000);
    if (now < fire) return false; // still waiting for the snooze re-alarm
  }
  return true;
}

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
function formatSchedule(med) {
  if (med.frequency === 'weekly' && med.daysOfWeek?.length) {
    if (med.daysOfWeek.length === 7) return 'Every day';
    return med.daysOfWeek.map((d) => DAY_LABELS[d]).join(' ');
  }
  return 'Every day';
}

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [meds, setMeds] = useState([]);
  const [takenMap, setTakenMap] = useState({});
  const [pendingMap, setPendingMap] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const u = await getSession();
    if (!u) {
      navigation.replace('Login');
      return;
    }
    setUser(u);
    const list = await getMedicines(u);
    setMeds(list);
    const now = new Date();
    const tm = {};
    const pm = {};
    for (const m of list) {
      const entries = await getDoseEntries(u, m.id);
      tm[m.id] = entries.some((e) => e.status === 'taken');
      pm[m.id] = isPendingAction(m, entries, now);
    }
    setTakenMap(tm);
    setPendingMap(pm);
    // Catch up on any missed doses while the app was closed.
    sweepMissedDoses();
  }, [navigation]);

  const onTaken = async (med) => {
    await recordDose(user, med.id, 'taken');
    await notifyGuardianTaken(user, med.name);
    load();
  };
  const onReschedule = async (med) => {
    await recordDose(user, med.id, 'snoozed');
    await scheduleSnooze({
      medicineId: med.id,
      medicineName: med.name,
      minutes: med.snoozeMinutes || 10,
    });
    load();
  };
  const onSkipDose = async (med) => {
    await recordDose(user, med.id, 'skipped');
    sweepMissedDoses();
    load();
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const onDelete = (med) => {
    Alert.alert('Delete medicine', `Remove "${med.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await cancelManyNotifications(med.notificationIds);
          await deleteMedicine(user, med.id);
          load();
        },
      },
    ]);
  };

  const onLogout = async () => {
    await logoutUser();
    navigation.replace('Login');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.hello}>Hello,</Text>
          <Text style={styles.user}>{user || ''}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.guardianBtn}
            onPress={() => navigation.navigate('Guardian')}
          >
            <Text style={styles.guardianBtnText}>♥ Guardian</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onLogout}>
            <Text style={styles.logout}>Log out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={meds}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No medicines yet.</Text>
            <Text style={styles.emptySub}>
              Tap "+ Add medicine" to start.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const taken = takenMap[item.id];
          const pending = pendingMap[item.id];
          return (
            <TouchableOpacity
              style={[
                styles.card,
                taken && styles.cardTaken,
                pending && styles.cardPending,
              ]}
              onPress={() =>
                navigation.navigate('AddMedicine', { medicineId: item.id })
              }
              onLongPress={() => onDelete(item)}
            >
              <View style={styles.cardTop}>
                <View
                  style={[
                    styles.colorDot,
                    { backgroundColor: item.color || '#FFFFFF' },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.medName}>{item.name}</Text>
                  <Text style={styles.medMeta}>
                    {item.times.map(formatTime).join('  •  ')}
                  </Text>
                  <Text style={styles.medSub}>
                    {formatSchedule(item)} · Snooze {item.snoozeMinutes} min
                  </Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    taken
                      ? styles.badgeOk
                      : pending
                      ? styles.badgeDue
                      : styles.badgePending,
                  ]}
                >
                  <Text style={styles.badgeText}>
                    {taken ? 'Taken' : pending ? 'Due now' : 'Pending'}
                  </Text>
                </View>
              </View>

              {pending && (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionTaken]}
                    onPress={() => onTaken(item)}
                  >
                    <Text style={styles.actionTakenText}>✓ Taken</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionSnooze]}
                    onPress={() => onReschedule(item)}
                  >
                    <Text style={styles.actionSnoozeText}>
                      Reschedule {item.snoozeMinutes || 10}m
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionSkip]}
                    onPress={() => onSkipDose(item)}
                  >
                    <Text style={styles.actionSkipText}>✗ Skip</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('AddMedicine')}
      >
        <Text style={styles.fabText}>+ Add medicine</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8f6' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    padding: 20,
    paddingTop: 24,
    backgroundColor: '#4CAF50',
  },
  hello: { color: '#e8f5e9', fontSize: 14 },
  user: { color: '#fff', fontSize: 22, fontWeight: '700' },
  headerActions: { alignItems: 'flex-end' },
  guardianBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginBottom: 8,
  },
  guardianBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  logout: { color: '#fff', textDecorationLine: 'underline' },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardTaken: { backgroundColor: '#e8f5e9' },
  cardPending: { borderWidth: 1.5, borderColor: '#ff9800' },
  colorDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#bbb',
    marginRight: 12,
  },
  medName: { fontSize: 18, fontWeight: '700', color: '#222' },
  medMeta: { fontSize: 14, color: '#555', marginTop: 4 },
  medSub: { fontSize: 12, color: '#888', marginTop: 4 },
  badge: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
  badgeOk: { backgroundColor: '#4CAF50' },
  badgePending: { backgroundColor: '#ffb74d' },
  badgeDue: { backgroundColor: '#fb8c00' },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  actionRow: {
    flexDirection: 'row',
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 12,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  actionTaken: { backgroundColor: '#4CAF50' },
  actionTakenText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  actionSnooze: { backgroundColor: '#eceff1', borderWidth: 1, borderColor: '#cfd8dc' },
  actionSnoozeText: { color: '#455a64', fontWeight: '700', fontSize: 13 },
  actionSkip: { backgroundColor: '#fdecea', borderWidth: 1, borderColor: '#f5c6c0' },
  actionSkipText: { color: '#e53935', fontWeight: '700', fontSize: 13 },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { fontSize: 18, color: '#555' },
  emptySub: { color: '#888', marginTop: 6 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 999,
    elevation: 3,
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
