import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Screen,
  Content,
  TitleHeader,
  Card,
  CardTitle,
  Segmented,
  EmptyState,
  Button,
} from '../components/ui';
import { getSession, getMedicines, getHistory } from '../utils/storage';
import {
  DAY_STATE,
  SEGMENTS,
  windowFor,
  rangeAdherence,
  summarise,
  currentStreak,
  groupByMonth,
  dayKey,
} from '../utils/adherence';
import { colors, radius } from '../theme';

// Adherence over time, at three zoom levels.
//
// The three exist because they answer different questions. Week: what did I
// miss, and can I still fix today? Month: is there a pattern — weekends,
// evenings? Year: am I better or worse than I was?
//
// Colour carries the state, but never alone: each cell also shows its date and
// the detail line spells the day out in words. Roughly one man in twelve cannot
// reliably separate the red from the green here.

const STATE_STYLE = {
  [DAY_STATE.FULL]: { bg: colors.emerald600, fg: '#FFFFFF', word: 'all taken' },
  [DAY_STATE.PARTIAL]: { bg: colors.snoozeBg, fg: colors.snoozeText, word: 'some missed' },
  [DAY_STATE.MISSED]: { bg: colors.skipBg, fg: colors.skipText, word: 'none taken' },
  [DAY_STATE.NONE]: { bg: colors.cardSubtle, fg: colors.muted, word: 'nothing due' },
  [DAY_STATE.FUTURE]: { bg: colors.surface, fg: colors.border, word: 'still to come' },
};

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function DayCell({ day, size, onPress, selected }) {
  const style = STATE_STYLE[day.state] || STATE_STYLE[DAY_STATE.NONE];
  const date = new Date(day.date);
  return (
    <Pressable
      onPress={() => onPress(day)}
      accessibilityRole="button"
      accessibilityLabel={`${date.getDate()} ${MONTH_NAMES[date.getMonth()]}, ${style.word}`}
      accessibilityState={{ selected }}
      style={[
        styles.cell,
        {
          width: size,
          height: size,
          backgroundColor: style.bg,
          borderColor: selected ? colors.heading : 'transparent',
        },
      ]}
    >
      <Text style={[styles.cellText, { color: style.fg }]}>{date.getDate()}</Text>
    </Pressable>
  );
}

export default function CalendarScreen({ navigation }) {
  const [segment, setSegment] = useState('week');
  const [offset, setOffset] = useState(0);
  const [medicines, setMedicines] = useState([]);
  const [history, setHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    const user = await getSession();
    if (!user) return setLoading(false);
    const [meds, hist] = await Promise.all([getMedicines(user), getHistory(user)]);
    setMedicines(meds || []);
    setHistory(hist || {});
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
        <TitleHeader title="Adherence" onClose={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.emerald600} />
        </View>
      </Screen>
    );
  }

  const now = new Date();
  const { from, to } = windowFor(segment, offset, now);
  const days = rangeAdherence(medicines, history, from, to, now);
  const stats = summarise(days);
  const streak = currentStreak(days);

  const changeSegment = (next) => {
    setSegment(next);
    setOffset(0); // a stale offset means landing in an arbitrary past window
    setSelected(null);
  };

  const title =
    segment === 'year'
      ? `${MONTH_NAMES[from.getMonth()]} ${from.getFullYear()} – ${MONTH_NAMES[to.getMonth()]} ${to.getFullYear()}`
      : segment === 'month'
      ? `${MONTH_NAMES[from.getMonth()]} ${from.getFullYear()}`
      : `${from.getDate()} ${MONTH_NAMES[from.getMonth()]} – ${to.getDate()} ${MONTH_NAMES[to.getMonth()]}`;

  return (
    <Screen>
      <TitleHeader title="Adherence" onClose={() => navigation.goBack()} />
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

        <Card>
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>
                {stats.percent == null ? '—' : `${stats.percent}%`}
              </Text>
              <Text style={styles.statLabel}>doses taken</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{stats.missed}</Text>
              <Text style={styles.statLabel}>missed</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{streak}</Text>
              <Text style={styles.statLabel}>day streak</Text>
            </View>
          </View>
          {stats.percent == null ? (
            <Text style={styles.note}>
              Nothing was due in this period, so there is no score to show.
            </Text>
          ) : null}
        </Card>

        {medicines.length === 0 ? (
          <EmptyState
            icon="🗓"
            title="No medicines yet"
            body="Add a medicine and this fills in as you take your doses."
          />
        ) : segment === 'year' ? (
          <Card>
            <CardTitle>By month</CardTitle>
            {groupByMonth(days).map((m) => (
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
                            ? colors.snoozeText
                            : colors.skipText,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.monthPct}>
                  {m.percent == null ? '—' : `${m.percent}%`}
                </Text>
              </View>
            ))}
          </Card>
        ) : (
          <Card>
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
                ? Array.from({ length: (from.getDay() + 6) % 7 }).map((_, i) => (
                    <View key={`pad${i}`} style={[styles.cell, styles.cellPad]} />
                  ))
                : null}
              {days.map((d) => (
                <DayCell
                  key={d.key}
                  day={d}
                  size={38}
                  selected={selected?.key === d.key}
                  onPress={setSelected}
                />
              ))}
            </View>

            <View style={styles.legend}>
              {[DAY_STATE.FULL, DAY_STATE.PARTIAL, DAY_STATE.MISSED, DAY_STATE.NONE].map(
                (s) => (
                  <View key={s} style={styles.legendItem}>
                    <View
                      style={[styles.legendDot, { backgroundColor: STATE_STYLE[s].bg }]}
                    />
                    <Text style={styles.legendText}>{STATE_STYLE[s].word}</Text>
                  </View>
                )
              )}
            </View>
          </Card>
        )}

        {/* The bottom bar has room for five destinations and Calendar took
            Report's place, so the full report is reached from here — which is
            the natural order anyway: the overview, then the detail. */}
        <Button
          title="📄  Full health report"
          variant="neutral"
          onPress={() => navigation.navigate('HealthReport')}
        />

        {selected ? (
          <Card>
            <CardTitle>
              {new Date(selected.date).toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </CardTitle>
            <Text style={styles.detail}>
              {selected.due === 0
                ? 'Nothing was due on this day.'
                : `${selected.taken} of ${selected.due} doses taken — ${
                    STATE_STYLE[selected.state].word
                  }.`}
            </Text>
          </Card>
        ) : (
          <Text style={styles.hint}>Tap a day to see that day's doses.</Text>
        )}
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
  statRow: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '800', color: colors.heading },
  statLabel: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  note: { fontSize: 12, color: colors.muted, marginTop: 12, lineHeight: 17 },
  weekHead: { flexDirection: 'row', marginBottom: 6 },
  weekHeadText: {
    width: 38,
    marginRight: 6,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '800',
    color: colors.muted,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    marginRight: 6,
    marginBottom: 6,
    borderRadius: radius.input,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  cellPad: { width: 38, height: 38, backgroundColor: 'transparent', borderColor: 'transparent' },
  cellText: { fontSize: 13, fontWeight: '700' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
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
  detail: { fontSize: 13.5, color: colors.body, lineHeight: 20 },
  hint: { textAlign: 'center', fontSize: 12, color: colors.muted, paddingVertical: 12 },
});
