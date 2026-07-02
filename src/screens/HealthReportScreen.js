import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Share,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { READING_TYPES, typeById, getReadings, getUserReadings } from '../utils/health';

function stats(readings, key) {
  const nums = readings
    .map((r) => Number(r.values?.[key]))
    .filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    latest: nums[0],
    min: Math.min(...nums),
    max: Math.max(...nums),
    avg: Math.round(sum / nums.length),
    count: nums.length,
  };
}

export default function HealthReportScreen({ route, navigation }) {
  const userId = route.params?.userId || null; // guardian viewing a linked user
  const username = route.params?.username || null;
  const [byType, setByType] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const all = userId ? await getUserReadings(userId) : await getReadings();
    const grouped = {};
    for (const r of all) {
      if (!grouped[r.type]) grouped[r.type] = [];
      grouped[r.type].push(r);
    }
    setByType(grouped);
    setLoading(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      navigation.setOptions({
        title: username ? `@${username}'s report` : 'Health report',
      });
      load();
    }, [load, navigation, username])
  );

  const share = async () => {
    let text = username ? `Health report for @${username}\n\n` : 'My health report\n\n';
    for (const t of READING_TYPES) {
      const list = byType[t.id];
      if (!list || list.length === 0) continue;
      text += `${t.label} (${t.unit}): latest ${t.format(list[0].values)}, ${list.length} reading(s)\n`;
    }
    try {
      await Share.share({ message: text });
    } catch (e) {}
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#4CAF50" />
      </View>
    );
  }

  const anything = Object.keys(byType).length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {!anything ? (
        <Text style={styles.empty}>No health readings recorded yet.</Text>
      ) : (
        <>
          {READING_TYPES.map((t) => {
            const list = byType[t.id];
            if (!list || list.length === 0) return null;
            return (
              <View key={t.id} style={styles.card}>
                <Text style={styles.type}>{t.label}</Text>
                <Text style={styles.latest}>
                  Latest: {t.format(list[0].values)} {t.unit}
                </Text>
                {t.fields.map((f) => {
                  const s = stats(list, f.key);
                  if (!s) return null;
                  return (
                    <Text key={f.key} style={styles.stat}>
                      {f.label}: avg {s.avg} · min {s.min} · max {s.max} ({s.count})
                    </Text>
                  );
                })}
              </View>
            );
          })}
          <TouchableOpacity style={styles.shareBtn} onPress={share}>
            <Text style={styles.shareText}>Share report</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8f6' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#888', textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, elevation: 1 },
  type: { fontSize: 16, fontWeight: '700', color: '#222' },
  latest: { fontSize: 15, color: '#2e7d32', fontWeight: '600', marginTop: 4 },
  stat: { fontSize: 13, color: '#666', marginTop: 4 },
  shareBtn: {
    backgroundColor: '#4CAF50',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  shareText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
