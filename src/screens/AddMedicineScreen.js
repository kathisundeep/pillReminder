import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
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
import { resyncAlarms, ensureNotificationSetup } from '../utils/notifications';
import { Audio } from 'expo-av';
import MedicineDraftCard from '../components/MedicineDraftCard';
import { createAddMedicineRequest } from '../utils/guardianCloud';
import { notifyPatientOfRequest } from '../utils/guardian';
import {
  listSoundOptions,
  canUseDeviceSounds,
  rememberDeviceSound,
} from '../utils/sounds';
import { todayISO, addDaysISO, durationOf } from '../utils/course';
import { colors as theme } from '../theme';

const TONE_SOURCES = {
  alarm: require('../../assets/sounds/alarm.wav'),
  chime: require('../../assets/sounds/chime.wav'),
  bell: require('../../assets/sounds/bell.wav'),
  siren: require('../../assets/sounds/siren.wav'),
  gentle: require('../../assets/sounds/gentle.wav'),
};

const SNOOZE_OPTIONS = [5, 10, 15, 30];

let draftSeq = 0;

// A blank medicine. `schedule` carries the previous card's times, days and
// course length, so medicines that share a schedule stay one tap each.
function newDraft(schedule = {}) {
  draftSeq += 1;
  return {
    key: `draft-${draftSeq}`,
    name: '',
    form: 'Tablet',
    color: '#FFFFFF',
    photo: null,
    times: schedule.times || [],
    frequency: schedule.frequency || 'daily',
    daysOfWeek: schedule.daysOfWeek || [],
    durationDays: schedule.durationDays ?? null,
    startDate: null,
  };
}

