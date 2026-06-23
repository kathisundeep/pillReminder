import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
} from 'react-native';

const ITEM_HEIGHT = 44;
const VISIBLE = 5;
const PAD = ((VISIBLE - 1) / 2) * ITEM_HEIGHT;

function Column({ items, initialIndex, onChange, formatter, width }) {
  const ref = useRef(null);
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.scrollTo({ y: initialIndex * ITEM_HEIGHT, animated: false });
    }, 50);
    return () => clearTimeout(t);
  }, []);

  const handleEnd = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const i = Math.round(y / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(items.length - 1, i));
    setActiveIndex(clamped);
    onChange(clamped);
  };

  return (
    <View style={{ width, height: VISIBLE * ITEM_HEIGHT }}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: PAD }}
        onMomentumScrollEnd={handleEnd}
        onScrollEndDrag={handleEnd}
      >
        {items.map((it, i) => {
          const isActive = i === activeIndex;
          return (
            <View key={i} style={styles.item}>
              <Text style={[styles.itemText, isActive && styles.itemTextActive]}>
                {formatter ? formatter(it) : it}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function WheelTimePicker({
  visible,
  initialHour = 8,
  initialMinute = 0,
  onCancel,
  onConfirm,
}) {
  const initIsPM = initialHour >= 12;
  const initH12 = initialHour % 12 === 0 ? 12 : initialHour % 12;

  const stateRef = useRef({
    h12: initH12,
    minute: initialMinute,
    isPM: initIsPM,
  });

  useEffect(() => {
    if (visible) {
      stateRef.current = {
        h12: initialHour % 12 === 0 ? 12 : initialHour % 12,
        minute: initialMinute,
        isPM: initialHour >= 12,
      };
    }
  }, [visible, initialHour, initialMinute]);

  const confirm = () => {
    const { h12, minute, isPM } = stateRef.current;
    const hour24 = isPM
      ? h12 === 12
        ? 12
        : h12 + 12
      : h12 === 12
      ? 0
      : h12;
    onConfirm({ hour: hour24, minute });
  };

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Pick time</Text>

          <View style={styles.wheelRow}>
            <View pointerEvents="none" style={styles.highlight} />

            <Column
              items={Array.from({ length: 12 }, (_, i) => i + 1)}
              initialIndex={initH12 - 1}
              onChange={(i) => {
                stateRef.current.h12 = i + 1;
              }}
              width={70}
            />
            <Text style={styles.sep}>:</Text>
            <Column
              items={Array.from({ length: 60 }, (_, i) => i)}
              initialIndex={initialMinute}
              formatter={(n) => String(n).padStart(2, '0')}
              onChange={(i) => {
                stateRef.current.minute = i;
              }}
              width={70}
            />
            <Column
              items={['AM', 'PM']}
              initialIndex={initIsPM ? 1 : 0}
              onChange={(i) => {
                stateRef.current.isPM = i === 1;
              }}
              width={70}
            />
          </View>

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.btnGhost} onPress={onCancel}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnPrimary} onPress={confirm}>
              <Text style={styles.btnPrimaryText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    color: '#222',
    marginBottom: 8,
  },
  wheelRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    paddingVertical: 8,
  },
  highlight: {
    position: 'absolute',
    top: PAD + 8,
    left: 8,
    right: 8,
    height: ITEM_HEIGHT,
    backgroundColor: '#f1f5f1',
    borderRadius: 10,
  },
  item: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemText: { fontSize: 24, color: '#bbb', fontVariant: ['tabular-nums'] },
  itemTextActive: { color: '#222', fontWeight: '700' },
  sep: {
    fontSize: 28,
    fontWeight: '700',
    color: '#222',
    marginHorizontal: 2,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  btnGhost: {
    flex: 1,
    padding: 14,
    marginRight: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
  },
  btnGhostText: { color: '#444', fontWeight: '600' },
  btnPrimary: {
    flex: 1,
    padding: 14,
    marginLeft: 8,
    borderRadius: 10,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
});
