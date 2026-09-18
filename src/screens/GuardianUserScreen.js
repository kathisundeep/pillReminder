import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getUserMedicines,
  getUserDayEntries,
  getUserGraceMinutes,
} from '../utils/guardianCloud';
import { buildDay } from '../utils/today';
import { formatTime, slotSummary } from '../utils/doseState';
import { Screen, Content, TitleHeader, EmptyState, Pill } from '../components/ui';
import MedThumb from '../components/MedThumb';
import {
  colors,
  radius,
  shadow,
  formFor,
  periodFor,
  statusStyle,
  SUMMARY_TONE,
} from '../theme';

// What the guardian sees of one person: today's doses grouped by time exactly
// as the person sees them on Home, and the way into their calendar, health
// report and readings.
//
// Read-only on purpose. A guardian never marks a dose taken or skipped — only
// the person can say what they did — so there are no status controls here,
// and RLS refuses a guardian's write to dose_history in any case.
export default function GuardianUserScreen({ route, navigation }) {
  const { userId, username } = route.params || {};
  const [slots, setSlots] = useState([]);
  const [otherDays, setOtherDays] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [meds, entries, grace] = await Promise.all([
      getUserMedicines(userId),
      getUserDayEntries(userId),
      getUserGraceMinutes(userId),
    ]);
    const day = buildDay(meds, entries, new Date(), grace);
    setSlots(day.slots);
    setOtherDays(day.off);
    setCount(meds.length);
    setLoading(false);
  }, [userId]);

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

  const who = username ? `@${username}` : 'This person';
  const params = { userId, username };

  const ACTIONS = [
    { icon: '🗓', label: 'Calendar', go: () => navigation.navigate('Calendar', params) },
    { icon: '📄', label: 'Health report', go: () => navigation.navigate('HealthReport', params) },
    { icon: '🩺', label: 'Add reading', go: () => navigation.navigate('Trackers', params) },
    {
      icon: '💊',
      label: 'Propose',
      go: () =>
        navigation.navigate('AddMedicine', { requestUserId: userId, requestUsername: username }),
    },
  ];

  return (
    <Screen>
      <TitleHeader title={username ? `@${username}` : 'Medicines'} onClose={() => navigation.goBack()} />
      <Content refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View style={styles.actions}>
          {ACTIONS.map((a) => (
            <TouchableOpacity
              key={a.label}
              style={styles.action}
              onPress={a.go}
              accessibilityRole="button"
            >
              <Text style={styles.actionIcon}>{a.icon}</Text>
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Today's doses</Text>
          <Text style={styles.readOnly}>View only</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.teal600} style={{ marginTop: 20 }} />
        ) : count === 0 ? (
          <EmptyState
            icon="💊"
            title="No medicines yet"
            body={`${who} has nothing scheduled. Use "Propose" to suggest a medicine.`}
          />
        ) : slots.length === 0 ? (
          <EmptyState icon="🌙" title="Nothing due today" body={`${who} has no doses scheduled today.`} />
        ) : (
          slots.map((slot) => {
            const summary = slotSummary(slot.items);
            const tone = summary ? SUMMARY_TONE[summary.tone] : null;
            const period = periodFor(slot.time);
            return (
              <View
                key={slot.time}
                style={[styles.slotCard, tone && { borderColor: tone.border }]}
              >
                <View
                  style={[
                    styles.slotHeader,
                    tone && { backgroundColor: tone.bg, borderBottomColor: tone.border },
                  ]}
                >
                  <Text style={styles.slotTime}>{formatTime(slot.time)} Slot</Text>
                  {summary ? (
                    <Pill bg={tone.pill} color={tone.text}>
                      {summary.text}
                    </Pill>
                  ) : (
                    <Pill bg={period.bg} color={period.text}>
                      {period.label}
                    </Pill>
                  )}
                </View>
                {slot.items.map(({ med, state }) => {
                  const st = statusStyle(state);
                  return (
                    <View key={med.id} style={styles.doseRow}>
                      <MedThumb med={med} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.doseName} numberOfLines={1}>
                          {med.name}
                        </Text>
                        <Text style={styles.doseMeta}>
                          {formFor(med.form).label}
                          {med.frequency === 'weekly' ? ' • Weekly' : ' • Daily'}
                        </Text>
                      </View>
                      <Text
                        style={[styles.badge, { backgroundColor: st.bg, color: st.text }]}
                        accessibilityLabel={`Dose status: ${st.label}`}
                      >
                        {st.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            );
          })
        )}

        {otherDays.length > 0 ? (
          <>
            <Text style={styles.otherLabel}>Other days</Text>
            {otherDays.map((med) => (
              <View key={med.id} style={styles.otherRow}>
                <MedThumb med={med} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.doseName}>{med.name}</Text>
                  <Text style={styles.doseMeta}>{med.times.map(formatTime).join('  •  ')}</Text>
                </View>
              </View>
            ))}
          </>
        ) : null}
      </Content>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.soft,
  },
  actionIcon: { fontSize: 20 },
  actionLabel: { fontSize: 11.5, fontWeight: '700', color: colors.teal700 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.heading },
  readOnly: { fontSize: 11.5, fontWeight: '700', color: colors.muted },
  slotCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.soft,
  },
  slotHeader: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: colors.cardSubtle,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  slotTime: { fontSize: 15, fontWeight: '800', color: colors.heading },
  doseRow: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  doseName: { fontSize: 15, fontWeight: '800', color: colors.heading },
  doseMeta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  badge: {
    fontSize: 12.5,
    fontWeight: '800',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    overflow: 'hidden',
  },
  otherLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  otherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
});
