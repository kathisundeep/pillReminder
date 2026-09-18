import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Screen,
  Content,
  TitleHeader,
  Card,
  Segmented,
  EmptyState,
  Button,
} from '../components/ui';
import { getSession, getMedicines, getHistory } from '../utils/storage';
import { getMyProfile } from '../utils/guardianCloud';
import {
  DAY_STATE,
  DOSE,
  BANDS,
  SEGMENTS,
  windowFor,
  rangeAdherence,
  summarise,
  currentStreak,
  groupByMonth,
  dayKey,
} from '../utils/adherence';
import { formatTime } from '../utils/doseState';
import { colors, radius } from '../theme';

// Adherence over time, at three zoom levels.
//
// Each day is split into three bars — morning, afternoon, night — coloured by
// what happened to the doses in that part of the day, so "I keep missing the
// night dose" shows up as a column of red bottoms. Colour is never alone: the
// date sits on every cell and tapping one spells the day out dose by dose.

// Segment colours for a bar, and badge colours + words for a dose.
// Soft fills in the prototype's palette. A band that needs attention —
// missed, snoozed, due — also gets a thin edge in its own colour, so it
// stands out from its neighbours without shouting. A time still to come is
// left white; a part of the day with nothing scheduled is the faintest grey.
const BAR = {
  [DOSE.TAKEN]: '#dcfce7',
  [DOSE.MISSED]: '#fee2e2',
  [DOSE.SNOOZED]: '#e0f2fe',
  [DOSE.DUE]: '#fef3c7',
  [DOSE.FUTURE]: '#ffffff',
  none: '#f1f5f9',
};
const BAR_EDGE = {
  [DOSE.MISSED]: '#fca5a5',
  [DOSE.SNOOZED]: '#7dd3fc',
  [DOSE.DUE]: '#fcd34d',
};

// One day as three stacked bands: morning, afternoon, night. Used full size
// in the grid and small in the legend.
function TriCell({ bands, dayKeyForTest }) {
  return (
    <View style={styles.tri}>
      {BANDS.map((b, i) => {
        const st = bands[b.id];
        const edge = BAR_EDGE[st];
        return (
          <View
            key={b.id}
            testID={dayKeyForTest ? `bar-${dayKeyForTest}-${b.id}` : undefined}
            style={[
              styles.bar,
              { backgroundColor: BAR[st] },
              i < BANDS.length - 1 && styles.barDivider,
              edge && { borderColor: edge, borderTopWidth: i ? 1 : 0, borderBottomWidth: 1 },
            ]}
          />
        );
      })}
    </View>
  );
}

const BADGE = {
  [DOSE.TAKEN]: { bg: '#d1fae5', fg: '#047857', word: '✓ Taken' },
  [DOSE.MISSED]: { bg: '#fee2e2', fg: '#dc2626', word: '✕ Missed' },
  [DOSE.SNOOZED]: { bg: '#e0f2fe', fg: '#0369a1', word: '💤 Snoozed' },
  [DOSE.DUE]: { bg: '#fef3c7', fg: '#b45309', word: '⏳ Due now' },
  [DOSE.FUTURE]: { bg: '#f1f5f9', fg: '#64748b', word: 'Upcoming' },
};

const LEGEND = [
  [DOSE.TAKEN, 'Taken'],
  [DOSE.MISSED, 'Missed'],
  [DOSE.SNOOZED, 'Snoozed'],
  [DOSE.DUE, 'Due now'],
  [DOSE.FUTURE, 'Not yet'],
  ['none', 'Nothing due'],
];

// Worked examples, as the reference's "Tri-Segment Cell Guide" has them.
const EXAMPLES = [
  [{ morning: DOSE.MISSED, afternoon: DOSE.TAKEN, night: DOSE.TAKEN }, 'Top red — missed the morning dose'],
  [{ morning: DOSE.TAKEN, afternoon: DOSE.MISSED, night: DOSE.TAKEN }, 'Middle red — missed the afternoon dose'],
  [{ morning: DOSE.TAKEN, afternoon: DOSE.MISSED, night: DOSE.FUTURE }, 'White — that dose is still to come'],
  [{ morning: DOSE.TAKEN, afternoon: DOSE.TAKEN, night: DOSE.TAKEN }, 'All green — every dose taken'],
];

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function dayWords(day) {
  if (day.state === DAY_STATE.NONE) return 'nothing due';
  if (day.state === DAY_STATE.FUTURE) return 'still to come';
  if (day.missed) return `${day.missed} missed`;
  return 'all taken';
}

