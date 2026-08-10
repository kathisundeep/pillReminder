import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getPendingRequests, setRequestStatus } from '../utils/guardianCloud';
import { addMedicine } from '../utils/storage';
import { resyncAlarmsFromCloud } from '../utils/sync';
import { formatTime } from '../utils/doseState';
import {
  Screen,
  Content,
  TitleHeader,
  Card,
  CardTitle,
  CardSubtitle,
  Button,
  ButtonRow,
  EmptyState,
} from '../components/ui';
import MedThumb from '../components/MedThumb';
import { colors, radius, formFor } from '../theme';

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
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.emerald600} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TitleHeader
        title="Guardian requests"
        onClose={() => navigation.goBack()}
      />
      <Content>
        {reqs.length === 0 ? (
          <EmptyState
            icon="📭"
            title="No pending requests"
            body="When your guardian proposes a medicine, it will appear here for you to approve."
          />
        ) : (
          reqs.map((r) => {
            const p = r.payload || {};
            return (
              <Card key={r.id}>
                <CardTitle>Guardian wants to add:</CardTitle>
                <CardSubtitle>You decide whether this is added to your schedule.</CardSubtitle>

                <View style={styles.medRow}>
                  <MedThumb med={p} size={56} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.medName}>{p.name}</Text>
                    <Text style={styles.medMeta}>
                      {formFor(p.form).label}
                      {p.snoozeMinutes ? ` • Snooze ${p.snoozeMinutes}m` : ''}
                    </Text>
                    <Text style={styles.medTimes}>
                      {(p.times || []).map(formatTime).join('  •  ')}
                    </Text>
                  </View>
                </View>

                <ButtonRow>
                  <Button
                    title="Reject"
                    variant="neutral"
                    style={{ flex: 1 }}
                    disabled={busyId === r.id}
                    onPress={() => reject(r)}
                  />
                  <Button
                    title={busyId === r.id ? '…' : 'Approve'}
                    style={{ flex: 1 }}
                    disabled={busyId === r.id}
                    onPress={() => approve(r)}
                  />
                </ButtonRow>
              </Card>
            );
          })
        )}
      </Content>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.cardSubtle,
    borderRadius: radius.input,
    padding: 12,
    marginBottom: 14,
  },
  medName: { fontSize: 16, fontWeight: '800', color: colors.heading },
  medMeta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  medTimes: { fontSize: 13, color: colors.body, marginTop: 4, fontWeight: '600' },
});
