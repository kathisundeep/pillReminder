import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { addMedicine, getSession } from '../utils/storage';
import {
  scheduleDailyAlarm,
  ensureNotificationSetup,
} from '../utils/notifications';

const SNOOZE_OPTIONS = [5, 10, 15, 30];

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad(m)} ${ampm}`;
}

export default function AddMedicineScreen({ navigation }) {
  const [name, setName] = useState('');
  const [times, setTimes] = useState([]);
  const [snoozeMinutes, setSnoozeMinutes] = useState(10);
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  const onPickTime = (event, selected) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (!selected) return;
    const hhmm = `${pad(selected.getHours())}:${pad(selected.getMinutes())}`;
    if (!times.includes(hhmm)) setTimes([...times, hhmm].sort());
  };

  const removeTime = (t) => setTimes(times.filter((x) => x !== t));

  const save = async () => {
    if (!name.trim()) return Alert.alert('Missing', 'Enter medicine name.');
    if (times.length === 0)
      return Alert.alert('Missing', 'Add at least one time.');

    setBusy(true);
    const ok = await ensureNotificationSetup();
    if (!ok) {
      setBusy(false);
      Alert.alert(
        'Permission needed',
        'Enable notifications to schedule alarms.'
      );
      return;
    }

    const user = await getSession();
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const notificationIds = [];
    for (const t of times) {
      const [h, m] = t.split(':').map(Number);
      const nid = await scheduleDailyAlarm({
        medicineId: id,
        medicineName: name.trim(),
        hour: h,
        minute: m,
      });
      notificationIds.push(nid);
    }

    await addMedicine(user, {
      id,
      name: name.trim(),
      times,
      snoozeMinutes,
      notificationIds,
      createdAt: new Date().toISOString(),
    });
    setBusy(false);
    navigation.goBack();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.label}>Medicine name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Paracetamol 500mg"
        value={name}
        onChangeText={setName}
      />

      <Text style={styles.label}>Times</Text>
      <View style={styles.timesWrap}>
        {times.map((t) => (
          <TouchableOpacity
            key={t}
            style={styles.timeChip}
            onPress={() => removeTime(t)}
          >
            <Text style={styles.timeChipText}>{formatTime(t)}  ×</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={styles.addTimeBtn}
          onPress={() => setShowPicker(true)}
        >
          <Text style={styles.addTimeText}>+ Add time</Text>
        </TouchableOpacity>
      </View>

      {showPicker && (
        <DateTimePicker
          value={new Date()}
          mode="time"
          is24Hour={false}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onPickTime}
        />
      )}

      <Text style={styles.label}>Snooze duration</Text>
      <View style={styles.snoozeRow}>
        {SNOOZE_OPTIONS.map((m) => (
          <TouchableOpacity
            key={m}
            style={[
              styles.snoozeOption,
              snoozeMinutes === m && styles.snoozeOptionActive,
            ]}
            onPress={() => setSnoozeMinutes(m)}
          >
            <Text
              style={[
                styles.snoozeOptionText,
                snoozeMinutes === m && styles.snoozeOptionTextActive,
              ]}
            >
              {m} min
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={busy}>
        <Text style={styles.saveBtnText}>{busy ? 'Saving...' : 'Save'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
  },
  timesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  timeChip: {
    backgroundColor: '#e8f5e9',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    marginRight: 8,
    marginBottom: 8,
  },
  timeChipText: { color: '#2e7d32', fontWeight: '600' },
  addTimeBtn: {
    backgroundColor: '#4CAF50',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    marginBottom: 8,
  },
  addTimeText: { color: '#fff', fontWeight: '700' },
  snoozeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  snoozeOption: {
    borderWidth: 1,
    borderColor: '#ccc',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  snoozeOptionActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  snoozeOptionText: { color: '#333', fontWeight: '600' },
  snoozeOptionTextActive: { color: '#fff' },
  saveBtn: {
    marginTop: 32,
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
