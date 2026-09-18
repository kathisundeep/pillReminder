import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
  AppState,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getMedicines,
  deleteMedicine,
  getSession,
  getDoseEntriesForDay,
  setTakenToday,
  todayKey,
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
import { clearStoredRole, useRole } from '../utils/role';
import { needsOnboarding } from '../utils/profile';
import { doseOutcome, DOSE } from '../utils/adherence';
import {
  formatTime,
  medState,
  isDueToday,
  slotStatus,
  slotSummary,
} from '../utils/doseState';
import {
  Screen,
  ProfileHeader,
  IconButton,
  Banner,
  Pill,
  EmptyState,
} from '../components/ui';
import MedThumb from '../components/MedThumb';
import StatusSelect from '../components/StatusSelect';
import BottomBar from '../components/BottomBar';
import { colors, radius, shadow, periodFor, formFor } from '../theme';

function todayLabel(now) {
  return now.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function HomeScreen({ navigation }) {
  const { setRole } = useRole();
  const [user, setUser] = useState(null);
  const [slots, setSlots] = useState([]); // [{ time, items: [{med, slot, state}] }]
  const [otherDays, setOtherDays] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingName, setPendingName] = useState(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [showDetailsPrompt, setShowDetailsPrompt] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Settled slots start folded; these are the ones the user has opened.
  const [opened, setOpened] = useState(() => new Set());
  // The day on screen. Every write is stamped with the real date, so a Home
  // left open past midnight would show yesterday and record into today.
  const shownDay = useRef(todayKey());

  const load = useCallback(async () => {
    const u = await getSession();
    if (!u) {
      await clearStoredRole();
      setRole(null);
      return;
    }
    setUser(u);
    const list = await getMedicines(u);
    const now = new Date();
    if (todayKey(now) !== shownDay.current) {
      shownDay.current = todayKey(now);
      setOpened(new Set());
    }

    // One query for the whole day rather than one per medicine.
    const entriesByMedicine = await getDoseEntriesForDay(u);
    // How late a dose may run before it counts as missed — the guardian
    // alert's allowance, so Home and the alert agree.
    let grace = 30;
    try {
      grace = Number((await getMyProfile())?.settings?.graceMinutes) || 30;
    } catch (e) {}

    const slotMap = {}; // time -> [{med, slot, state}]
    const off = [];
    for (const med of list) {
      if (!isDueToday(med, now)) {
        off.push(med);
        continue;
      }
      const entries = entriesByMedicine[med.id] || [];
      // Each scheduled time is its own dose, so a morning dose being taken
      // leaves the evening one still pending.
      for (const t of med.times || []) {
        if (!slotMap[t]) slotMap[t] = [];
        let state = medState(med, entries, now, t);
        // A dose left unanswered past its time and grace is missed, not due.
        if (state === 'pending' && doseOutcome(med, entries, t, now, now, grace) === DOSE.MISSED) {
          state = 'missed';
        }
        slotMap[t].push({ med, slot: t, state });
      }
    }
    const sorted = Object.keys(slotMap)
      .sort()
      .map((t) => ({ time: t, items: slotMap[t] }));
    setSlots(sorted);
    setOtherDays(off);

    // Catch up on any missed/skipped doses while the app was closed.
    sweepMissedDoses();

    // A quiet nudge, never a gate: the details step was skippable on purpose.
    try {
      setShowDetailsPrompt(await needsOnboarding());
    } catch (e) {
      setShowDetailsPrompt(false);
    }

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
          setPendingName(null);
        } else {
          setPendingCount(pending.length);
          setPendingName(pending[0]?.payload?.name || null);
        }
      } else {
        setPendingCount(0);
        setPendingName(null);
      }
    } catch (e) {
      setPendingCount(0);
      setPendingName(null);
    }
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Coming back to the app on a new day swaps in the new day's doses.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && todayKey() !== shownDay.current) load();
    });
    return () => sub.remove();
  }, [load]);

  const toggleSlot = (time) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(time)) next.delete(time);
      else next.add(time);
      return next;
    });

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // One dose, one explicit new state. Every branch writes to the same
  // (day, medicine, slot) key.
  const setDoseState = async (med, slot, next) => {
    // Only today's doses can be changed. If the day turned while this screen
    // was open, show the new day instead of writing into it.
    if (todayKey() !== shownDay.current) {
      load();
      return;
    }
    if (next === 'taken') {
      await setTakenToday(user, med.id, true, slot);
      await notifyGuardianTaken(user, med.name);
    } else if (next === 'snoozed') {
      await setTakenToday(user, med.id, false, slot);
      await recordDose(user, med.id, 'snoozed', slot);
      await scheduleSnooze({
        medicineId: med.id,
        medicineName: med.name,
        minutes: med.snoozeMinutes || 10,
        toneId: med.toneId,
        slot,
      });
    } else if (next === 'skipped') {
      await setTakenToday(user, med.id, false, slot);
      await recordDose(user, med.id, 'skipped', slot);
      sweepMissedDoses();
    } else {
      // Back to Due: undo the taken mark for this dose.
      await setTakenToday(user, med.id, false, slot);
    }
    load();
  };

  const applyToSlot = async (items, next) => {
    for (const { med, slot, state } of items) {
      // A dose already taken is never undone by a bulk action — reversing it
      // has to be a deliberate choice on that one dose.
      if (state === 'taken') continue;
      if (state === next) continue;
      // eslint-disable-next-line no-await-in-loop
      await setDoseState(med, slot, next);
    }
  };

  const takeAll = (items) => applyToSlot(items, 'taken');
  const rescheduleAll = (items) => applyToSlot(items, 'snoozed');
  const skipAll = (items) => applyToSlot(items, 'skipped');

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
          // Its alarm may be shared with other medicines at the same time, so
          // re-arm them all rather than leaving it ringing until next launch.
          await resyncAlarmsFromCloud();
          load();
        },
      },
    ]);
  };

  const now = new Date();

  return (
    <Screen>
      <ProfileHeader
        name={user || ''}
        subtitle="Patient View"
        role="patient"
        right={
          <View style={styles.headerActions}>
            <IconButton
              label="♥"
              accessibilityLabel="Guardian"
              onPress={() => navigation.navigate('Guardian')}
            />
            <IconButton
              label="🔔"
              accessibilityLabel="Guardian requests"
              badge={pendingCount > 0}
              onPress={() => navigation.navigate('Approvals')}
            />
          </View>
        }
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {pendingCount > 0 && !bannerDismissed && (
          <Banner
            icon="📩"
            title={`${pendingCount} guardian request${pendingCount > 1 ? 's' : ''} to review`}
            body={
              pendingName
                ? `Your guardian proposed ${pendingName}.`
                : 'Tap to review what your guardian proposed.'
            }
            onPress={() => navigation.navigate('Approvals')}
            onDismiss={() => setBannerDismissed(true)}
          />
        )}

        {showDetailsPrompt && (
          <Banner
            icon="👤"
            title="Finish setting up your profile"
            body="A few details make your health report far more useful."
            onPress={() => navigation.navigate('ProfileDetails')}
            onDismiss={() => setShowDetailsPrompt(false)}
          />
        )}

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Today's Doses</Text>
          <Pill bg={colors.emerald50} color={colors.emerald700}>
            {todayLabel(now)}
          </Pill>
        </View>

        {slots.length === 0 && otherDays.length === 0 && (
          <EmptyState
            icon="💊"
            title="No medicines yet"
            body='Tap "Add" below to set up your first reminder.'
          />
        )}

        {slots.map((slot) => {
          const status = slotStatus(slot.items);
          const period = periodFor(slot.time);
          const summary = slotSummary(slot.items);
          const folded = summary && !opened.has(slot.time);
          const tone = summary ? SUMMARY_TONE[summary.tone] : null;
          const Header = summary ? TouchableOpacity : View;
          return (
            <View
              key={slot.time}
              style={[styles.slotCard, summary && { borderColor: tone.border }]}
            >
              <Header
                style={[
                  styles.slotHeader,
                  summary && { backgroundColor: tone.bg, borderBottomColor: tone.border },
                  folded && styles.slotHeaderFolded,
                ]}
                {...(summary
                  ? {
                      onPress: () => toggleSlot(slot.time),
                      accessibilityRole: 'button',
                      accessibilityState: { expanded: !folded },
                      accessibilityLabel: `${formatTime(slot.time)} slot, ${summary.text}. ${
                        folded ? 'Tap to show doses' : 'Tap to fold'
                      }`,
                    }
                  : {})}
              >
                <View style={styles.slotHeaderText}>
                  <Text style={styles.slotTime}>{formatTime(slot.time)} Slot</Text>
                  {folded ? (
                    <Text style={styles.slotNames} numberOfLines={1}>
                      {slot.items.map((i) => i.med.name).join(', ')}
                    </Text>
                  ) : null}
                </View>
                {summary ? (
                  <View style={styles.summaryRight}>
                    <View style={styles.summaryText}>
                      <Pill bg={tone.pill} color={tone.text}>
                        {summary.text}
                      </Pill>
                      {summary.detail ? (
                        <Text style={[styles.summaryDetail, { color: tone.text }]}>
                          {summary.detail}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.chevron, { color: tone.text }]}>
                      {folded ? '⌄' : '⌃'}
                    </Text>
                  </View>
                ) : (
                  <Pill bg={period.bg} color={period.text}>
                    {period.label}
                  </Pill>
                )}
              </Header>

              {/* Status is set through the dropdown; long-press still opens
                  the edit / delete menu, as it always has. */}
              {folded
                ? null
                : slot.items.map(({ med, slot: at, state }) => (
                    <TouchableOpacity
                      key={med.id}
                      style={styles.doseRow}
                      activeOpacity={0.7}
                      onLongPress={() => onMedLongPress(med)}
                    >
                      <MedThumb med={med} />
                      <View style={styles.doseDetails}>
                        <Text style={styles.doseName} numberOfLines={1}>
                          {med.name}
                        </Text>
                        <Text style={styles.doseMeta}>
                          {formFor(med.form).label}
                          {med.frequency === 'weekly' ? ' • Weekly' : ' • Daily'}
                        </Text>
                      </View>
                      <StatusSelect
                        state={state}
                        onSelect={(next) => setDoseState(med, at, next)}
                      />
                    </TouchableOpacity>
                  ))}

              {status === 'due' && (
                <View style={styles.slotActions}>
                  <TouchableOpacity
                    style={[styles.slotAction, styles.actionTaken]}
                    onPress={() => takeAll(slot.items)}
                  >
                    <Text style={styles.actionTakenText}>✓ Taken</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.slotAction, styles.actionSnooze]}
                    onPress={() => rescheduleAll(slot.items)}
                  >
                    <Text style={styles.actionSnoozeText}>Reschedule</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.slotAction, styles.actionSkip]}
                    onPress={() => skipAll(slot.items)}
                  >
                    <Text style={styles.actionSkipText}>✗ Skip</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        {otherDays.length > 0 && (
          <>
            <Text style={styles.otherLabel}>Other days</Text>
            {otherDays.map((med) => (
              <TouchableOpacity
                key={med.id}
                style={styles.otherRow}
                onPress={() =>
                  navigation.navigate('AddMedicine', { medicineId: med.id })
                }
                onLongPress={() => onMedLongPress(med)}
              >
                <MedThumb med={med} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.doseName}>{med.name}</Text>
                  <Text style={styles.doseMeta}>
                    {med.times.map(formatTime).join('  •  ')}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

      </ScrollView>

      <BottomBar
        active="Home"
        onNavigate={(route) => navigation.navigate(route)}
      />
    </Screen>
  );
}

// Colours of a settled slot, by how it went.
const SUMMARY_TONE = {
  taken: { bg: '#ecfdf5', pill: colors.takenBg, text: colors.takenText, border: '#a7f3d0' },
  partial: { bg: '#fff7ed', pill: '#ffedd5', text: '#c2410c', border: '#fed7aa' },
  skipped: { bg: '#fef2f2', pill: colors.skipBg, text: colors.skipText, border: '#fecaca' },
  snoozed: { bg: '#f0f9ff', pill: colors.snoozeBg, text: colors.snoozeText, border: '#bae6fd' },
};

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: 8 },
  content: { padding: 16, gap: 14, paddingBottom: 28 },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.heading },

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
  slotHeaderFolded: { borderBottomWidth: 0 },
  slotHeaderText: { flex: 1, marginRight: 10 },
  slotNames: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  summaryRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryText: { alignItems: 'flex-end', gap: 2 },
  summaryDetail: { fontSize: 11, fontWeight: '700' },
  chevron: { fontSize: 16, fontWeight: '800', marginTop: -4 },

  doseRow: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  doseDetails: { flex: 1 },
  doseName: { fontSize: 15, fontWeight: '800', color: colors.heading },
  doseMeta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },

  slotActions: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.cardSubtle,
  },
  slotAction: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionTaken: { backgroundColor: colors.emerald600 },
  actionTakenText: { color: colors.white, fontWeight: '800', fontSize: 13 },
  actionSnooze: {
    backgroundColor: colors.snoozeBg,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  actionSnoozeText: { color: colors.snoozeText, fontWeight: '800', fontSize: 13 },
  actionSkip: {
    backgroundColor: colors.skipBg,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  actionSkipText: { color: colors.skipText, fontWeight: '800', fontSize: 13 },

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
