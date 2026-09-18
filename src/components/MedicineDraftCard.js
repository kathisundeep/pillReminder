import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
} from 'react-native';
import WheelTimePicker from './WheelTimePicker';
import DaysSelector from './DaysSelector';
import MedIcon from './MedIcon';
import {
  takeMedicinePhoto,
  pickMedicinePhoto,
  photoUri,
  photoSizeLabel,
} from '../utils/photo';
import { formatTime } from '../utils/doseState';
import {
  DOSES_PER_DAY,
  DURATIONS,
  todayISO,
  addDaysISO,
  durationLabel,
  daysLabel,
} from '../utils/course';
import { MED_FORMS, MED_COLORS, formFor, tintFor, colors as theme } from '../theme';

function pad(n) {
  return String(n).padStart(2, '0');
}

// One medicine being added or edited: its own name, look and schedule.
//
// Each medicine in a batch gets its own card, so "A three times a day, B once,
// C twice" is one trip through the screen rather than three. Only the card
// being edited is open; the rest fold to a one-line summary.
export function draftSummary(draft) {
  const parts = [formFor(draft.form).label];
  parts.push(draft.times.length ? draft.times.map(formatTime).join(', ') : 'No times yet');
  parts.push(daysLabel(draft.frequency, draft.daysOfWeek));
  parts.push(durationLabel(draft.durationDays));
  return parts.join(' · ');
}

