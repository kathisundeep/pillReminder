import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

const LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function DaysSelector({ value = [], onChange }) {
  const toggle = (i) => {
    if (value.includes(i)) onChange(value.filter((d) => d !== i));
    else onChange([...value, i].sort());
  };

  return (
    <View style={styles.row}>
      {LABELS.map((lbl, i) => {
        const active = value.includes(i);
        return (
          <TouchableOpacity
            key={i}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => toggle(i)}
          >
            <Text style={[styles.txt, active && styles.txtActive]}>{lbl}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  pill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: '#bbb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  txt: { color: '#555', fontWeight: '600' },
  txtActive: { color: '#fff' },
});
