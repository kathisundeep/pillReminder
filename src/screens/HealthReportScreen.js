import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Share } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { READING_TYPES, getReadings, getUserReadings } from '../utils/health';
import {
  Screen,
  Content,
  TitleHeader,
  Card,
  Button,
  EmptyState,
  Pill,
} from '../components/ui';
import { colors } from '../theme';

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
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.emerald600} />
        </View>
      </Screen>
    );
  }

  const anything = Object.keys(byType).length > 0;

  return (
    <Screen>
      <TitleHeader
        title={username ? `@${username}'s report` : 'Health report'}
        onClose={() => navigation.goBack()}
      />
      <Content>
        {!anything ? (
          <EmptyState
            icon="📈"
            title="No health readings yet"
            body="Record a reading in Trackers and the summary will build up here."
          />
        ) : (
          <>
            {READING_TYPES.map((t) => {
              const list = byType[t.id];
              if (!list || list.length === 0) return null;
              return (
                <Card key={t.id}>
                  <View style={styles.cardHead}>
                    <Text style={styles.type}>{t.label}</Text>
                    <Pill bg={colors.cardSubtle} color={colors.muted}>
                      {list.length} reading{list.length > 1 ? 's' : ''}
                    </Pill>
                  </View>
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
                </Card>
              );
            })}
            <Button title="Share report" onPress={share} />
          </>
        )}
      </Content>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  type: { fontSize: 16, fontWeight: '800', color: colors.heading },
  latest: { fontSize: 16, color: colors.emerald700, fontWeight: '800', marginTop: 2 },
  stat: { fontSize: 13, color: colors.muted, marginTop: 6 },
});
