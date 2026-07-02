import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Switch,
} from 'react-native';
import {
  addMedicine,
  getSession,
  getMedicine,
  getMedicines,
  updateMedicine,
  deleteMedicine,
} from '../utils/storage';
import {
  resyncAlarms,
  ensureNotificationSetup,
  TONES,
} from '../utils/notifications';
import { Audio } from 'expo-av';
import WheelTimePicker from '../components/WheelTimePicker';
import DaysSelector from '../components/DaysSelector';
import { createAddMedicineRequest } from '../utils/guardianCloud';

const TONE_SOURCES = {
  alarm: require('../../assets/sounds/alarm.wav'),
  chime: require('../../assets/sounds/chime.wav'),
  bell: require('../../assets/sounds/bell.wav'),
  siren: require('../../assets/sounds/siren.wav'),
  gentle: require('../../assets/sounds/gentle.wav'),
};

const SNOOZE_OPTIONS = [5, 10, 15, 30];

const FORM_OPTIONS = [
  { id: 'Tablet', label: 'Tablet' },
  { id: 'Capsule', label: 'Capsule' },
  { id: 'Syrup', label: 'Syrup' },
  { id: 'Injection', label: 'Injection' },
  { id: 'Drops', label: 'Drops' },
];

const TABLET_COLORS = [
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Red', hex: '#E53935' },
  { name: 'Orange', hex: '#FB8C00' },
  { name: 'Yellow', hex: '#FDD835' },
  { name: 'Green', hex: '#43A047' },
  { name: 'Blue', hex: '#1E88E5' },
  { name: 'Pink', hex: '#EC407A' },
  { name: 'Brown', hex: '#8D6E63' },
];

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
  // Guardian "request to add" mode: build the same form but submit as an
  // approval request for the linked user instead of writing directly.
  const requestUserId = route.params?.requestUserId || null;
  const requestUsername = route.params?.requestUsername || null;
  const isRequest = !!requestUserId;

  const [name, setName] = useState('');
  const [names, setNames] = useState([]);
  const [nameInput, setNameInput] = useState('');
  const [times, setTimes] = useState([]);
  const [snoozeMinutes, setSnoozeMinutes] = useState(10);
  const [frequency, setFrequency] = useState('daily');
  const [daysOfWeek, setDaysOfWeek] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerInitial, setPickerInitial] = useState({ hour: 8, minute: 0 });
  const [busy, setBusy] = useState(false);
  const [originalNotifIds, setOriginalNotifIds] = useState([]);
  const [form, setForm] = useState('Tablet');
  const [toneId, setToneId] = useState('classic');
  const previewRef = React.useRef(null);
  const [alertGuardian, setAlertGuardian] = useState(true);
  const [color, setColor] = useState('#FFFFFF');

  const openPicker = () => {
    const now = new Date();
    setPickerInitial({ hour: now.getHours(), minute: now.getMinutes() });
    setPickerOpen(true);
  };

  useEffect(() => {
    navigation.setOptions({
      title: isRequest
        ? `Request for @${requestUsername}`
        : isEdit
        ? 'Edit medicine'
        : 'Add medicine',
    });
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
      setToneId(med.toneId || 'classic');
      setForm(med.form || 'Tablet');
      setAlertGuardian(med.alertGuardian !== false);
      setColor(med.color || '#FFFFFF');
    })();
  }, [editingId]);

  const onPickerConfirm = ({ hour, minute }) => {
    const hhmm = `${pad(hour)}:${pad(minute)}`;
    if (!times.includes(hhmm)) setTimes([...times, hhmm].sort());
    setPickerOpen(false);
  };

  const removeTime = (t) => setTimes(times.filter((x) => x !== t));

  const previewTone = async (tone) => {
    setToneId(tone.id);
    try {
      if (previewRef.current) {
        await previewRef.current.unloadAsync();
        previewRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync(TONE_SOURCES[tone.sound], {
        shouldPlay: true,
        volume: 1.0,
      });
      previewRef.current = sound;
      // Auto-stop the preview after a couple of seconds.
      setTimeout(async () => {
        try {
          if (previewRef.current === sound) {
            await sound.stopAsync();
            await sound.unloadAsync();
            previewRef.current = null;
          }
        } catch (e) {}
      }, 2500);
    } catch (e) {}
  };

  useEffect(() => {
    return () => {
      if (previewRef.current) {
        previewRef.current.unloadAsync().catch(() => {});
        previewRef.current = null;
      }
    };
  }, []);

  const addName = () => {
    const n = nameInput.trim();
    if (!n) return;
    if (!names.some((x) => x.name === n))
      setNames([...names, { name: n, color: color || '#FFFFFF' }]);
    setNameInput('');
  };
  const removeName = (n) => setNames(names.filter((x) => x.name !== n));

  const save = async () => {
    // Collect medicine name(s) with their colour. Edit mode is a single
    // medicine; create mode can batch several that share this schedule.
    let entries; // [{ name, color }]
    if (isEdit) {
      if (!name.trim()) return Alert.alert('Missing', 'Enter medicine name.');
      entries = [{ name: name.trim(), color: color || '#FFFFFF' }];
    } else {
      const pending = nameInput.trim();
      entries = [...names];
      if (pending && !entries.some((e) => e.name === pending))
        entries.push({ name: pending, color: color || '#FFFFFF' });
      if (entries.length === 0)
        return Alert.alert('Missing', 'Add at least one medicine name.');
    }
    if (times.length === 0)
      return Alert.alert('Missing', 'Add at least one time.');
    if (frequency === 'weekly' && daysOfWeek.length === 0)
      return Alert.alert('Missing', 'Pick at least one day.');

    const sharedDays =
      frequency === 'weekly' ? daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
    const buildDraft = (id, medName, medColor) => ({
      id,
      name: medName,
      form: form || 'Tablet',
      times,
      snoozeMinutes,
      frequency,
      daysOfWeek: sharedDays,
      toneId: toneId || 'classic',
      alertGuardian,
      color: medColor || '#FFFFFF',
    });

    // Guardian request mode: send each medicine as an approval request.
    if (isRequest) {
      setBusy(true);
      try {
        for (const e of entries) {
          const res = await createAddMedicineRequest(
            requestUserId,
            buildDraft(undefined, e.name, e.color)
          );
          if (!res.ok) throw new Error(res.error || 'request failed');
        }
        Alert.alert(
          'Request sent',
          `Sent to @${requestUsername} for approval.`
        );
        navigation.goBack();
      } catch (e) {
        Alert.alert('Failed', String(e?.message || e));
      } finally {
        setBusy(false);
      }
      return;
    }

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

      if (isEdit) {
        await updateMedicine(
          user,
          editingId,
          buildDraft(editingId, entries[0].name, entries[0].color)
        );
      } else {
        let i = 0;
        for (const e of entries) {
          const id = `${Date.now()}_${i}_${Math.random()
            .toString(36)
            .slice(2, 7)}`;
          await addMedicine(user, buildDraft(id, e.name, e.color));
          i += 1;
        }
      }

      // Wipe every scheduled notification and re-arm alarms for ALL medicines
      // so no stale/leftover snooze can fire at the wrong time.
      const all = await getMedicines(user);
      const idMap = await resyncAlarms(all);
      for (const m of all) {
        await updateMedicine(user, m.id, {
          notificationIds: idMap[m.id] || [],
        });
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
          const user = await getSession();
          await deleteMedicine(user, editingId);
          const all = await getMedicines(user);
          const idMap = await resyncAlarms(all);
          for (const m of all) {
            await updateMedicine(user, m.id, {
              notificationIds: idMap[m.id] || [],
            });
          }
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
      {isEdit ? (
        <>
          <Text style={styles.label}>Medicine name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Paracetamol 500mg"
            value={name}
            onChangeText={setName}
          />
        </>
      ) : (
        <>
          <Text style={styles.label}>Medicine names</Text>
          <Text style={styles.nameHint}>
            Add every medicine taken at the time(s) below. Each is saved as its
            own item but shares this schedule.
          </Text>
          {names.length > 0 && (
            <View style={styles.timesWrap}>
              {names.map((n) => (
                <TouchableOpacity
                  key={n.name}
                  style={styles.nameChip}
                  onPress={() => removeName(n.name)}
                >
                  <View
                    style={[styles.nameChipDot, { backgroundColor: n.color }]}
                  />
                  <Text style={styles.nameChipText}>{n.name}  ×</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View style={styles.nameAddRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="e.g. Paracetamol 500mg"
              value={nameInput}
              onChangeText={setNameInput}
              onSubmitEditing={addName}
              returnKeyType="done"
              blurOnSubmit={false}
            />
            <TouchableOpacity style={styles.nameAddBtn} onPress={addName}>
              <Text style={styles.nameAddBtnText}>+ Add</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <Text style={styles.label}>Type</Text>
      <View style={styles.timesWrap}>
        {FORM_OPTIONS.map((f) => {
          const on = form === f.id;
          return (
            <TouchableOpacity
              key={f.id}
              style={[styles.quickChip, on && styles.quickChipOn]}
              onPress={() => setForm(f.id)}
            >
              <Text style={[styles.quickChipText, on && styles.quickChipTextOn]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Colour</Text>
      {!isEdit && (
        <Text style={styles.nameHint}>
          Pick a colour, then add the medicine above — each medicine keeps its
          own colour.
        </Text>
      )}
      <View style={styles.colorRow}>
        {TABLET_COLORS.map((c) => {
          const selected = color === c.hex;
          return (
            <TouchableOpacity
              key={c.hex}
              onPress={() => setColor(c.hex)}
              style={styles.colorItem}
            >
              <View
                style={[
                  styles.colorSwatch,
                  { backgroundColor: c.hex },
                  selected && styles.colorSwatchSelected,
                ]}
              >
                {selected && (
                  <Text
                    style={[
                      styles.colorCheck,
                      { color: c.hex === '#FDD835' || c.hex === '#FFFFFF' ? '#333' : '#fff' },
                    ]}
                  >
                    ✓
                  </Text>
                )}
              </View>
              <Text style={styles.colorName}>{c.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

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
      <Text style={styles.nameHint}>Tap a tone to preview and select it.</Text>
      {TONES.map((tone) => {
        const selected = toneId === tone.id;
        return (
          <TouchableOpacity
            key={tone.id}
            style={[styles.toneOption, selected && styles.toneOptionOn]}
            onPress={() => previewTone(tone)}
          >
            <View
              style={[styles.toneRadio, selected && styles.toneRadioOn]}
            >
              {selected && <View style={styles.toneRadioDot} />}
            </View>
            <Text
              style={[styles.toneLabel, selected && styles.toneLabelOn]}
            >
              {tone.label}
            </Text>
            <Text style={styles.tonePlay}>▶</Text>
          </TouchableOpacity>
        );
      })}

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

      <View style={styles.guardianRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.guardianTitle}>Alert guardian if missed</Text>
          <Text style={styles.guardianSub}>
            Notify your guardian if this medicine isn't taken in time. Set up the
            guardian from the Home screen.
          </Text>
        </View>
        <Switch
          value={alertGuardian}
          onValueChange={setAlertGuardian}
          trackColor={{ true: '#4CAF50' }}
        />
      </View>

      <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={busy}>
        <Text style={styles.saveBtnText}>
          {busy
            ? 'Saving...'
            : isRequest
            ? 'Send request'
            : isEdit
            ? 'Save changes'
            : 'Save'}
        </Text>
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
  toneOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  toneOptionOn: { borderColor: '#4CAF50', backgroundColor: '#f1f8e9' },
  toneRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#bbb',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  toneRadioOn: { borderColor: '#4CAF50' },
  toneRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4CAF50',
  },
  toneLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: '#333' },
  toneLabelOn: { color: '#2e7d32' },
  tonePlay: { fontSize: 14, color: '#4CAF50' },
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
  nameHint: { fontSize: 12, color: '#888', marginBottom: 10, lineHeight: 17 },
  nameAddRow: { flexDirection: 'row', alignItems: 'center' },
  nameAddBtn: {
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginLeft: 8,
  },
  nameAddBtnText: { color: '#fff', fontWeight: '700' },
  nameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    marginRight: 8,
    marginBottom: 8,
  },
  nameChipDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#90a4ae',
    marginRight: 8,
  },
  nameChipText: { color: '#1565c0', fontWeight: '700' },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap' },
  colorItem: { alignItems: 'center', width: 64, marginBottom: 12 },
  colorSwatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSwatchSelected: { borderWidth: 3, borderColor: '#333' },
  colorCheck: { fontSize: 18, fontWeight: '800' },
  colorName: { fontSize: 11, color: '#666', marginTop: 4 },
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
  guardianRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f8e9',
    borderRadius: 10,
    padding: 14,
    marginTop: 24,
  },
  guardianTitle: { fontSize: 15, fontWeight: '700', color: '#222' },
  guardianSub: { fontSize: 12, color: '#777', marginTop: 4, lineHeight: 17 },
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