function DayCell({ day, onPress, selected, isToday }) {
  const date = new Date(day.date);
  const ahead = day.state === DAY_STATE.FUTURE && !isToday;
  return (
    <View style={styles.cellWrap}>
      <Pressable
        onPress={() => onPress(day)}
        accessibilityRole="button"
        accessibilityLabel={`${date.getDate()} ${MONTH_NAMES[date.getMonth()]}, ${dayWords(day)}`}
        accessibilityState={{ selected }}
        style={({ pressed }) => [
          styles.cell,
          isToday && styles.cellToday,
          selected && styles.cellSelected,
          pressed && styles.cellPressed,
        ]}
      >
        <TriCell bands={day.bands} dayKeyForTest={day.key} />
        <Text style={[styles.cellNum, ahead && styles.cellNumAhead, isToday && styles.cellNumToday]}>
          {date.getDate()}
        </Text>
      </Pressable>
    </View>
  );
}

function DayDetail({ day }) {
  const date = new Date(day.date);
  const summary =
    day.state === DAY_STATE.NONE
      ? { text: 'Nothing due', color: colors.muted }
      : day.missed
      ? { text: `${day.missed} missed dose${day.missed === 1 ? '' : 's'}`, color: '#dc2626' }
      : day.state === DAY_STATE.FUTURE
      ? { text: 'Still to come', color: colors.muted }
      : { text: 'All doses taken', color: '#047857' };

  return (
    <View style={styles.detailCard}>
      <View style={styles.detailHead}>
        <Text style={styles.detailTitle}>
          Selected: {MONTH_NAMES[date.getMonth()]} {date.getDate()}, {date.getFullYear()}
        </Text>
        <Text style={[styles.detailSummary, { color: summary.color }]}>{summary.text}</Text>
      </View>
      {day.doses.length === 0 ? (
        <Text style={styles.detailEmpty}>No medicines were scheduled on this day.</Text>
      ) : (
        day.doses.map((d) => {
          const badge = BADGE[d.state];
          const band = BANDS.find((b) => b.id === d.band);
          return (
            <View key={`${d.med.id}-${d.slot}`} style={styles.slotRow}>
              <View style={styles.slotText}>
                <Text style={styles.slotLabel}>
                  {band.label} slot ({formatTime(d.slot)})
                </Text>
                <Text style={styles.slotMed}>{d.med.name}</Text>
              </View>
              <Text style={[styles.badge, { backgroundColor: badge.bg, color: badge.fg }]}>
                {badge.word}
              </Text>
            </View>
          );
        })
      )}
    </View>
  );
}

