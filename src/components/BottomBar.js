import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme';

// Persistent navigation, from the reference prototype.
//
// These are the destinations the app already has — the bar changes how they are
// reached, not what they do. It replaces a floating button plus a row of cards
// that pushed the actual schedule down the screen.
const ITEMS = [
  { key: 'Home', icon: '🏠', label: 'Home' },
  { key: 'AddMedicine', icon: '➕', label: 'Add' },
  { key: 'Calendar', icon: '🗓', label: 'Calendar' },
  { key: 'Trackers', icon: '📊', label: 'Trackers' },
  { key: 'Settings', icon: '⚙️', label: 'Settings' },
];

export default function BottomBar({ active, onNavigate }) {
  return (
    <View style={styles.bar}>
      {ITEMS.map((item) => {
        const isActive = item.key === active;
        return (
          <TouchableOpacity
            key={item.key}
            style={styles.item}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            onPress={() => (isActive ? null : onNavigate(item.key))}
          >
            <Text style={[styles.icon, !isActive && styles.iconIdle]}>
              {item.icon}
            </Text>
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 66,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  item: { alignItems: 'center', gap: 3, width: '20%' },
  icon: { fontSize: 18 },
  iconIdle: { opacity: 0.55 },
  label: { fontSize: 11, fontWeight: '700', color: colors.muted },
  labelActive: { color: colors.emerald700 },
});
