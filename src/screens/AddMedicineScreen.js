import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import {
  addMedicine,
  getSession,
  getMedicine,
  updateMedicine,
  deleteMedicine,
} from '../utils/storage';
import {
  scheduleForMedicine,
  scheduleTestAlarm,
  ensureNotificationSetup,
  cancelManyNotifications,
  listScheduled,
} from '../utils/notifications';
import WheelTimePicker from '../components/WheelTimePicker';
import DaysSelector from '../components/DaysSelector';
import { pickRingtone, shortToneLabel } from '../utils/ringtone';

const SNOOZE_OPTIONS = [5, 10, 15, 30];

const QUICK_TIMES = [
  { label: 'Morning', time: '08:00' },
  { label: 'Before lunch', time: '12:30' },
  { label: 'After lunch', time: '13:30' },
  { label: 'Evening', time: '17:00' },
  { label: 'Before dinner', time: '19:00' },
  { label: 'After dinner', time: '21:00' },
  { label: 'Night', time: '22:00' },
];

function pad(n) {
  return String(n).padStart(2, '0');
}
function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad(m)} ${ampm}`;
}

export default function AddMedicineScreen({ route, navigation }) {
  const editingId = route.params?.medicineId || null;
  const isEdit = !!editingId;

  const [name, setName] = useState('');
  const [times, setTimes] = useState([]);
  const [snoozeMinutes, setSnoozeMinutes] = useState(10);
  const [frequency, setFrequency] = useState('daily');
  const [daysOfWeek, setDaysOfWeek] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerInitial, setPickerInitial] = useState({ hour: 8, minute: 0 });
  const [busy, setBusy] = useState(false);
  const [originalNotifIds, setOriginalNotifIds] = useState([]);
  const [alarmToneUri, setAlarmToneUri] = useState(null);

  const openPicker = () => {
    const now = new Date();
    setPickerInitial({ hour: now.getHours(), minute: now.getMinutes() });
    setPickerOpen(true);
  };

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit medicine' : 'Add medicine' });
    if (!isEdit) return;
    (async () => {
      const user = await getSession();
      const med = await getMedicine(user, editingId);
      if (!med) return;
      setName(med.name);
      setTimes(med.times || []);
      setSnoozeMinutes(med.snoozeMinutes || 10);
      setFrequency(med.frequency || 'daily');
      setDaysOfWeek(med.daysOfWeek || []);
      setOriginalNotifIds(med.notificationIds || []);
      setAlarmToneUri(med.alarmToneUri || null);
    })();
  }, [editingId]);

  const onPickerConfirm = ({ hour, minute }) => {
    const hhmm = `${pad(hour)}:${pad(minute)}`;
    if (!times.includes(hhmm)) setTimes([...times, hhmm].sort());
    setPickerOpen(false);
  };

  const removeTime = (t) => setTimes(times.filter((x) => x !== t));

  const onTestAlarm = async () => {
    try {
      const ok = await ensureNotificationSetup();
      if (!ok) {
        Alert.alert('Permission needed', 'Enable notifications first.');
        return;
      }
      const id = await scheduleTestAlarm({ seconds: 30 });
      const scheduled = await listScheduled();
      Alert.alert(
        'Test alarm scheduled',
        `id=${id?.slice(0, 8)}... · queue size=${scheduled.length}\nWill ring in ~30s. Lock the phone or background the app to test wake-up behavior.`
      );
    } catch (e) {
      Alert.alert('Scheduling failed', String(e?.message || e));
    }
  };

  const save = async () => {
    if (!name.trim()) return Alert.alert('Missing', 'Enter medicine name.');
    if (times.length === 0)
      return Alert.alert('Missing', 'Add at least one time.');
    if (frequency === 'weekly' && daysOfWeek.length === 0)
      return Alert.alert('Missing', 'Pick at least one day.');

    setBusy(true);
    try {
      const ok = await ensureNotificationSetup();
      if (!ok) {
        Alert.alert(
          'Permission needed',
          'Enable notifications to schedule alarms.'
        );
        return;
      }

      const user = await getSession();
      if (isEdit) await cancelManyNotifications(originalNotifIds);

      const id = isEdit
        ? editingId
        : `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const medDraft = {
        id,
        name: name.trim(),
        times,
        snoozeMinutes,
        frequency,
        daysOfWeek: frequency === 'weekly' ? daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
        alarmToneUri: alarmToneUri || null,
        createdAt: new Date().toISOString(),
      };

      const notificationIds = await scheduleForMedicine(medDraft);
      medDraft.notificationIds = notificationIds;

      if (isEdit) {
        await updateMedicine(user, id, medDraft);
      } else {
        await addMedicine(user, medDraft);
      }
      navigation.goBack();
    } catch (e) {
      Alert.alert('Save failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = () => {
    Alert.alert('Delete medicine', `Remove "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await cancelManyNotifications(originalNotifIds);
          const user = await getSession();
          await deleteMedicine(user, editingId);
          navigation.goBack();
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 80 }}
      keyboardShouldPersistTaps="handled"
    >
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
        <TouchableOpacity style={styles.addTimeBtn} onPress={openPicker}>
          <Text style={styles.addTimeText}>+ Custom time</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.subLabel}>Quick add</Text>
      <View style={styles.timesWrap}>
        {QUICK_TIMES.map((q) => {
          const already = times.includes(q.time);
          return (
            <TouchableOpacity
              key={q.label}
              style={[styles.quickChip, already && styles.quickChipOn]}
              onPress={() =>
                already
                  ? setTimes(times.filter((t) => t !== q.time))
                  : setTimes([...times, q.time].sort())
              }
            >
              <Text
                style={[
                  styles.quickChipText,
                  already && styles.quickChipTextOn,
                ]}
              >
                {q.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Frequency</Text>
      <View style={styles.segment}>
        <TouchableOpacity
          style={[
            styles.segmentItem,
            frequency === 'daily' && styles.segmentItemActive,
          ]}
          onPress={() => setFrequency('daily')}
        >
          <Text
            style={[
              styles.segmentText,
              frequency === 'daily' && styles.segmentTextActive,
            ]}
          >
            Daily
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.segmentItem,
            frequency === 'weekly' && styles.segmentItemActive,
          ]}
          onPress={() => setFrequency('weekly')}
        >
          <Text
            style={[
              styles.segmentText,
              frequency === 'weekly' && styles.segmentTextActive,
            ]}
          >
            Specific days
          </Text>
        </TouchableOpacity>
      </View>

      {frequency === 'weekly' && (
        <DaysSelector value={daysOfWeek} onChange={setDaysOfWeek} />
      )}

      <Text style={styles.label}>Alarm tone</Text>
      <TouchableOpacity
        style={styles.toneRow}
        onPress={async () => {
          try {
            const uri = await pickRingtone(alarmToneUri);
            if (uri !== null) setAlarmToneUri(uri);
          } catch (e) {
            Alert.alert('Picker error', String(e?.message || e));
          }
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.toneTitle}>{shortToneLabel(alarmToneUri)}</Text>
          <Text style={styles.toneSub}>Tap to choose from phone</Text>
        </View>
        <Text style={styles.toneArrow}>›</Text>
      </TouchableOpacity>
      {alarmToneUri && (
        <TouchableOpacity onPress={() => setAlarmToneUri(null)}>
          <Text style={styles.clearTone}>Reset to default beep</Text>
        </TouchableOpacity>
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
        <Text style={styles.saveBtnText}>
          {busy ? 'Saving...' : isEdit ? 'Save changes' : 'Save'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.testBtn} onPress={onTestAlarm}>
        <Text style={styles.testBtnText}>Test alarm in 30s</Text>
      </TouchableOpacity>

      {isEdit && (
        <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
          <Text style={styles.deleteBtnText}>Delete medicine</Text>
        </TouchableOpacity>
      )}

      <WheelTimePicker
        visible={pickerOpen}
        initialHour={pickerInitial.hour}
        initialMinute={pickerInitial.minute}
        onCancel={() => setPickerOpen(false)}
        onConfirm={onPickerConfirm}
      />
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
  subLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
    marginTop: 8,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  quickChip: {
    borderWidth: 1,
    borderColor: '#bbb',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginRight: 8,
    marginBottom: 8,
  },
  quickChipOn: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  quickChipText: { color: '#555', fontWeight: '600', fontSize: 13 },
  quickChipTextOn: { color: '#fff' },
  toneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 14,
    borderRadius: 10,
  },
  toneTitle: { fontSize: 15, color: '#222', fontWeight: '600' },
  toneSub: { fontSize: 12, color: '#888', marginTop: 2 },
  toneArrow: { fontSize: 24, color: '#888' },
  clearTone: {
    color: '#4CAF50',
    marginTop: 8,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
  },
  timesWrap: { flexDirection: 'row', flexWrap: 'wrap' },
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
  segment: {
    flexDirection: 'row',
    backgroundColor: '#eee',
    borderRadius: 10,
    padding: 4,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentItemActive: { backgroundColor: '#fff', elevation: 1 },
  segmentText: { color: '#666', fontWeight: '600' },
  segmentTextActive: { color: '#222' },
  snoozeRow: { flexDirection: 'row', flexWrap: 'wrap' },
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
    marginTop: 24,
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  testBtn: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderColor: '#4CAF50',
    borderWidth: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  testBtnText: { color: '#4CAF50', fontWeight: '700' },
  deleteBtn: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderColor: '#e53935',
    borderWidth: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  deleteBtnText: { color: '#e53935', fontWeight: '700' },
});
