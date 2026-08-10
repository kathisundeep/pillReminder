import React from 'react';
import { View } from 'react-native';
import { edgeFor, detailFor, isLight, shade, colors } from '../theme';

// The medicine's form, drawn in the medicine's own colour.
//
// This replaces an emoji per form, which had two problems the user hit
// immediately: 💊 was used for BOTH tablet and capsule, so the two were
// indistinguishable, and an emoji cannot be tinted — the chosen colour could
// only be shown as a small dot in the corner, which is not what "this one is
// the blue one" means to anyone.
//
// Drawn with plain Views rather than SVG deliberately: react-native-svg is a
// native dependency, and adding one means a new APK and a reinstall for every
// user. These shapes are simple enough that borderRadius does the job, so the
// fix ships over the air.
//
// Every shape is built from a `size` so the whole set scales together, and
// takes its edge and detail colours from the fill, so a white tablet still has
// a visible outline against a white card.

function Tablet({ size, color, edge, detail }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2, // round: the defining feature vs a capsule
        backgroundColor: color,
        borderWidth: Math.max(1, size * 0.06),
        borderColor: edge,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* The score line down the middle, as on a real breakable tablet. */}
      <View
        style={{
          width: Math.max(1, size * 0.07),
          height: size,
          backgroundColor: detail,
          opacity: 0.55,
        }}
      />
    </View>
  );
}

function Capsule({ size, color, edge, detail }) {
  const width = size;
  const height = size * 0.62; // elongated: the defining feature vs a tablet
  return (
    <View
      style={{
        width,
        height,
        borderRadius: height / 2,
        borderWidth: Math.max(1, size * 0.055),
        borderColor: edge,
        flexDirection: 'row',
        overflow: 'hidden',
      }}
    >
      {/* Two halves, as capsules actually are — the join is what reads as
          "capsule" at small sizes even before the shape does. */}
      <View style={{ flex: 1, backgroundColor: color }} />
      <View style={{ width: Math.max(1, size * 0.05), backgroundColor: edge, opacity: 0.6 }} />
      <View style={{ flex: 1, backgroundColor: shade(color, isLight(color) ? -0.18 : 0.3) }} />
    </View>
  );
}

function Syrup({ size, color, edge, detail }) {
  const bodyW = size * 0.62;
  return (
    <View style={{ alignItems: 'center', justifyContent: 'flex-end', height: size }}>
      {/* cap */}
      <View
        style={{
          width: bodyW * 0.42,
          height: size * 0.13,
          backgroundColor: edge,
          borderTopLeftRadius: 2,
          borderTopRightRadius: 2,
        }}
      />
      {/* neck */}
      <View style={{ width: bodyW * 0.3, height: size * 0.1, backgroundColor: detail, opacity: 0.5 }} />
      {/* bottle, filled to about two-thirds with the colour */}
      <View
        style={{
          width: bodyW,
          height: size * 0.62,
          borderRadius: size * 0.12,
          borderWidth: Math.max(1, size * 0.055),
          borderColor: edge,
          backgroundColor: colors.surface,
          overflow: 'hidden',
          justifyContent: 'flex-end',
        }}
      >
        <View style={{ height: '68%', backgroundColor: color }} />
      </View>
    </View>
  );
}

function Injection({ size, color, edge, detail }) {
  return (
    <View style={{ width: size, height: size, justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {/* plunger */}
        <View style={{ width: size * 0.12, height: size * 0.34, backgroundColor: edge, borderRadius: 2 }} />
        {/* barrel, holding the colour */}
        <View
          style={{
            width: size * 0.5,
            height: size * 0.4,
            backgroundColor: color,
            borderWidth: Math.max(1, size * 0.05),
            borderColor: edge,
            borderRadius: 3,
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {/* graduation marks */}
          <View style={{ height: 1, backgroundColor: detail, opacity: 0.6, marginLeft: '30%' }} />
          <View style={{ height: 1, backgroundColor: detail, opacity: 0.6, marginTop: size * 0.07, marginLeft: '30%' }} />
        </View>
        {/* needle */}
        <View style={{ width: size * 0.28, height: Math.max(1, size * 0.06), backgroundColor: edge }} />
      </View>
    </View>
  );
}

function Drops({ size, color, edge }) {
  const d = size * 0.78;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* A droplet is a square with three round corners and one sharp one,
          rotated 45° so the point sits at the top. */}
      <View
        style={{
          width: d,
          height: d,
          backgroundColor: color,
          borderWidth: Math.max(1, size * 0.05),
          borderColor: edge,
          borderTopLeftRadius: d / 2,
          borderTopRightRadius: d / 2,
          borderBottomRightRadius: d / 2,
          borderBottomLeftRadius: 2,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

const SHAPES = {
  Tablet,
  Capsule,
  Syrup,
  Injection,
  Drops,
};

export default function MedIcon({ form, color, size = 28, testID }) {
  const fill = color || '#FFFFFF';
  const name = SHAPES[form] ? form : 'Tablet';
  const Shape = SHAPES[name];
  return (
    <View
      testID={testID || `med-icon-${name}`}
      // The colour is part of what identifies a medicine, so it belongs in the
      // label too — a screen reader user picks "the blue one" the same way.
      accessibilityLabel={`${name} icon${color ? `, ${color}` : ''}`}
      style={{ alignItems: 'center', justifyContent: 'center' }}
    >
      <Shape
        size={size}
        color={fill}
        edge={edgeFor(fill)}
        detail={detailFor(fill)}
      />
    </View>
  );
}

export { SHAPES };
