import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  READING_TYPES,
  typeById,
  addReading,
  getReadings,
  deleteReading,
} from '../utils/health';

function whenLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TrackersScreen() {
  const [type, setType] = useState('bp');
  const [fields, setFields] = useState({});
  const [note, setNote] = useState('');
  const [readings, setReadings] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setReadings(await getReadings());
  }, []);

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
      await addReading(type, values, note.trim() || null);
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.label}>What are you recording?</Text>
      <View style={styles.row}>
        {READING_TYPES.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.chip, type === t.id && styles.chipOn]}
            onPress={() => {
              setType(t.id);
              setFields({});
            }}
          >
            <Text style={[styles.chipText, type === t.id && styles.chipTextOn]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.card}>
        {def.fields.map((f) => (
          <View key={f.key} style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{f.label}</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={fields[f.key] !== undefined ? String(fields[f.key]) : ''}
              onChangeText={(v) => setFields((s) => ({ ...s, [f.key]: v }))}
              placeholder="0"
            />
          </View>
        ))}
        <Text style={styles.unit}>Unit: {def.unit}</Text>
        <TextInput
          style={[styles.input, styles.note]}
          value={note}
          onChangeText={setNote}
          placeholder="Note (optional) — e.g. fasting, after food"
        />
        <TouchableOpacity
          style={[styles.saveBtn, busy && { opacity: 0.6 }]}
          onPress={onSave}
          disabled={busy}
        >
          <Text style={styles.saveText}>{busy ? 'Saving…' : 'Save reading'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.listLabel}>Recent readings</Text>
      {readings.length === 0 ? (
        <Text style={styles.empty}>No readings yet.</Text>
      ) : (
        readings.map((r) => {
          const t = typeById(r.type);
          return (
            <TouchableOpacity
              key={r.id}
              style={styles.readingRow}
              onLongPress={() => onDelete(r)}
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
      <Text style={styles.hint}>Long-press a reading to delete it.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8f6' },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#ccc',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    marginRight: 8,
    marginBottom: 8,
  },
  chipOn: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  chipText: { color: '#555', fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 1, marginBottom: 20 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  fieldLabel: { flex: 1, fontSize: 15, color: '#333', fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minWidth: 110,
    textAlign: 'right',
  },
  unit: { fontSize: 12, color: '#999', marginBottom: 10 },
  note: { textAlign: 'left', marginBottom: 12, minWidth: 0 },
  saveBtn: { backgroundColor: '#4CAF50', padding: 14, borderRadius: 8, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  listLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  empty: { color: '#888', marginBottom: 10 },
  readingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    elevation: 1,
  },
  readingVal: { fontSize: 15, fontWeight: '600', color: '#222' },
  readingUnit: { fontSize: 12, color: '#999', fontWeight: '400' },
  readingNote: { fontSize: 12, color: '#888', marginTop: 3 },
  readingWhen: { fontSize: 12, color: '#999', marginLeft: 8 },
  hint: { fontSize: 11, color: '#aaa', marginTop: 6 },
});
