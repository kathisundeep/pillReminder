import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { colors, radius, shadow, statusStyle } from '../theme';

// Explicit status picker for a dose.
//
// This replaces tap-to-cycle. Cycling hid the available states behind repeated
// taps and made "skipped" reachable only by passing through "snoozed" — easy to
// overshoot, and every overshoot writes a real entry to the dose ledger.
// A list you choose from states the options up front and costs one decision.

// "Due" is not a choice: it is what a dose is before it has an answer, not an
// answer itself. Offered here it could not reliably undo a skip or snooze, so
// picking it on a settled slot appeared to do nothing.
export const DOSE_CHOICES = [
  { value: 'taken', label: '✓ Taken' },
  { value: 'snoozed', label: '💤 Snoozed' },
  { value: 'skipped', label: '✕ Skipped' },
];

export default function StatusSelect({ state, onSelect, disabled }) {
  const [open, setOpen] = useState(false);
  const current = statusStyle(state);

  const choose = (value) => {
    setOpen(false);
    if (value !== state) onSelect(value);
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Dose status: ${current.label}. Tap to change.`}
        style={[styles.badge, { backgroundColor: current.bg }]}
      >
        <Text style={[styles.badgeText, { color: current.text }]}>
          {current.label}
        </Text>
        <Text style={[styles.caret, { color: current.text }]}>⌄</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Mark this dose as</Text>
            {DOSE_CHOICES.map((choice) => {
              const s = statusStyle(choice.value);
              const active = choice.value === state;
              return (
                <TouchableOpacity
                  key={choice.value}
                  onPress={() => choose(choice.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.option, active && styles.optionActive]}
                >
                  <View style={[styles.optionSwatch, { backgroundColor: s.bg }]}>
                    <Text style={[styles.optionSwatchText, { color: s.text }]}>
                      {choice.label.split(' ')[0]}
                    </Text>
                  </View>
                  <Text style={styles.optionLabel}>
                    {choice.label.replace(/^\S+\s/, '')}
                  </Text>
                  {active ? <Text style={styles.optionCheck}>●</Text> : null}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={styles.cancel}
              onPress={() => setOpen(false)}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
  },
  badgeText: { fontSize: 12.5, fontWeight: '800' },
  caret: { fontSize: 12, fontWeight: '800', marginTop: -3 },

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    gap: 8,
    ...shadow.soft,
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSubtle,
  },
  optionActive: { borderColor: colors.heading, borderWidth: 1.5 },
  optionSwatch: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSwatchText: { fontSize: 15, fontWeight: '800' },
  optionLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.heading },
  optionCheck: { fontSize: 12, color: colors.heading },
  cancel: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  cancelText: { fontSize: 15, fontWeight: '700', color: colors.muted },
});