export default function CalendarScreen({ navigation }) {
  const [segment, setSegment] = useState('month');
  const [offset, setOffset] = useState(0);
  const [medicines, setMedicines] = useState([]);
  const [history, setHistory] = useState({});
  const [grace, setGrace] = useState(30);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState(() => dayKey(new Date()));

  const load = useCallback(async () => {
    const user = await getSession();
    if (!user) return setLoading(false);
    const [meds, hist, profile] = await Promise.all([
      getMedicines(user),
      getHistory(user),
      getMyProfile().catch(() => null),
    ]);
    setMedicines(meds || []);
    setHistory(hist || {});
    // The same allowance the guardian alert uses before calling a dose missed.
    setGrace(Number(profile?.settings?.graceMinutes) || 30);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <Screen>
        <TitleHeader title="Adherence Calendar" onClose={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.emerald600} />
        </View>
      </Screen>
    );
  }

  const now = new Date();
  const { from, to } = windowFor(segment, offset, now);
  const days = rangeAdherence(medicines, history, from, to, now, grace);
  const stats = summarise(days);
  const streak = currentStreak(days);
  const selected = days.find((d) => d.key === selectedKey) || null;

  const changeSegment = (next) => {
    setSegment(next);
    setOffset(0); // a stale offset means landing in an arbitrary past window
  };

  const title =
    segment === 'year'
      ? `${MONTH_NAMES[from.getMonth()]} ${from.getFullYear()} – ${MONTH_NAMES[to.getMonth()]} ${to.getFullYear()}`
      : segment === 'month'
      ? `${MONTH_LONG[from.getMonth()]} ${from.getFullYear()}`
      : `${from.getDate()} ${MONTH_NAMES[from.getMonth()]} – ${to.getDate()} ${MONTH_NAMES[to.getMonth()]}`;

  const scoreLabel = { week: 'Weekly', month: 'Monthly', year: 'Yearly' }[segment];
  const score = stats.percent;
  const scoreColors =
    score == null
      ? { bg: colors.cardSubtle, fg: colors.muted }
      : score >= 90
      ? { bg: '#d1fae5', fg: '#047857' }
      : score >= 60
      ? { bg: '#fef3c7', fg: '#b45309' }
      : { bg: '#fee2e2', fg: '#dc2626' };

  return (
    <Screen>
      <TitleHeader title="Adherence Calendar" onClose={() => navigation.goBack()} />
      <Content>
        <Segmented
          value={segment}
          onChange={changeSegment}
          options={SEGMENTS.map((s) => ({ value: s.id, label: s.label }))}
        />

        <View style={styles.periodRow}>
          <Pressable
            onPress={() => setOffset(offset - 1)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Previous period"
          >
            <Text style={styles.arrow}>‹</Text>
          </Pressable>
          <Text style={styles.period}>{title}</Text>
          <Pressable
            onPress={() => offset < 0 && setOffset(offset + 1)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Next period"
            // Nothing to see in the future, and letting it scroll forward
            // makes the view look broken rather than empty.
            disabled={offset >= 0}
          >
            <Text style={[styles.arrow, offset >= 0 && styles.arrowOff]}>›</Text>
          </Pressable>
        </View>

        {medicines.length === 0 ? (
          <EmptyState
            icon="🗓"
            title="No medicines yet"
            body="Add a medicine and this fills in as you take your doses."
          />
        ) : (
          <Card>
            <View style={styles.cardHead}>
              <Text style={styles.cardHeadTitle}>{title}</Text>
              <Text style={[styles.scorePill, { backgroundColor: scoreColors.bg, color: scoreColors.fg }]}>
                {score == null ? `No ${scoreLabel.toLowerCase()} score yet` : `${score}% ${scoreLabel} Score`}
              </Text>
            </View>
            <Text style={styles.statLine}>
              {stats.taken} taken · {stats.missed} missed · {streak} day streak
            </Text>

            {segment === 'year' ? (
              groupByMonth(days).map((m) => (
                <View key={m.key} style={styles.monthRow}>
                  <Text style={styles.monthName}>
                    {MONTH_NAMES[m.date.getMonth()]} {String(m.date.getFullYear()).slice(2)}
                  </Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${m.percent ?? 0}%`,
                          backgroundColor:
                            m.percent == null
                              ? colors.border
                              : m.percent >= 90
                              ? colors.emerald600
                              : m.percent >= 60
                              ? '#f59e0b'
                              : '#dc2626',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.monthPct}>{m.percent == null ? '—' : `${m.percent}%`}</Text>
                </View>
              ))
            ) : (
              <>
                <View style={styles.weekHead}>
                  {WEEKDAYS.map((d, i) => (
                    <Text key={`${d}${i}`} style={styles.weekHeadText}>
                      {d}
                    </Text>
                  ))}
                </View>
                <View style={styles.grid}>
                  {/* Blank cells so the first day lands under its weekday. */}
                  {segment === 'month'
                    ? Array.from({ length: from.getDay() }).map((_, i) => (
                        <View key={`pad${i}`} style={styles.cellWrap} />
                      ))
                    : null}
                  {days.map((d) => (
                    <DayCell
                      key={d.key}
                      day={d}
                      isToday={d.key === dayKey(now)}
                      selected={selectedKey === d.key}
                      onPress={(day) => setSelectedKey(day.key)}
                    />
                  ))}
                </View>
                <View style={styles.guide}>
                  <Text style={styles.guideTitle}>Reading a day</Text>
                  <Text style={styles.guideSub}>
                    Top to bottom: morning (before 12), afternoon (12–5), night (after 5).
                  </Text>
                  {EXAMPLES.map(([bands, words]) => (
                    <View key={words} style={styles.guideRow}>
                      <View style={styles.guideCell}>
                        <TriCell bands={bands} />
                      </View>
                      <Text style={styles.guideText}>{words}</Text>
                    </View>
                  ))}
                  <View style={styles.legend}>
                    {LEGEND.map(([st, word]) => (
                      <View key={st} style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: BAR[st], borderColor: BAR_EDGE[st] || colors.border },
                          ]}
                        />
                        <Text style={styles.legendText}>{word}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </>
            )}
          </Card>
        )}

        {segment !== 'year' && medicines.length > 0 ? (
          selected ? (
            <DayDetail day={selected} />
          ) : (
            <Text style={styles.hint}>Tap a day to see that day's doses.</Text>
          )
        ) : null}

        {/* The bottom bar has room for five destinations and Calendar took
            Report's place, so the full report is reached from here — which is
            the natural order anyway: the overview, then the detail. */}
        <Button
          title="📄  Full health report"
          variant="neutral"
          onPress={() => navigation.navigate('HealthReport')}
        />
      </Content>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 4,
  },
  arrow: { fontSize: 26, fontWeight: '800', color: colors.emerald700, paddingHorizontal: 10 },
  arrowOff: { color: colors.border },
  period: { fontSize: 14, fontWeight: '800', color: colors.heading },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  cardHeadTitle: { fontSize: 16.5, fontWeight: '800', color: colors.heading },
  scorePill: {
    fontSize: 12.5,
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  statLine: { fontSize: 12, color: colors.muted, marginTop: 6, marginBottom: 14 },
  weekHead: { flexDirection: 'row', marginBottom: 8 },
  weekHeadText: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cellWrap: { width: `${100 / 7}%`, padding: 3 },
  cell: {
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  cellToday: { borderColor: '#059669', borderWidth: 2 },
  cellSelected: { borderColor: colors.heading, borderWidth: 2 },
  cellPressed: { transform: [{ scale: 0.95 }] },
  tri: { flex: 1 },
  bar: { flex: 1 },
  barDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(15,23,42,0.08)' },
  cellNum: {
    position: 'absolute',
    top: 2,
    right: 4,
    fontSize: 10,
    fontWeight: '800',
    color: '#1e293b',
    textShadowColor: 'rgba(255,255,255,0.9)',
    textShadowRadius: 2,
  },
  cellNumAhead: { color: '#94a3b8' },
  cellNumToday: { color: '#047857' },
  guide: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  guideTitle: { fontSize: 13.5, fontWeight: '800', color: colors.heading },
  guideSub: { fontSize: 11.5, color: colors.muted, marginBottom: 2 },
  guideRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  guideCell: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  guideText: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.muted },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  legendText: { fontSize: 11, color: colors.muted },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9 },
  monthName: { width: 52, fontSize: 12, fontWeight: '700', color: colors.heading },
  barTrack: {
    flex: 1,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.cardSubtle,
    overflow: 'hidden',
  },
  barFill: { height: 9, borderRadius: 5 },
  monthPct: { width: 40, textAlign: 'right', fontSize: 12, fontWeight: '700', color: colors.muted },
  detailCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  detailHead: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 },
  detailTitle: { fontSize: 14, fontWeight: '800', color: colors.heading },
  detailSummary: { fontSize: 12.5, fontWeight: '800' },
  detailEmpty: { fontSize: 13, color: colors.muted },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.cardSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  slotText: { flex: 1 },
  slotLabel: { fontSize: 13, fontWeight: '800', color: colors.heading },
  slotMed: { fontSize: 12, color: colors.muted, marginTop: 2 },
  badge: {
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  hint: { textAlign: 'center', fontSize: 12, color: colors.muted, paddingVertical: 12 },
});
