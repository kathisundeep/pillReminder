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
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getMedicines,
  deleteMedicine,
  getSession,
  getDoseEntriesForDay,
  getCachedMedicines,
  getCachedDayEntries,
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
import { buildDay } from '../utils/today';
import { track } from '../utils/telemetry';
import {
  formatTime,
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
import ActionSheet from '../components/ActionSheet';
import SwipeToDelete from '../components/SwipeToDelete';
import StatusSelect from '../components/StatusSelect';
import BottomBar from '../components/BottomBar';
import { colors, radius, shadow, periodFor, formFor, SUMMARY_TONE } from '../theme';

const TIP_KEY = '@pr_tip_home_gestures';

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

  // Press-and-hold menus: { kind: 'slot', slot } or { kind: 'med', med }.
  const [menu, setMenu] = useState(null);
  const [showTip, setShowTip] = useState(false);

  // The last lists drawn, so a status change can be shown at once without
  // waiting for the network.
  const medsRef = useRef([]);
  const entriesRef = useRef({});
  const graceRef = useRef(30);
  // Bumped by every change on screen. A reload that started before it is
  // stale and must not draw over what the user just did.
  const version = useRef(0);

  const draw = useCallback((list, entriesByMedicine) => {
    medsRef.current = list;
    entriesRef.current = entriesByMedicine;
    const { slots: next, off } = buildDay(list, entriesByMedicine, new Date(), graceRef.current);
    setSlots(next);
    setOtherDays(off);
  }, []);

  const load = useCallback(async () => {
    const u = await getSession();
    if (!u) {
      await clearStoredRole();
      setRole(null);
      return;
    }
    setUser(u);
    const mine = ++version.current;
    const now = new Date();
    if (todayKey(now) !== shownDay.current) {
      shownDay.current = todayKey(now);
      setOpened(new Set());
    }

    // 1. What this phone already knows, on screen at once.
    const [cachedMeds, cachedEntries] = await Promise.all([
      getCachedMedicines(),
      getCachedDayEntries(),
    ]);
    if (cachedMeds && mine === version.current) draw(cachedMeds, cachedEntries || {});

    // 2. Fresh copies, fetched side by side rather than one after another.
    const [list, entries, profile] = await Promise.all([
      getMedicines(u),
      getDoseEntriesForDay(u),
      getMyProfile().catch(() => null),
    ]);
    // How late a dose may run before it counts as missed — the guardian
    // alert's allowance, so Home and the alert agree.
    graceRef.current = Number(profile?.settings?.graceMinutes) || 30;
    if (mine === version.current) draw(list, entries);

    // Catch up on any missed/skipped doses while the app was closed.
    sweepMissedDoses();

    // 3. Everything else, which never holds the list up.
    const [onboard, pending, tipSeen] = await Promise.all([
      needsOnboarding().catch(() => false),
      getPendingRequests().catch(() => []),
      AsyncStorage.getItem(TIP_KEY).catch(() => '1'),
    ]);
    // A quiet nudge, never a gate: the details step was skippable on purpose.
    setShowDetailsPrompt(!!onboard);
    setShowTip(!tipSeen);

    // Guardian add-medicine requests. If the user turned approval off, apply
    // them automatically; otherwise surface a badge to review them.
    if (pending.length > 0 && profile?.settings?.approvalRequired === false) {
      for (const r of pending) {
        try {
          await addMedicine(null, r.payload);
          await setRequestStatus(r.id, 'approved');
        } catch (e) {}
      }
      await resyncAlarmsFromCloud();
      setPendingCount(0);
      setPendingName(null);
      load();
    } else {
      setPendingCount(pending.length);
      setPendingName(pending[0]?.payload?.name || null);
    }
  }, [navigation, draw]);

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

  const dismissTip = () => {
    setShowTip(false);
    AsyncStorage.setItem(TIP_KEY, '1').catch(() => {});
  };

  // One dose, one explicit new state, written to the (day, medicine, slot)
  // key. Does not redraw — commit() does that, once, for any number of doses.
  const writeDose = async (med, slot, next) => {
    if (next === 'taken') {
      await setTakenToday(user, med.id, true, slot);
      // The guardian's push is best-effort and never worth waiting for.
      notifyGuardianTaken(user, med.name);
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
  };

  // Shows the change straight away, then saves it and re-reads today's log
  // (one query) to confirm. It used to wait for every save, the guardian push
  // and a full reload before anything moved — several seconds.
  const commit = async (changes) => {
    if (!changes.length) return;
    // Only today's doses can be changed. If the day turned while this screen
    // was open, show the new day instead of writing into it.
    if (todayKey() !== shownDay.current) {
      load();
      return;
    }
    const at = new Date().toISOString();
    const entries = { ...entriesRef.current };
    for (const { med, slot, next } of changes) {
      const kept = (entries[med.id] || []).filter(
        (e) => !(e.slot === slot && e.status === 'taken')
      );
      if (next !== 'pending') kept.push({ status: next, slot, at });
      entries[med.id] = kept;
    }
    const mine = ++version.current;
    draw(medsRef.current, entries);
    track('dose_marked', { status: changes[0].next, count: changes.length });

    try {
      for (const { med, slot, next } of changes) {
        // eslint-disable-next-line no-await-in-loop
        await writeDose(med, slot, next);
      }
    } catch (e) {
      Alert.alert('Could not save', 'Check your internet connection and try again.');
      load();
      return;
    }
    const fresh = await getDoseEntriesForDay(user);
    if (mine === version.current) draw(medsRef.current, fresh);
  };

  const setDoseState = (med, slot, next) => commit([{ med, slot, next }]);

  const applyToSlot = (items, next) =>
    commit(
      items
        // A dose already taken is never undone by a bulk action — reversing
        // it has to be a deliberate choice on that one dose.
        .filter(({ state }) => state !== 'taken' && state !== next)
        .map(({ med, slot }) => ({ med, slot, next }))
    );

  const takeAll = (items) => applyToSlot(items, 'taken');
  const rescheduleAll = (items) => applyToSlot(items, 'snoozed');
  const skipAll = (items) => applyToSlot(items, 'skipped');

  const confirmDelete = (med) => {
    Alert.alert(
      `Delete ${med.name}?`,
      'This stops its alarms. Doses you already recorded stay in your calendar and report.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteMedicine(user, med.id);
            // Its alarm may be shared with other medicines at the same time,
            // so re-arm them all rather than leaving it ringing.
            await resyncAlarmsFromCloud();
            load();
          },
        },
      ]
    );
  };

  const onMedLongPress = (med) => setMenu({ kind: 'med', med });

  const menuProps = !menu
    ? { visible: false }
    : menu.kind === 'med'
    ? {
        visible: true,
        title: menu.med.name,
        options: [
          {
            label: '✏️  Edit',
            onPress: () => navigation.navigate('AddMedicine', { medicineId: menu.med.id }),
          },
          { label: '🗑  Delete', tone: 'danger', onPress: () => confirmDelete(menu.med) },
        ],
      }
    : {
        visible: true,
        title: `${formatTime(menu.slot.time)} slot`,
        subtitle: menu.slot.items.map((i) => i.med.name).join(', '),
        options: [
          { label: '✓  Mark all taken', onPress: () => takeAll(menu.slot.items) },
          { label: '💤  Reschedule all', onPress: () => rescheduleAll(menu.slot.items) },
          { label: '✕  Skip all', tone: 'danger', onPress: () => skipAll(menu.slot.items) },
        ],
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

        {showTip && slots.length > 0 ? (
          <View style={styles.tip}>
            <Text style={styles.tipText}>
              💡 Press and hold a medicine to edit or delete it, or a time slot to
              mark all of it at once. Swipe a medicine left to delete.
            </Text>
            <TouchableOpacity
              onPress={dismissTip}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Dismiss tip"
            >
              <Text style={styles.tipClose}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

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
          return (
            <View
              key={slot.time}
              style={[styles.slotCard, summary && { borderColor: tone.border }]}
            >
              {/* Tap folds / unfolds a settled slot; press and hold offers
                  the slot-wide actions for any slot. */}
              <TouchableOpacity
                activeOpacity={summary ? 0.7 : 1}
                style={[
                  styles.slotHeader,
                  summary && { backgroundColor: tone.bg, borderBottomColor: tone.border },
                  folded && styles.slotHeaderFolded,
                ]}
                onPress={summary ? () => toggleSlot(slot.time) : undefined}
                onLongPress={() => setMenu({ kind: 'slot', slot })}
                accessibilityRole="button"
                accessibilityState={summary ? { expanded: !folded } : undefined}
                accessibilityLabel={
                  summary
                    ? `${formatTime(slot.time)} slot, ${summary.text}. ${
                        folded ? 'Tap to show doses' : 'Tap to fold'
                      }`
                    : `${formatTime(slot.time)} slot. Press and hold for options`
                }
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
              </TouchableOpacity>

              {/* Status is set through the dropdown; press and hold opens
                  edit / delete, and a swipe left uncovers delete. */}
              {folded
                ? null
                : slot.items.map(({ med, slot: at, state }) => (
                    <SwipeToDelete
                      key={med.id}
                      label={med.name}
                      onDelete={() => confirmDelete(med)}
                    >
                    <TouchableOpacity
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
                    </SwipeToDelete>
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

      <ActionSheet {...menuProps} onClose={() => setMenu(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: 8 },
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.cardSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
  },
  tipText: { flex: 1, fontSize: 12.5, color: colors.body, lineHeight: 18 },
  tipClose: { fontSize: 14, fontWeight: '800', color: colors.muted },
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
