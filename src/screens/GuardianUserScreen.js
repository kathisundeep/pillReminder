import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getUserMedicines } from '../utils/guardianCloud';

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function GuardianUserScreen({ route, navigation }) {
  const { userId, username } = route.params || {};
  const [meds, setMeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await getUserMedicines(userId);
    setMeds(list);
    setLoading(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      navigation.setOptions({ title: username ? `@${username}` : 'Medicines' });
      load();
    }, [load, navigation, username])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#00796b" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.note}>
        Read-only view of {username ? `@${username}` : 'this person'}'s medicines.
        You'll be able to request changes (with their approval) next.
      </Text>
      {meds.length === 0 ? (
        <Text style={styles.empty}>No medicines added yet.</Text>
      ) : (
        meds.map((m) => (
          <View key={m.id} style={styles.card}>
            <View style={[styles.dot, { backgroundColor: m.color || '#FFFFFF' }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                {m.name}
                {m.form ? <Text style={styles.form}>  · {m.form}</Text> : null}
              </Text>
              <Text style={styles.times}>
                {(m.times || []).map(formatTime).join('  •  ')}
              </Text>
              <Text style={styles.sub}>
                Snooze {m.snooze_minutes} min · tone {m.tone_id}
              </Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8f6' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 13, color: '#777', lineHeight: 18, marginBottom: 14 },
  empty: { color: '#888', marginTop: 20, textAlign: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 1,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bbb',
    marginRight: 12,
  },
  name: { fontSize: 16, fontWeight: '700', color: '#222' },
  form: { fontSize: 13, fontWeight: '500', color: '#999' },
  times: { fontSize: 14, color: '#555', marginTop: 4 },
  sub: { fontSize: 12, color: '#999', marginTop: 4 },
});