export default function AddMedicineScreen({ route, navigation }) {
  const editingId = route.params?.medicineId || null;
  const isEdit = !!editingId;
  // Guardian "request to add" mode: build the same form but submit as an
  // approval request for the linked user instead of writing directly.
  const requestUserId = route.params?.requestUserId || null;
  const requestUsername = route.params?.requestUsername || null;
  const isRequest = !!requestUserId;

  // One card per medicine, each with its own schedule; only one is open.
  const [drafts, setDrafts] = useState(() => [newDraft()]);
  const [openKey, setOpenKey] = useState(() => null);
  // Shared by the whole batch.
  const [snoozeMinutes, setSnoozeMinutes] = useState(10);
  const [toneId, setToneId] = useState('classic');
  const [alertGuardian, setAlertGuardian] = useState(true);
  const [soundOptions] = useState(() => listSoundOptions());
  const [deviceSoundsAvailable] = useState(() => canUseDeviceSounds());
  const previewRef = React.useRef(null);
  const [busy, setBusy] = useState(false);

  const activeKey = openKey || drafts[0]?.key;

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
      const draft = {
        ...newDraft(),
        name: med.name,
        form: med.form || 'Tablet',
        color: med.color || '#FFFFFF',
        photo: med.photo || null,
        times: med.times || [],
        frequency: med.frequency || 'daily',
        daysOfWeek: med.daysOfWeek || [],
        startDate: med.startDate || null,
        // Shown back as a length rather than a raw date: that is how it was
        // entered, and how the prescription reads.
        durationDays: durationOf(med.startDate, med.endDate),
      };
      setDrafts([draft]);
      setOpenKey(draft.key);
      setSnoozeMinutes(med.snoozeMinutes || 10);
      setToneId(med.toneId || 'classic');
      setAlertGuardian(med.alertGuardian !== false);
    })();
  }, [editingId]);

  const updateDraft = (key, patch) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const addAnother = () => {
    const last = drafts[drafts.length - 1];
    const next = newDraft(last);
    setDrafts([...drafts, next]);
    setOpenKey(next.key);
  };

  const removeDraft = (key) => {
    const rest = drafts.filter((d) => d.key !== key);
    setDrafts(rest);
    if (activeKey === key) setOpenKey(rest[rest.length - 1]?.key || null);
  };

  const previewTone = async (tone) => {
    setToneId(tone.id);
    // A device sound has to be remembered before it can be scheduled: the
    // medicine stores only the id, so the id -> uri mapping must survive.
    if (tone.kind === 'device') {
      await rememberDeviceSound({ uri: tone.uri, title: tone.title });
    }
    try {
      if (previewRef.current) {
        await previewRef.current.unloadAsync();
        previewRef.current = null;
      }
      // Bundled tones are require()d assets; device sounds are content:// URIs,
      // which expo-av plays directly on Android.
      const source = tone.kind === 'device'
        ? { uri: tone.uri }
        : TONE_SOURCES[tone.sound];
      const { sound } = await Audio.Sound.createAsync(source, {
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

  // Stops at the first card that is not ready, opens it, and says what is
  // missing — by name, since there may be several.
  const validate = () => {
    // A card left blank at the end of a batch is ignored, not an error.
    const named = drafts.filter((d) => d.name.trim());
    if (named.length === 0) {
      setOpenKey(drafts[0]?.key || null);
      Alert.alert('Missing', 'Enter medicine name.');
      return null;
    }
    const seen = new Set();
    for (const d of named) {
      const n = d.name.trim();
      const fail = (msg) => {
        setOpenKey(d.key);
        Alert.alert('Missing', msg);
        return null;
      };
      if (seen.has(n.toLowerCase())) return fail(`${n} is listed twice.`);
      seen.add(n.toLowerCase());
      if (d.times.length === 0) return fail(`Add at least one time for ${n}.`);
      if (d.frequency === 'weekly' && d.daysOfWeek.length === 0)
        return fail(`Pick at least one day for ${n}.`);
    }
    return named;
  };

  // The stored medicine, from one card plus the batch's shared settings.
  // Course dates are resolved HERE, once, rather than stored as a length. A
  // length has to be re-resolved against a start every time it is read, and
  // any disagreement about which day is day 1 silently moves the end.
  const buildMedicine = (d, id) => {
    const courseStart = d.startDate || todayISO();
    return {
      id,
      name: d.name.trim(),
      form: d.form || 'Tablet',
      times: d.times,
      snoozeMinutes,
      frequency: d.frequency,
      daysOfWeek: d.frequency === 'weekly' ? d.daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
      toneId: toneId || 'classic',
      alertGuardian,
      color: d.color || '#FFFFFF',
      photo: d.photo || null,
      startDate: courseStart,
      endDate: d.durationDays == null ? null : addDaysISO(courseStart, d.durationDays - 1),
    };
  };

  const save = async () => {
    const ready = validate();
    if (!ready) return;

    // Guardian request mode: send each medicine as an approval request.
    if (isRequest) {
      setBusy(true);
      try {
        for (const d of ready) {
          const res = await createAddMedicineRequest(requestUserId, buildMedicine(d, undefined));
          if (!res.ok) throw new Error(res.error || 'request failed');
          // Tell them now rather than whenever they next open the app.
          // Best-effort: the request is already saved either way.
          await notifyPatientOfRequest(requestUserId, d.name.trim());
        }
        Alert.alert('Request sent', `Sent to @${requestUsername} for approval.`);
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
        Alert.alert('Permission needed', 'Enable notifications to schedule alarms.');
        return;
      }

      const user = await getSession();

      if (isEdit) {
        await updateMedicine(user, editingId, buildMedicine(ready[0], editingId));
      } else {
        let i = 0;
        for (const d of ready) {
          const id = `${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`;
          await addMedicine(user, buildMedicine(d, id));
          i += 1;
        }
      }

      // Wipe every scheduled notification and re-arm alarms for ALL medicines.
      // Medicines due at the same time share one alarm, so a batch with
      // different schedules still rings once per time.
      const all = await getMedicines(user);
      const idMap = await resyncAlarms(all);
      for (const m of all) {
        await updateMedicine(user, m.id, { notificationIds: idMap[m.id] || [] });
      }

      navigation.goBack();
    } catch (e) {
      Alert.alert('Save failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = () => {
    const name = drafts[0]?.name || '';
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
            await updateMedicine(user, m.id, { notificationIds: idMap[m.id] || [] });
          }
          navigation.goBack();
        },
      },
    ]);
  };

  const batch = !isEdit;
  const count = drafts.filter((d) => d.name.trim()).length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 80 }}
      keyboardShouldPersistTaps="handled"
    >
      {batch ? (
        <>
          <Text style={styles.sectionTitle}>Medicines</Text>
          <Text style={styles.nameHint}>
            Each medicine keeps its own times, days and course. Medicines due at
            the same time share one reminder.
          </Text>
        </>
      ) : null}

      {drafts.map((d, i) => (
        <MedicineDraftCard
          key={d.key}
          draft={d}
          index={i}
          open={d.key === activeKey}
          onOpen={() => setOpenKey(d.key)}
          onChange={(patch) => updateDraft(d.key, patch)}
          onRemove={batch && drafts.length > 1 ? () => removeDraft(d.key) : null}
          showHeader={batch}
        />
      ))}

      {batch ? (
        <TouchableOpacity style={styles.addAnotherBtn} onPress={addAnother}>
          <Text style={styles.addAnotherText}>+ Add another medicine</Text>
        </TouchableOpacity>
      ) : null}

      {batch && drafts.length > 1 ? (
        <Text style={styles.sharedTitle}>For all {drafts.length} medicines</Text>
      ) : null}

      <Text style={styles.label}>Alarm tone</Text>
      <Text style={styles.nameHint}>
        {deviceSoundsAvailable
          ? "Tap to preview and select. Your phone's own alarms and ringtones are listed below the app's."
          : 'Tap a tone to preview and select it.'}
      </Text>
      {soundOptions.map((tone, index) => {
        const selected = toneId === tone.id;
        // One divider where the app's own tones end and the phone's begin,
        // so a long ringtone list does not read as more app tones.
        const startsDeviceSection =
          tone.kind === 'device' && soundOptions[index - 1]?.kind !== 'device';
        return (
          <React.Fragment key={tone.id}>
            {startsDeviceSection ? (
              <Text style={styles.toneSectionLabel}>Sounds on this phone</Text>
            ) : null}
            <TouchableOpacity
              style={[styles.toneOption, selected && styles.toneOptionOn]}
              onPress={() => previewTone(tone)}
            >
              <View style={[styles.toneRadio, selected && styles.toneRadioOn]}>
                {selected && <View style={styles.toneRadioDot} />}
              </View>
              <Text
                style={[styles.toneLabel, selected && styles.toneLabelOn]}
                numberOfLines={1}
              >
                {tone.title}
              </Text>
              {tone.type && tone.type !== 'alarm' ? (
                <Text style={styles.toneType}>{tone.type}</Text>
              ) : null}
              <Text style={styles.tonePlay}>▶</Text>
            </TouchableOpacity>
          </React.Fragment>
        );
      })}

      <Text style={styles.label}>Snooze duration</Text>
      <View style={styles.snoozeRow}>
        {SNOOZE_OPTIONS.map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.snoozeOption, snoozeMinutes === m && styles.snoozeOptionActive]}
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
            : batch && count > 1
            ? `Save all ${count}`
            : 'Save'}
        </Text>
      </TouchableOpacity>

      {isEdit && (
        <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
          <Text style={styles.deleteBtnText}>Delete medicine</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: theme.heading, marginBottom: 4 },
  addAnotherBtn: {
    borderWidth: 1.5,
    borderColor: '#4CAF50',
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  addAnotherText: { color: '#2e7d32', fontWeight: '800', fontSize: 15 },
  sharedTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 18,
  },
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
  toneSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.muted,
    marginTop: 16,
    marginBottom: 6,
  },
  toneType: {
    fontSize: 10.5,
    fontWeight: '700',
    color: theme.muted,
    textTransform: 'uppercase',
    marginRight: 8,
  },
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
  nameChipPhoto: {
    width: 22,
    height: 22,
    borderRadius: 6,
    marginRight: 8,
    backgroundColor: '#cfd8dc',
  },
  photoRow: { flexDirection: 'row', alignItems: 'flex-start' },
  photoPreview: {
    width: 92,
    height: 92,
    borderRadius: 12,
    backgroundColor: '#eceff1',
    marginRight: 14,
  },
  photoEmpty: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoEmptyText: { color: '#aaa', fontSize: 12, textAlign: 'center' },
  photoBtns: { flex: 1 },
  photoBtn: {
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    marginBottom: 8,
  },
  photoBtnText: { color: '#4CAF50', fontWeight: '700', fontSize: 14 },
  photoRemove: {
    color: '#e53935',
    fontSize: 12,
    textDecorationLine: 'underline',
    marginTop: 2,
  },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap' },
  colorItem: { alignItems: 'center', width: 62, marginBottom: 12 },
  colorSwatch: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSwatchSelected: {
    borderWidth: 3,
    borderColor: theme.heading,
    transform: [{ scale: 1.08 }],
  },
  formChipInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  colorGlyph: { fontSize: 20 },
  colorName: { fontSize: 11, color: theme.muted, marginTop: 5, fontWeight: '600' },
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
