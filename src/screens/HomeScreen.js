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
  isTakenToday,
} from '../utils/storage';
import { cancelManyNotifications } from '../utils/notifications';

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [meds, setMeds] = useState([]);
  const [takenMap, setTakenMap] = useState({});
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
    const tm = {};
    for (const m of list) tm[m.id] = await isTakenToday(u, m.id);
    setTakenMap(tm);
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
        <TouchableOpacity onPress={onLogout}>
          <Text style={styles.logout}>Log out</Text>
        </TouchableOpacity>
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
          return (
            <TouchableOpacity
              style={[styles.card, taken && styles.cardTaken]}
              onLongPress={() => onDelete(item)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.medName}>{item.name}</Text>
                <Text style={styles.medMeta}>
                  {item.times.map(formatTime).join('  •  ')}
                </Text>
                <Text style={styles.medSub}>
                  Snooze: {item.snoozeMinutes} min
                </Text>
              </View>
              <View
                style={[styles.badge, taken ? styles.badgeOk : styles.badgePending]}
              >
                <Text style={styles.badgeText}>
                  {taken ? 'Taken' : 'Pending'}
                </Text>
              </View>
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
  logout: { color: '#fff', textDecorationLine: 'underline' },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  cardTaken: { backgroundColor: '#e8f5e9' },
  medName: { fontSize: 18, fontWeight: '700', color: '#222' },
  medMeta: { fontSize: 14, color: '#555', marginTop: 4 },
  medSub: { fontSize: 12, color: '#888', marginTop: 4 },
  badge: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
  badgeOk: { backgroundColor: '#4CAF50' },
  badgePending: { backgroundColor: '#ffb74d' },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 12 },
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
