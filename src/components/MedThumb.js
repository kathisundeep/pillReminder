import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { photoUri } from '../utils/photo';
import MedIcon from './MedIcon';
import { colors, radius, tintFor } from '../theme';

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

  // The icon itself now carries the colour, so the corner dot that used to
  // stand in for it is gone — it was showing the colour NEXT TO the medicine
  // rather than ON it, which is not how anyone thinks about "the blue one".
  return (
    <View
      style={[
        styles.thumb,
        dimension,
        { backgroundColor: tintFor(med?.color), borderColor: colors.border },
      ]}
    >
      <MedIcon form={med?.form} color={med?.color} size={size * 0.56} />
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
});
