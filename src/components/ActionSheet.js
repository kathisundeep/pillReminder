import React from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, radius, shadow } from '../theme';

// A list of choices sliding up from the bottom — what a press-and-hold opens.
// Android's Alert shows at most three buttons, which is one short of
// "Taken / Reschedule / Skip / Cancel".
//
// options: [{ label, onPress, tone: 'danger' | undefined }]
export default function ActionSheet({ visible, title, subtitle, options = [], onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.sheet}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          {options.map((o) => (
            <TouchableOpacity
              key={o.label}
              accessibilityRole="button"
              style={[styles.option, o.tone === 'danger' && styles.optionDanger]}
              onPress={() => {
                onClose();
                o.onPress();
              }}
            >
              <Text style={[styles.optionText, o.tone === 'danger' && styles.optionTextDanger]}>
                {o.label}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.cancel} onPress={onClose} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    gap: 8,
    ...shadow.soft,
  },
  title: { fontSize: 16, fontWeight: '800', color: colors.heading },
  subtitle: { fontSize: 12.5, color: colors.muted, marginBottom: 6 },
  option: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSubtle,
  },
  optionDanger: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  optionText: { fontSize: 15, fontWeight: '700', color: colors.heading },
  optionTextDanger: { color: colors.skipText },
  cancel: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  cancelText: { fontSize: 15, fontWeight: '700', color: colors.muted },
});
