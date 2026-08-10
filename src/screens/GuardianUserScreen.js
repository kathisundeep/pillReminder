import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getUserMedicines } from '../utils/guardianCloud';
import { formatTime } from '../utils/doseState';
import {
  Screen,
  Content,
  TitleHeader,
  Card,
  Button,
  EmptyState,
  Pill,
} from '../components/ui';
import MedThumb from '../components/MedThumb';
import { colors, radius, shadow, formFor, periodFor } from '../theme';

// A guardian sees the patient's regimen read-only. Every change has to go
// through a request the patient approves, so nothing here is editable.
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
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal600} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TitleHeader
        title={username ? `@${username}` : 'Medicines'}
        onClose={() => navigation.goBack()}
      />
      <Content
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Card>
          <Text style={styles.note}>
            {username ? `@${username}` : 'This person'}'s current regimen. You can
            propose a new medicine — it goes to them for approval.
          </Text>
          <View style={{ gap: 8 }}>
            <Button
              title="➕  Propose a medicine"
              role="guardian"
              onPress={() =>
                navigation.navigate('AddMedicine', {
                  requestUserId: userId,
                  requestUsername: username,
                })
              }
            />
            <Button
              title="📄  View health report"
              variant="neutral"
              onPress={() =>
                navigation.navigate('HealthReport', { userId, username })
              }
            />
          </View>
        </Card>

        {meds.length === 0 ? (
          <EmptyState
            icon="💊"
            title="No medicines yet"
            body="Nothing has been added to this person's schedule."
          />
        ) : (
          meds.map((m) => {
            const times = m.times || [];
            const period = periodFor(times[0]);
            return (
              <View key={m.id} style={styles.medCard}>
                <MedThumb
                  med={{ ...m, snoozeMinutes: m.snooze_minutes }}
                  size={48}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{m.name}</Text>
                  <Text style={styles.meta}>
                    {formFor(m.form).label} • Snooze {m.snooze_minutes} min
                  </Text>
                  <Text style={styles.times}>
                    {times.map(formatTime).join('  •  ')}
                  </Text>
                </View>
                {period.label ? (
                  <Pill bg={period.bg} color={period.text}>
                    {period.label}
                  </Pill>
                ) : null}
              </View>
            );
          })
        )}
      </Content>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: 14 },
  medCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    ...shadow.soft,
  },
  name: { fontSize: 15.5, fontWeight: '800', color: colors.heading },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  times: { fontSize: 13, color: colors.body, marginTop: 4, fontWeight: '600' },
});
