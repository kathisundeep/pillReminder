import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getPendingRequests, setRequestStatus } from '../utils/guardianCloud';
import { addMedicine } from '../utils/storage';
import { resyncAlarmsFromCloud } from '../utils/sync';

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function ApprovalsScreen({ navigation }) {
  const [reqs, setReqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setReqs(await getPendingRequests());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const approve = async (req) => {
    setBusyId(req.id);
    try {
      await addMedicine(null, req.payload); // insert as the patient (owner)
      await setRequestStatus(req.id, 'approved');
      await resyncAlarmsFromCloud(); // schedule the new medicine's alarms
    } catch (e) {
      Alert.alert('Could not approve', String(e?.message || e));
    } finally {
      setBusyId(null);
      load();
    }
  };

  const reject = async (req) => {
    setBusyId(req.id);
    await setRequestStatus(req.id, 'rejected');
    setBusyId(null);
    load();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#4CAF50" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
    >
      {reqs.length === 0 ? (
        <Text style={styles.empty}>No pending requests.</Text>
      ) : (
        reqs.map((r) => {
          const p = r.payload || {};
          return (
            <View key={r.id} style={styles.card}>
              <Text style={styles.title}>Guardian wants to add:</Text>
              <Text style={styles.med}>
                {p.name}
                {p.form ? <Text style={styles.form}>  · {p.form}</Text> : null}
              </Text>
              <Text style={styles.times}>
                {(p.times || []).map(formatTime).join('  •  ')}
              </Text>
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.btn, styles.reject]}
                  disabled={busyId === r.id}
                  onPress={() => reject(r)}
                >
                  <Text style={styles.rejectText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.approve]}
                  disabled={busyId === r.id}
                  onPress={() => approve(r)}
                >
                  <Text style={styles.approveText}>
                    {busyId === r.id ? '…' : 'Approve'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8f6' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#888', textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, elevation: 1 },
  title: { fontSize: 13, color: '#888' },
  med: { fontSize: 18, fontWeight: '700', color: '#222', marginTop: 4 },
  form: { fontSize: 14, fontWeight: '500', color: '#999' },
  times: { fontSize: 14, color: '#555', marginTop: 4 },
  row: { flexDirection: 'row', marginTop: 14 },
  btn: { flex: 1, paddingVertical: 11, borderRadius: 8, alignItems: 'center', marginHorizontal: 4 },
  approve: { backgroundColor: '#4CAF50' },
  approveText: { color: '#fff', fontWeight: '700' },
  reject: { backgroundColor: '#fdecea', borderWidth: 1, borderColor: '#f5c6c0' },
  rejectText: { color: '#e53935', fontWeight: '700' },
});
