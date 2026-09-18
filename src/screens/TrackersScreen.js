import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ADDABLE_TYPES,
  typeById,
  addReading,
  getReadings,
  getUserReadings,
  deleteReading,
} from '../utils/health';
import ReadingChart from '../components/ReadingChart';
import {
  Screen,
  Content,
  TitleHeader,
  Card,
  CardTitle,
  Button,
  Chip,
  ChipGroup,
  Field,
  Input,
  EmptyState,
} from '../components/ui';
import { colors, radius } from '../theme';

function whenLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// With `userId` in the route, a guardian is recording for that person. They
// may add readings; deleting stays with the person.
export default function TrackersScreen({ route, navigation }) {
  const userId = route?.params?.userId || null;
  const username = route?.params?.username || null;
  const forSomeoneElse = !!userId;
  const [type, setType] = useState('bp');
  const [fields, setFields] = useState({});
  const [note, setNote] = useState('');
  const [readings, setReadings] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setReadings(userId ? await getUserReadings(userId) : await getReadings());
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const def = typeById(type);

  const onSave = async () => {
    const values = {};
    for (const f of def.fields) {
      const raw = fields[f.key];
      const n = Number(raw);
      if (raw === undefined || raw === '' || Number.isNaN(n))
        return Alert.alert('Missing', `Enter ${f.label}.`);
      values[f.key] = n;
    }
    setBusy(true);
    try {
      await addReading(type, values, note.trim() || null, userId);
      setFields({});
      setNote('');
      await load();
    } catch (e) {
      Alert.alert('Could not save', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = (r) => {
    Alert.alert('Delete reading', 'Remove this entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteReading(r.id);
          load();
        },
      },
    ]);
  };

  return (
    <Screen>
      <TitleHeader
        title={forSomeoneElse ? `Reading for @${username || 'them'}` : 'Health trackers'}
        onClose={() => navigation.goBack()}
      />
      <Content>
        <Field label="What are you recording?">
          <ChipGroup>
            {ADDABLE_TYPES.map((t) => (
              <Chip
                key={t.id}
                label={t.label}
                active={type === t.id}
                onPress={() => {
                  setType(t.id);
                  setFields({});
                }}
              />
            ))}
          </ChipGroup>
        </Field>

        <Card>
          {def.fields.map((f) => (
            <View key={f.key} style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{f.label}</Text>
              <Input
                keyboardType="numeric"
                value={fields[f.key] !== undefined ? String(fields[f.key]) : ''}
                onChangeText={(v) => setFields((s) => ({ ...s, [f.key]: v }))}
                placeholder="0"
                style={styles.numberInput}
              />
            </View>
          ))}
          <Text style={styles.unit}>Unit: {def.unit}</Text>
          <Input
            value={note}
            onChangeText={setNote}
            placeholder="Note (optional) — e.g. fasting, after food"
            style={styles.note}
          />
          <Button
            title={busy ? 'Saving…' : 'Save reading'}
            onPress={onSave}
            disabled={busy}
          />
        </Card>

        <Card>
          <CardTitle>{def.label} over time</CardTitle>
          <ReadingChart type={type} readings={readings} />
        </Card>

        <Text style={styles.listLabel}>Recent readings</Text>

        {readings.length === 0 ? (
          <EmptyState
            icon="🩺"
            title="No readings yet"
            body={forSomeoneElse ? 'Record a measurement for them above.' : 'Record your first measurement above.'}
          />
        ) : (
          readings.map((r) => {
            const t = typeById(r.type);
            return (
              <TouchableOpacity
                key={r.id}
                style={styles.readingRow}
                onLongPress={forSomeoneElse ? undefined : () => onDelete(r)}
                accessibilityLabel={
                  forSomeoneElse ? `${t.label} reading` : `${t.label} reading. Long-press to delete.`
                }
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.readingVal}>
                    {t.label}: {t.format(r.values)}{' '}
                    <Text style={styles.readingUnit}>{r.unit}</Text>
                  </Text>
                  {r.note ? <Text style={styles.readingNote}>{r.note}</Text> : null}
                </View>
                <Text style={styles.readingWhen}>{whenLabel(r.measured_at)}</Text>
              </TouchableOpacity>
            );
          })
        )}
        {readings.length > 0 && !forSomeoneElse ? (
          <Text style={styles.hint}>Long-press a reading to delete it.</Text>
        ) : null}
      </Content>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  fieldLabel: { flex: 1, fontSize: 15, color: colors.heading, fontWeight: '700' },
  numberInput: { width: 120, textAlign: 'right' },
  unit: { fontSize: 12, color: colors.muted, marginBottom: 12 },
  note: { marginBottom: 14 },
  listLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  readingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  readingVal: { fontSize: 15, fontWeight: '700', color: colors.heading },
  readingUnit: { fontSize: 12, color: colors.muted, fontWeight: '400' },
  readingNote: { fontSize: 12.5, color: colors.muted, marginTop: 3 },
  readingWhen: { fontSize: 12, color: colors.muted },
  hint: { fontSize: 11.5, color: colors.muted },
});
