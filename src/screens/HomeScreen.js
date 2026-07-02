import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
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
  setTakenToday,
  recordDose,
  addMedicine,
} from '../utils/storage';
import { scheduleSnooze } from '../utils/notifications';
import { sweepMissedDoses, notifyGuardianTaken } from '../utils/guardian';
import {
  getPendingRequests,
  setRequestStatus,
  getMyProfile,
} from '../utils/guardianCloud';
import { resyncAlarmsFromCloud } from '../utils/sync';

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Per-medicine state for today given its dose log entries.
function medState(med, entries, now) {
  if (entries.some((e) => e.status === 'taken')) return 'taken';
  if (entries.some((e) => e.status === 'skipped')) return 'skipped';

  let latestPassed = null;
  for (const t of med.times || []) {
    const [h, m] = t.split(':').map(Number);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d <= now && (!latestPassed || d > latestPassed)) latestPassed = d;
  }
  const snoozes = entries
    .filter((e) => e.status === 'snoozed')
    .map((e) => new Date(e.at))
    .sort((a, b) => a - b);
  if (snoozes.length) {
    const snoozeMin = Number(med.snoozeMinutes) || 10;
    const fire = new Date(snoozes[snoozes.length - 1].getTime() + snoozeMin * 60000);
    if (now < fire) return 'snoozed';
  }
  return latestPassed ? 'pending' : 'upcoming';
}

