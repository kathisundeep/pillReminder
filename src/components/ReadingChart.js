import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { BANDS, chartValue, bandOf, typeById } from '../utils/health';
import { colors, radius } from '../theme';

// Readings over time, as bars coloured by band.
//
// Drawn with Views rather than a chart library on purpose: every charting
// package for React Native is a native dependency, and adding one costs a new
// APK and a reinstall. Bars need only height and colour, so this ships over
// the air.
//
// Colour never carries the meaning alone. Each bar states its band in its
// accessibility label, the newest reading is spelled out in words underneath,
// and the legend names every colour — a red/green chart is unreadable to
// roughly one man in twelve.

export const BAND_STYLE = {
  [BANDS.LOW]: { color: colors.snoozeText, label: 'Low' },
  [BANDS.NORMAL]: { color: colors.emerald600, label: 'Normal' },
  [BANDS.HIGH]: { color: colors.skipText, label: 'High' },
  [BANDS.UNKNOWN]: { color: colors.border, label: 'No range' },
};

const MAX_BARS = 30;

export default function ReadingChart({ type, readings }) {
  const t = typeById(type);

  // Oldest to newest, so the chart reads left to right like a timeline.
  const points = (readings || [])
    .slice(0, MAX_BARS)
    .map((r) => ({
      value: chartValue(type, r.reading_values ?? r.values),
      band: bandOf(type, r.reading_values ?? r.values),
      at: r.at || r.created_at,
    }))
    .filter((p) => p.value != null)
    .reverse();

  if (points.length === 0) {
    return (
      <Text style={styles.empty}>
        No readings yet — add one and the chart builds up here.
      </Text>
    );
  }

  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  // A flat series would otherwise divide by zero and render nothing; give it a
  // band so every bar draws at a readable mid height.
  const span = max - min || Math.max(1, max * 0.2);
  // Bars start from a floor below the minimum rather than from zero: for
  // hemoglobin between 13 and 15, a zero baseline makes every bar look
  // identical and hides exactly the variation worth seeing.
  const floor = min - span * 0.35;

  const latest = points[points.length - 1];
  const latestStyle = BAND_STYLE[latest.band];

  const bandsPresent = [...new Set(points.map((p) => p.band))];

  return (
    <View>
      <View style={styles.latestRow}>
        <Text style={styles.latestValue}>
          {latest.value}
          <Text style={styles.latestUnit}> {t.unit}</Text>
        </Text>
        <View style={[styles.pill, { backgroundColor: latestStyle.color }]}>
          <Text style={styles.pillText}>{latestStyle.label}</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.plot}>
          {points.map((p, i) => {
            const height = 12 + ((p.value - floor) / (max - floor)) * 76;
            const style = BAND_STYLE[p.band];
            const when = p.at
              ? new Date(p.at).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                })
              : '';
            return (
              <View key={`${p.at}-${i}`} style={styles.barSlot}>
                <Text style={styles.barValue}>{p.value}</Text>
                <View
                  accessibilityRole="image"
                  accessibilityLabel={`${p.value} ${t.unit} on ${when}, ${style.label}`}
                  style={[styles.bar, { height, backgroundColor: style.color }]}
                />
                <Text style={styles.barDate} numberOfLines={1}>
                  {when}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.legend}>
        {bandsPresent.map((b) => (
          <View key={b} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: BAND_STYLE[b].color }]} />
            <Text style={styles.legendText}>{BAND_STYLE[b].label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 13, color: colors.muted, paddingVertical: 10, lineHeight: 19 },
  latestRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  latestValue: { fontSize: 28, fontWeight: '800', color: colors.heading },
  latestUnit: { fontSize: 13, fontWeight: '700', color: colors.muted },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  plot: { flexDirection: 'row', alignItems: 'flex-end', paddingVertical: 4, gap: 6 },
  barSlot: { alignItems: 'center', width: 40 },
  barValue: { fontSize: 9.5, color: colors.muted, marginBottom: 3 },
  bar: { width: 18, borderTopLeftRadius: radius.thumb / 3, borderTopRightRadius: radius.thumb / 3 },
  barDate: { fontSize: 9, color: colors.muted, marginTop: 4 },
  legend: { flexDirection: 'row', gap: 14, marginTop: 10, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 2 },
  legendText: { fontSize: 11, color: colors.muted },
});
