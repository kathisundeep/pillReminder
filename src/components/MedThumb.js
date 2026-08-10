import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { photoUri } from '../utils/photo';
import { colors, radius, formFor, tintFor } from '../theme';

// How a medicine is represented everywhere: its photo if there is one,
// otherwise the icon for its FORM washed in its chosen colour.
//
// The form decides the glyph — a syrup should never show as a tablet — and the
// colour is the user's own coding, which is how many people actually tell their
// medicines apart.
export default function MedThumb({ med, size = 48 }) {
  const dimension = { width: size, height: size, borderRadius: radius.thumb };

  if (med?.photo) {
    return (
      <Image
        source={{ uri: photoUri(med.photo) }}
        style={[
          styles.thumb,
          dimension,
          { borderColor: med.color || colors.border, borderWidth: 2 },
        ]}
      />
    );
  }

  const form = formFor(med?.form);
  return (
    <View
      style={[
        styles.thumb,
        dimension,
        { backgroundColor: tintFor(med?.color), borderColor: colors.border },
      ]}
    >
      <Text style={{ fontSize: size * 0.44 }}>{form.icon}</Text>
      <View
        style={[
          styles.colorDot,
          { backgroundColor: med?.color || colors.border },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  colorDot: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
});