export default function MedicineDraftCard({
  draft,
  index,
  open,
  onOpen,
  onChange,
  onRemove,
  showHeader,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerInitial, setPickerInitial] = useState({ hour: 8, minute: 0 });
  const [photoBusy, setPhotoBusy] = useState(false);
  const title = draft.name.trim() || `Medicine ${index + 1}`;

  if (!open) {
    return (
      <View style={styles.folded}>
        <TouchableOpacity
          style={styles.foldedMain}
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${title}`}
        >
          {draft.photo ? (
            <Image source={{ uri: photoUri(draft.photo) }} style={styles.foldedPhoto} />
          ) : (
            <View style={[styles.foldedIcon, { backgroundColor: tintFor(draft.color) }]}>
              <MedIcon form={draft.form} color={draft.color} size={20} />
            </View>
          )}
          <View style={styles.foldedText}>
            <Text style={styles.foldedName} numberOfLines={1}>{title}</Text>
            <Text style={styles.foldedMeta} numberOfLines={2}>{draftSummary(draft)}</Text>
          </View>
        </TouchableOpacity>
        {onRemove ? (
          <TouchableOpacity
            onPress={onRemove}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${title}`}
          >
            <Text style={styles.remove}>×</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  const set = (patch) => onChange(patch);

  const openPicker = () => {
    const now = new Date();
    setPickerInitial({ hour: now.getHours(), minute: now.getMinutes() });
    setPickerOpen(true);
  };

  const onPickerConfirm = ({ hour, minute }) => {
    const hhmm = `${pad(hour)}:${pad(minute)}`;
    if (!draft.times.includes(hhmm)) set({ times: [...draft.times, hhmm].sort() });
    setPickerOpen(false);
  };

  // Capture/pick, then compress down to ~9 KB before it ever touches state.
  const grabPhoto = async (source) => {
    setPhotoBusy(true);
    try {
      const res = source === 'camera' ? await takeMedicinePhoto() : await pickMedicinePhoto();
      if (res.ok && res.photo) set({ photo: res.photo });
      else if (res.error) Alert.alert('Photo unavailable', res.error);
    } catch (e) {
      Alert.alert('Photo failed', String(e?.message || e));
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <View style={[showHeader && styles.card]}>
      {showHeader ? (
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>{title}</Text>
          {onRemove ? (
            <TouchableOpacity
              onPress={onRemove}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${title}`}
            >
              <Text style={styles.remove}>×</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.label}>Medicine name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Paracetamol 500mg"
        value={draft.name}
        onChangeText={(name) => set({ name })}
      />

      <Text style={styles.label}>Type</Text>
      <View style={styles.wrap}>
        {MED_FORMS.map((f) => {
          const on = draft.form === f.id;
          return (
            <TouchableOpacity
              key={f.id}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => set({ form: f.id })}
            >
              <View style={styles.formChipInner}>
                <MedIcon form={f.id} color={draft.color || '#FFFFFF'} size={18} />
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Colour</Text>
      <Text style={styles.hint}>How this medicine is shown in your list and on the alarm.</Text>
      <View style={styles.colorRow}>
        {MED_COLORS.map((c) => {
          const selected = draft.color === c.hex;
          return (
            <TouchableOpacity
              key={c.hex}
              onPress={() => set({ color: c.hex })}
              style={styles.colorItem}
              accessibilityRole="button"
              accessibilityLabel={`${c.name} ${formFor(draft.form).label}`}
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
                <MedIcon form={draft.form} color={c.hex} size={22} />
              </View>
              <Text style={styles.colorName}>{c.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Photo (optional)</Text>
      <Text style={styles.hint}>
        A picture of the tablet, strip or bottle — shown when the alarm rings so it
        is easy to pick the right one.
      </Text>
      <View style={styles.photoRow}>
        {draft.photo ? (
          <Image source={{ uri: photoUri(draft.photo) }} style={styles.photoPreview} />
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
          {draft.photo ? (
            <TouchableOpacity onPress={() => set({ photo: null })}>
              <Text style={styles.photoRemove}>
                Remove photo · {photoSizeLabel(draft.photo)}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <Text style={styles.label}>How many times a day?</Text>
      <Text style={styles.hint}>Sets the times below — you can still change any of them.</Text>
      <View style={styles.wrap}>
        {DOSES_PER_DAY.map((d) => {
          const on = draft.times.length === d.n;
          return (
            <TouchableOpacity
              key={d.n}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => set({ times: d.times })}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{d.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Times</Text>
      <View style={styles.wrap}>
        {draft.times.map((t) => (
          <TouchableOpacity
            key={t}
            style={styles.timeChip}
            onPress={() => set({ times: draft.times.filter((x) => x !== t) })}
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
        {[
          ['daily', 'Daily'],
          ['weekly', 'Specific days'],
        ].map(([value, label]) => {
          const on = draft.frequency === value;
          return (
            <TouchableOpacity
              key={value}
              style={[styles.segmentItem, on && styles.segmentItemActive]}
              onPress={() => set({ frequency: value })}
            >
              <Text style={[styles.segmentText, on && styles.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {draft.frequency === 'weekly' && (
        <DaysSelector value={draft.daysOfWeek} onChange={(daysOfWeek) => set({ daysOfWeek })} />
      )}

      <Text style={styles.label}>How long?</Text>
      <Text style={styles.hint}>
        {draft.durationDays == null
          ? 'Ongoing — no planned end date.'
          : `${draft.durationDays} days, ending ${new Date(
              addDaysISO(draft.startDate || todayISO(), draft.durationDays - 1) + 'T00:00:00'
            ).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}. Alarms stop by themselves.`}
      </Text>
      <View style={styles.wrap}>
        {DURATIONS.map((d) => {
          const on = draft.durationDays === d.days;
          return (
            <TouchableOpacity
              key={String(d.days)}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => set({ durationDays: d.days })}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{d.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <WheelTimePicker
        visible={pickerOpen}
        initialHour={pickerInitial.hour}
        initialMinute={pickerInitial.minute}
        onCancel={() => setPickerOpen(false)}
        onConfirm={onPickerConfirm}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderColor: '#4CAF50',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: theme.heading },
  remove: { fontSize: 22, fontWeight: '700', color: theme.muted, paddingHorizontal: 6 },

  folded: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#fafafa',
  },
  foldedMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  foldedIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foldedPhoto: { width: 40, height: 40, borderRadius: 12 },
  foldedText: { flex: 1 },
  foldedName: { fontSize: 15, fontWeight: '800', color: theme.heading },
  foldedMeta: { fontSize: 12, color: theme.muted, marginTop: 2 },

  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  hint: { fontSize: 12, color: '#888', marginBottom: 10, lineHeight: 17 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderColor: '#bbb',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginRight: 8,
    marginBottom: 8,
  },
  chipOn: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  chipText: { color: '#555', fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: '#fff' },
  formChipInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },

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
  colorName: { fontSize: 11, color: theme.muted, marginTop: 5, fontWeight: '600' },

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
});
