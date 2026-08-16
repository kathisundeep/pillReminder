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
  Image,
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
import MedIcon from '../components/MedIcon';
import { createAddMedicineRequest } from '../utils/guardianCloud';
import { notifyPatientOfRequest } from '../utils/guardian';
import {
  takeMedicinePhoto,
  pickMedicinePhoto,
  photoUri,
  photoSizeLabel,
} from '../utils/photo';
import { formatTime } from '../utils/doseState';
import {
  listSoundOptions,
  canUseDeviceSounds,
  rememberDeviceSound,
} from '../utils/sounds';
import {
  MED_FORMS,
  MED_COLORS,
  formFor,
  tintFor,
  colors as theme,
} from '../theme';

const TONE_SOURCES = {
  alarm: require('../../assets/sounds/alarm.wav'),
  chime: require('../../assets/sounds/chime.wav'),
  bell: require('../../assets/sounds/bell.wav'),
  siren: require('../../assets/sounds/siren.wav'),
  gentle: require('../../assets/sounds/gentle.wav'),
};

const SNOOZE_OPTIONS = [5, 10, 15, 30];

const FORM_OPTIONS = MED_FORMS;



// "Twice a day" is how a prescription is written and how people think, so it
// is offered as a starting point that fills in sensible times. They stay fully
// editable afterwards — this sets the times, it does not lock them.
const DOSES_PER_DAY = [
  { n: 1, label: 'Once', times: ['09:00'] },
  { n: 2, label: 'Twice', times: ['09:00', '21:00'] },
  { n: 3, label: '3 times', times: ['08:00', '14:00', '20:00'] },
  { n: 4, label: '4 times', times: ['08:00', '12:00', '16:00', '20:00'] },
];