function isDueToday(med, now) {
  const days =
    med.daysOfWeek && med.daysOfWeek.length
      ? med.daysOfWeek
      : [0, 1, 2, 3, 4, 5, 6];
  return days.includes(now.getDay());
}

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [slots, setSlots] = useState([]); // [{ time, items: [{med, state}] }]
  const [otherDays, setOtherDays] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const u = await getSession();
    if (!u) {
      navigation.replace('Login');
      return;
    }
    setUser(u);
    const list = await getMedicines(u);
    const now = new Date();

    const slotMap = {}; // time -> [{med, state}]
    const off = [];
    for (const med of list) {
      const entries = await getDoseEntries(u, med.id);
      if (!isDueToday(med, now)) {
        off.push(med);
        continue;
      }
      const state = medState(med, entries, now);
      for (const t of med.times || []) {
        if (!slotMap[t]) slotMap[t] = [];
        slotMap[t].push({ med, state });
      }
    }
    const sorted = Object.keys(slotMap)
      .sort()
      .map((t) => ({ time: t, items: slotMap[t] }));
    setSlots(sorted);
    setOtherDays(off);

    // Catch up on any missed/skipped doses while the app was closed.
    sweepMissedDoses();

    // Guardian add-medicine requests. If the user turned approval off, apply
    // them automatically; otherwise surface a badge to review them.
    try {
      const pending = await getPendingRequests();
      if (pending.length > 0) {
        const profile = await getMyProfile();
        const approvalRequired = profile?.settings?.approvalRequired !== false;
        if (!approvalRequired) {
          for (const r of pending) {
            try {
              await addMedicine(null, r.payload);
              await setRequestStatus(r.id, 'approved');
            } catch (e) {}
          }
          await resyncAlarmsFromCloud();
          setPendingCount(0);
        } else {
          setPendingCount(pending.length);
        }
      } else {
        setPendingCount(0);
      }
    } catch (e) {
      setPendingCount(0);
    }
  }, [navigation]);

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

  const toggleTaken = async (med, currentlyTaken) => {
    await setTakenToday(user, med.id, !currentlyTaken);
    if (!currentlyTaken) await notifyGuardianTaken(user, med.name);
    load();
  };

  const takeAll = async (items) => {
    for (const { med, state } of items) {
      if (state !== 'taken') {
        await setTakenToday(user, med.id, true);
        await notifyGuardianTaken(user, med.name);
      }
    }
    load();
  };

  const rescheduleAll = async (items) => {
    for (const { med, state } of items) {
      if (state === 'taken') continue;
      await recordDose(user, med.id, 'snoozed');
      await scheduleSnooze({
        medicineId: med.id,
        medicineName: med.name,
        minutes: med.snoozeMinutes || 10,
      });
    }
    load();
  };

  const skipAll = async (items) => {
    for (const { med, state } of items) {
      if (state === 'taken') continue;
      await recordDose(user, med.id, 'skipped');
    }
    sweepMissedDoses();
    load();
  };

  const onMedLongPress = (med) => {
    Alert.alert(med.name, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Edit',
        onPress: () =>
          navigation.navigate('AddMedicine', { medicineId: med.id }),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
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

  const slotStatus = (items) => {
    if (items.every((i) => i.state === 'taken')) return 'done';
    if (items.some((i) => i.state === 'pending')) return 'due';
    return 'upcoming';
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

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.quickRow}>
          <TouchableOpacity
            style={styles.quickBtn}
            onPress={() => navigation.navigate('Trackers')}
          >
            <Text style={styles.quickText}>📊 Trackers</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickBtn}
            onPress={() => navigation.navigate('HealthReport')}
          >
            <Text style={styles.quickText}>📄 Report</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickBtn}
            onPress={() => navigation.navigate('Plans')}
          >
            <Text style={styles.quickText}>⭐ Plans</Text>
          </TouchableOpacity>
        </View>

        {pendingCount > 0 && (
          <TouchableOpacity
            style={styles.approvalBanner}
            onPress={() => navigation.navigate('Approvals')}
          >
            <Text style={styles.approvalText}>
              {pendingCount} guardian request{pendingCount > 1 ? 's' : ''} to review
            </Text>
            <Text style={styles.approvalChevron}>›</Text>
          </TouchableOpacity>
        )}

        {slots.length === 0 && otherDays.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No medicines yet.</Text>
            <Text style={styles.emptySub}>Tap "+ Add medicine" to start.</Text>
          </View>
        )}

        {slots.map((slot) => {
          const status = slotStatus(slot.items);
          return (
            <View
              key={slot.time}
              style={[
                styles.card,
                status === 'done' && styles.cardDone,
                status === 'due' && styles.cardDue,
              ]}
            >
              <View style={styles.slotHead}>
                <Text style={styles.slotTime}>{formatTime(slot.time)}</Text>
                <View
                  style={[
                    styles.badge,
                    status === 'done'
                      ? styles.badgeOk
                      : status === 'due'
                      ? styles.badgeDue
                      : styles.badgePending,
                  ]}
                >
                  <Text style={styles.badgeText}>
                    {status === 'done'
                      ? 'Taken'
                      : status === 'due'
                      ? 'Due now'
                      : 'Upcoming'}
                  </Text>
                </View>
              </View>

              {slot.items.map(({ med, state }) => {
                const taken = state === 'taken';
                return (
                  <TouchableOpacity
                    key={med.id}
                    style={styles.medRow}
                    onPress={() => toggleTaken(med, taken)}
                    onLongPress={() => onMedLongPress(med)}
                  >
                    <View
                      style={[
                        styles.check,
                        taken && styles.checkOn,
                      ]}
                    >
                      {taken && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                    <View
                      style={[
                        styles.colorDot,
                        { backgroundColor: med.color || '#FFFFFF' },
                      ]}
                    />
                    <Text
                      style={[styles.medName, taken && styles.medNameTaken]}
                    >
                      {med.name}
                      {med.form ? (
                        <Text style={styles.medForm}>  · {med.form}</Text>
                      ) : null}
                    </Text>
                    {state === 'skipped' && (
                      <Text style={styles.tagSkip}>Skipped</Text>
                    )}
                    {state === 'snoozed' && (
                      <Text style={styles.tagSnooze}>Snoozed</Text>
                    )}
                  </TouchableOpacity>
                );
              })}

              {status === 'due' && (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionTaken]}
                    onPress={() => takeAll(slot.items)}
                  >
                    <Text style={styles.actionTakenText}>✓ Taken</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionSnooze]}
                    onPress={() => rescheduleAll(slot.items)}
                  >
                    <Text style={styles.actionSnoozeText}>Reschedule</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionSkip]}
                    onPress={() => skipAll(slot.items)}
                  >
                    <Text style={styles.actionSkipText}>✗ Skip</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={styles.slotHint}>
                Tap a medicine to mark it individually · long-press to edit
              </Text>
            </View>
          );
        })}

        {otherDays.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Other days</Text>
            {otherDays.map((med) => (
              <TouchableOpacity
                key={med.id}
                style={styles.otherRow}
                onPress={() =>
                  navigation.navigate('AddMedicine', { medicineId: med.id })
                }
                onLongPress={() => onMedLongPress(med)}
              >
                <View
                  style={[
                    styles.colorDot,
                    { backgroundColor: med.color || '#FFFFFF' },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.medName}>{med.name}</Text>
                  <Text style={styles.medSub}>
                    {med.times.map(formatTime).join('  •  ')}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>

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
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  cardDone: { backgroundColor: '#e8f5e9' },
  cardDue: { borderWidth: 1.5, borderColor: '#fb8c00' },
  slotHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  slotTime: { fontSize: 20, fontWeight: '800', color: '#222' },
  badge: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
  badgeOk: { backgroundColor: '#4CAF50' },
  badgePending: { backgroundColor: '#ffb74d' },
  badgeDue: { backgroundColor: '#fb8c00' },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#bbb',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkOn: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  checkMark: { color: '#fff', fontWeight: '800', fontSize: 14 },
  colorDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bbb',
    marginRight: 10,
  },
  medName: { fontSize: 16, fontWeight: '600', color: '#222', flexShrink: 1 },
  medForm: { fontSize: 13, fontWeight: '500', color: '#999' },
  medNameTaken: {
    color: '#8aa08c',
    textDecorationLine: 'line-through',
  },
  medSub: { fontSize: 12, color: '#888', marginTop: 3 },
  tagSkip: {
    marginLeft: 'auto',
    color: '#e53935',
    fontWeight: '700',
    fontSize: 12,
  },
  tagSnooze: {
    marginLeft: 'auto',
    color: '#8e24aa',
    fontWeight: '700',
    fontSize: 12,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 12,
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
  actionSnooze: {
    backgroundColor: '#eceff1',
    borderWidth: 1,
    borderColor: '#cfd8dc',
  },
  actionSnoozeText: { color: '#455a64', fontWeight: '700', fontSize: 13 },
  actionSkip: {
    backgroundColor: '#fdecea',
    borderWidth: 1,
    borderColor: '#f5c6c0',
  },
  actionSkipText: { color: '#e53935', fontWeight: '700', fontSize: 13 },
  slotHint: { fontSize: 11, color: '#aaa', marginTop: 10 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 8,
  },
  otherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    opacity: 0.85,
  },
  quickRow: { flexDirection: 'row', marginBottom: 12 },
  quickBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginHorizontal: 4,
    elevation: 1,
  },
  quickText: { color: '#333', fontWeight: '700', fontSize: 13 },
  approvalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3e0',
    borderWidth: 1,
    borderColor: '#ffb74d',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  approvalText: { flex: 1, color: '#e65100', fontWeight: '700' },
  approvalChevron: { color: '#e65100', fontSize: 22 },
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
