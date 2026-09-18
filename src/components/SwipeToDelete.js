import React, { useRef } from 'react';
import {
  View,
  Text,
  Animated,
  PanResponder,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';

const REVEAL = 92; // width of the red delete button

// A row that slides left to uncover a red delete button. Pure React Native
// (PanResponder), so it ships in an over-the-air update with no native change.
//
// Only a clearly sideways drag is claimed; anything more vertical is left to
// the list so scrolling is unaffected. The button asks nothing itself —
// `onDelete` is expected to confirm.
export default function SwipeToDelete({ children, onDelete, label }) {
  const x = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const settle = (open) => {
    isOpen.current = open;
    Animated.spring(x, {
      toValue: open ? -REVEAL : 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        const base = isOpen.current ? -REVEAL : 0;
        x.setValue(Math.min(0, Math.max(-REVEAL * 1.3, base + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        const base = isOpen.current ? -REVEAL : 0;
        settle(base + g.dx < -REVEAL / 2);
      },
      onPanResponderTerminate: () => settle(false),
    })
  ).current;

  return (
    <View style={styles.wrap}>
      <View style={styles.behind}>
        <TouchableOpacity
          style={styles.deleteBtn}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${label}`}
          onPress={() => {
            settle(false);
            onDelete();
          }}
        >
          <Text style={styles.deleteIcon}>🗑</Text>
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={[styles.front, { transform: [{ translateX: x }] }]} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  behind: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    backgroundColor: '#dc2626',
  },
  deleteBtn: {
    width: REVEAL,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  deleteIcon: { fontSize: 20 },
  deleteText: { color: '#fff', fontWeight: '800', fontSize: 12.5 },
  // Opaque, so the red only shows where the row has slid away.
  front: { backgroundColor: '#fff' },
});