// A course length, as a doctor states it. `days` null means ongoing.
const DURATIONS = [
  { days: null, label: 'Ongoing' },
  { days: 3, label: '3 days' },
  { days: 5, label: '5 days' },
  { days: 7, label: '1 week' },
  { days: 10, label: '10 days' },
  { days: 15, label: '15 days' },
  { days: 30, label: '1 month' },
];

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
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
  const [durationDays, setDurationDays] = useState(null); // null = ongoing
  const [startDate, setStartDate] = useState(null);
  const [daysOfWeek, setDaysOfWeek] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerInitial, setPickerInitial] = useState({ hour: 8, minute: 0 });
  const [busy, setBusy] = useState(false);
  const [originalNotifIds, setOriginalNotifIds] = useState([]);
  const [form, setForm] = useState('Tablet');
  const [toneId, setToneId] = useState('classic');
  const [soundOptions] = useState(() => listSoundOptions());
  const [deviceSoundsAvailable] = useState(() => canUseDeviceSounds());
  const previewRef = React.useRef(null);
  const [alertGuardian, setAlertGuardian] = useState(true);
  const [color, setColor] = useState('#FFFFFF');
  const [photo, setPhoto] = useState(null);       // base64 JPEG or null
  const [photoBusy, setPhotoBusy] = useState(false);

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
      setStartDate(med.startDate || null);
      // Shown back as a length rather than a raw date: that is how it was
      // entered, and how the prescription reads.
      if (med.startDate && med.endDate) {
        const from = new Date(`${med.startDate}T00:00:00`);
        const to = new Date(`${med.endDate}T00:00:00`);
        setDurationDays(Math.round((to - from) / 86400000) + 1);
      } else {
        setDurationDays(null);
      }
      setDaysOfWeek(med.daysOfWeek || []);
      setOriginalNotifIds(med.notificationIds || []);
      setToneId(med.toneId || 'classic');
      setForm(med.form || 'Tablet');
      setAlertGuardian(med.alertGuardian !== false);
      setColor(med.color || '#FFFFFF');
      setPhoto(med.photo || null);
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

  const addName = () => {
    const n = nameInput.trim();
    if (!n) return;
    if (!names.some((x) => x.name === n))
      setNames([
        ...names,
        // The form is captured PER medicine. It used to be read from state at
        // save time, so adding a tablet, a capsule and a syrup to one schedule
        // saved three of whatever was selected last.
        { name: n, form: form || 'Tablet', color: color || '#FFFFFF', photo },
      ]);
    setNameInput('');
    // A photo belongs to one specific medicine, so don't carry it over to the
    // next one added to this schedule (the colour intentionally does carry).
    setPhoto(null);
  };
  const removeName = (n) => setNames(names.filter((x) => x.name !== n));

  // Capture/pick, then compress down to ~9 KB before it ever touches state.
  const grabPhoto = async (source) => {
    setPhotoBusy(true);
    try {
      const res =
        source === 'camera'
          ? await takeMedicinePhoto()
          : await pickMedicinePhoto();
      if (res.ok && res.photo) setPhoto(res.photo);
      else if (res.error) Alert.alert('Photo unavailable', res.error);
    } catch (e) {
      Alert.alert('Photo failed', String(e?.message || e));
    } finally {
      setPhotoBusy(false);
    }
  };

  const save = async () => {
    // Collect medicine name(s) with their colour. Edit mode is a single
    // medicine; create mode can batch several that share this schedule.
    let entries; // [{ name, color, photo }]
    if (isEdit) {
      if (!name.trim()) return Alert.alert('Missing', 'Enter medicine name.');
      entries = [{ name: name.trim(), form: form || 'Tablet', color: color || '#FFFFFF', photo }];
    } else {
      const pending = nameInput.trim();
      entries = [...names];
      if (pending && !entries.some((e) => e.name === pending))
        entries.push({ name: pending, form: form || 'Tablet', color: color || '#FFFFFF', photo });
      if (entries.length === 0)
        return Alert.alert('Missing', 'Add at least one medicine name.');
    }
    if (times.length === 0)
      return Alert.alert('Missing', 'Add at least one time.');
    if (frequency === 'weekly' && daysOfWeek.length === 0)
      return Alert.alert('Missing', 'Pick at least one day.');

    const sharedDays =
      frequency === 'weekly' ? daysOfWeek : [0, 1, 2, 3, 4, 5, 6];

    // Resolved to dates HERE, once, rather than stored as a length. A length
    // has to be re-resolved against a start every time it is read, and any
    // disagreement about which day is day 1 silently moves the end.
    const courseStart = startDate || todayISO();
    const courseEnd =
      durationDays == null ? null : addDaysISO(courseStart, durationDays - 1);
    const buildDraft = (id, medName, medColor, medPhoto, medForm) => ({
      id,
      name: medName,
      form: medForm || form || 'Tablet',
      times,
      snoozeMinutes,
      frequency,
      daysOfWeek: sharedDays,
      toneId: toneId || 'classic',
      alertGuardian,
      color: medColor || '#FFFFFF',
      photo: medPhoto || null,
      startDate: courseStart,
      endDate: courseEnd,
    });

    // Guardian request mode: send each medicine as an approval request.
    if (isRequest) {
      setBusy(true);
      try {
        for (const e of entries) {
          const res = await createAddMedicineRequest(
            requestUserId,
            buildDraft(undefined, e.name, e.color, e.photo, e.form)
          );
          if (!res.ok) throw new Error(res.error || 'request failed');
          // Tell them now rather than whenever they next open the app.
          // Best-effort: the request is already saved either way.
          await notifyPatientOfRequest(requestUserId, e.name);
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
          buildDraft(
            editingId,
            entries[0].name,
            entries[0].color,
            entries[0].photo,
            entries[0].form
          )
        );
      } else {
        let i = 0;
        for (const e of entries) {
          const id = `${Date.now()}_${i}_${Math.random()
            .toString(36)
            .slice(2, 7)}`;
          await addMedicine(user, buildDraft(id, e.name, e.color, e.photo, e.form));
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
                  {n.photo ? (
                    <Image
                      source={{ uri: photoUri(n.photo) }}
                      style={styles.nameChipPhoto}
                    />
                  ) : null}
                  {/* The chip shows the form it was added with, so a batch of
                      three medicines visibly reads as tablet / capsule / syrup
                      rather than as three identical names. */}
                  {!n.photo ? (
                    <MedIcon form={n.form} color={n.color} size={16} />
                  ) : null}
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
              <View style={styles.formChipInner}>
                <MedIcon form={f.id} color={color || '#FFFFFF'} size={18} />
                <Text style={[styles.quickChipText, on && styles.quickChipTextOn]}>
                  {f.label}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Colour</Text>
      <Text style={styles.nameHint}>
        {isEdit
          ? 'How this medicine is shown in your list and on the alarm.'
          : 'Pick a colour, then add the medicine above — each medicine keeps its own colour.'}
      </Text>
      <View style={styles.colorRow}>
        {MED_COLORS.map((c) => {
          const selected = color === c.hex;
          return (
            <TouchableOpacity
              key={c.hex}
              onPress={() => setColor(c.hex)}
              style={styles.colorItem}
              accessibilityRole="button"
              accessibilityLabel={`${c.name} ${formFor(form).label}`}
              accessibilityState={{ selected }}
            >
              {/* The swatch previews the actual medicine: the form decides the
                  glyph, the colour is the user's coding. */}
              <View
                style={[
                  styles.colorSwatch,
                  { backgroundColor: tintFor(c.hex), borderColor: c.hex },
                  selected && styles.colorSwatchSelected,
                ]}
              >
                <MedIcon form={form} color={c.hex} size={22} />
              </View>
              <Text style={styles.colorName}>{c.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Photo (optional)</Text>
      <Text style={styles.nameHint}>
        {isEdit
          ? 'A picture of the tablet, strip or bottle — shown when the alarm rings so it is easy to pick the right one.'
          : 'A picture of the tablet, strip or bottle — shown when the alarm rings. Attach it before adding the medicine above; each medicine keeps its own photo.'}
      </Text>
      <View style={styles.photoRow}>
        {photo ? (
          <Image source={{ uri: photoUri(photo) }} style={styles.photoPreview} />
        ) : (
          <View style={[styles.photoPreview, styles.photoEmpty]}>
            <Text style={styles.photoEmptyText}>No{'\n'}photo</Text>
          </View>
        )}
        <View style={styles.photoBtns}>
          <TouchableOpacity
            style={styles.photoBtn}
            onPress={() => grabPhoto('camera')}
            disabled={photoBusy}
          >
            <Text style={styles.photoBtnText}>
              {photoBusy ? 'Working…' : '📷  Take a photo'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.photoBtn}
            onPress={() => grabPhoto('library')}
            disabled={photoBusy}
          >
            <Text style={styles.photoBtnText}>🖼  Choose from gallery</Text>
          </TouchableOpacity>
          {photo ? (
            <TouchableOpacity onPress={() => setPhoto(null)}>
              <Text style={styles.photoRemove}>
                Remove photo · {photoSizeLabel(photo)}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <Text style={styles.label}>How many times a day?</Text>
      <Text style={styles.nameHint}>
        Sets the times below — you can still change any of them.
      </Text>
      <View style={styles.timesWrap}>
        {DOSES_PER_DAY.map((d) => {
          const on = times.length === d.n;
          return (
            <TouchableOpacity
              key={d.n}
              style={[styles.quickChip, on && styles.quickChipOn]}
              onPress={() => setTimes(d.times)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.quickChipText, on && styles.quickChipTextOn]}>
                {d.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>How long?</Text>
      <Text style={styles.nameHint}>
        {durationDays == null
          ? 'Ongoing — no planned end date.'
          : `${durationDays} days, ending ${new Date(
              addDaysISO(startDate || todayISO(), durationDays - 1) + 'T00:00:00'
            ).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}. Alarms stop by themselves.`}
      </Text>
      <View style={styles.timesWrap}>
        {DURATIONS.map((d) => {
          const on = durationDays === d.days;
          return (
            <TouchableOpacity
              key={String(d.days)}
              style={[styles.quickChip, on && styles.quickChipOn]}
              onPress={() => setDurationDays(d.days)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.quickChipText, on && styles.quickChipTextOn]}>
                {d.label}
              </Text>
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
