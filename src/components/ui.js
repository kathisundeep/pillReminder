import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  colors,
  radius,
  shadow,
  type,
  brandFor,
  statusStyle,
} from '../theme';

// Shared UI, ported from the reference prototype. Screens compose these rather
// than re-declaring padding and colour, so a change to the design system lands
// everywhere at once.

// ---------------------------------------------------------------------------
export function Screen({ children, style }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Content({ children, style, contentContainerStyle, scroll = true, ...rest }) {
  if (!scroll) {
    return <View style={[styles.content, style]}>{children}</View>;
  }
  return (
    <ScrollView
      style={[styles.contentScroll, style]}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
export function Avatar({ name, role = 'patient', size = 44 }) {
  const brand = brandFor(role);
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <LinearGradient
      colors={brand.avatarGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        shadow.button(brand.tint),
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>{initial}</Text>
    </LinearGradient>
  );
}

export function IconButton({ label, onPress, badge = false, accessibilityLabel }) {
  return (
    <TouchableOpacity
      style={styles.iconBtn}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
    >
      <Text style={styles.iconBtnText}>{label}</Text>
      {badge ? <View style={styles.notifBadge} /> : null}
    </TouchableOpacity>
  );
}

// Header with an avatar + name, as on the reference Home and Guardian screens.
export function ProfileHeader({ name, subtitle, role = 'patient', right }) {
  const brand = brandFor(role);
  return (
    <View
      style={[
        styles.appHeader,
        role === 'guardian' && { borderBottomWidth: 2, borderBottomColor: brand.tint },
      ]}
    >
      <View style={styles.profileRow}>
        <Avatar name={name} role={role} />
        <View>
          <Text style={styles.userTitle}>{name || ''}</Text>
          {subtitle ? (
            <Text
              style={[
                styles.userSub,
                role === 'guardian' && { color: brand.tint },
              ]}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {right}
    </View>
  );
}

// Header for a screen pushed on top of another, with a close affordance.
export function TitleHeader({ title, onClose, right }) {
  return (
    <View style={styles.appHeader}>
      <Text style={styles.userTitle}>{title}</Text>
      {right || (onClose ? <IconButton label="✕" onPress={onClose} accessibilityLabel="Close" /> : null)}
    </View>
  );
}

// ---------------------------------------------------------------------------
export function Card({ children, style, highlighted, role = 'patient' }) {
  const brand = brandFor(role);
  return (
    <View
      style={[
        styles.card,
        highlighted && { borderWidth: 2, borderColor: brand.tint },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function CardTitle({ children, style }) {
  return <Text style={[styles.cardTitle, style]}>{children}</Text>;
}

export function CardSubtitle({ children, style }) {
  return <Text style={[styles.cardSubtitle, style]}>{children}</Text>;
}

export function SectionLabel({ children, right }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionLabel}>{children}</Text>
      {right}
    </View>
  );
}

export function Pill({ children, bg, color, style }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }, style]}>
      <Text style={[styles.pillText, { color }]}>{children}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
export function Button({
  title,
  onPress,
  variant = 'primary',
  role = 'patient',
  disabled,
  style,
  textStyle,
  ...rest
}) {
  const brand = brandFor(role);

  if (variant === 'primary') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        style={[disabled && styles.disabled, style]}
        {...rest}
      >
        <LinearGradient
          colors={brand.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.btn, shadow.button(brand.tintDark)]}
        >
          <Text style={[styles.btnTextOn, textStyle]}>{title}</Text>
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  const variantStyle =
    variant === 'danger'
      ? styles.btnDanger
      : variant === 'ghost'
      ? styles.btnGhost
      : styles.btnNeutral;
  const variantText =
    variant === 'danger'
      ? styles.btnTextOn
      : variant === 'ghost'
      ? [styles.btnTextNeutral, { color: colors.white }]
      : styles.btnTextNeutral;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[styles.btn, variantStyle, disabled && styles.disabled, style]}
      {...rest}
    >
      <Text style={[variantText, textStyle]}>{title}</Text>
    </TouchableOpacity>
  );
}

// A row of buttons that share the width.
export function ButtonRow({ children, style }) {
  return <View style={[styles.buttonRow, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
export function Field({ label, children, style }) {
  return (
    <View style={[styles.formGroup, style]}>
      {label ? <Text style={styles.formLabel}>{label}</Text> : null}
      {children}
    </View>
  );
}

export const Input = React.forwardRef(({ style, ...props }, ref) => (
  <TextInput
    ref={ref}
    placeholderTextColor={colors.muted}
    style={[styles.input, style]}
    {...props}
  />
));

export function ChipGroup({ children, style }) {
  return <View style={[styles.chipGrid, style]}>{children}</View>;
}

export function Chip({ label, active, onPress, role = 'patient', style }) {
  const brand = brandFor(role);
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={[
        styles.chip,
        active && { backgroundColor: brand.tint, borderColor: brand.tint },
        active && shadow.button(brand.tint),
        style,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Segmented control — the reference's role toggle and range selector.
export function Segmented({ options, value, onChange, style }) {
  return (
    <View style={[styles.segmented, style]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function Swatch({ color, selected, onPress, accessibilityLabel }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: !!selected }}
      style={[
        styles.swatch,
        { backgroundColor: color },
        selected && styles.swatchSelected,
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
export function Banner({ icon = '📩', title, body, onDismiss, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.8 : 1}
      onPress={onPress}
      style={styles.banner}
    >
      <Text style={styles.bannerIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        {title ? <Text style={styles.bannerTitle}>{title}</Text> : null}
        {body ? <Text style={styles.bannerBody}>{body}</Text> : null}
      </View>
      {onDismiss ? (
        <TouchableOpacity onPress={onDismiss} accessibilityLabel="Dismiss">
          <Text style={styles.bannerClose}>✕</Text>
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

export function StatusBadge({ state, label, onPress }) {
  const s = statusStyle(state);
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={[styles.statusBadge, { backgroundColor: s.bg }]}
    >
      <Text style={[styles.statusText, { color: s.text }]}>{label || s.label}</Text>
    </Wrapper>
  );
}

export function EmptyState({ icon = '🗓', title, body }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  contentScroll: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 32 },

  appHeader: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.white, fontWeight: '800' },
  userTitle: { fontSize: 18, fontWeight: '800', color: colors.heading },
  userSub: { fontSize: 12, color: colors.muted, fontWeight: '600', marginTop: 1 },

  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.cardSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { fontSize: 17 },
  notifBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.skipText,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.soft,
  },
  cardTitle: { ...type.cardTitle, marginBottom: 6 },
  cardSubtitle: { ...type.subtitle, marginBottom: 12 },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: { fontSize: 17, fontWeight: '800', color: colors.heading },

  pill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: 12, fontWeight: '700' },

  btn: {
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnNeutral: {
    backgroundColor: colors.cardSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  btnDanger: { backgroundColor: colors.danger },
  btnTextOn: { color: colors.white, fontSize: 15, fontWeight: '800' },
  btnTextNeutral: { color: colors.heading, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  buttonRow: { flexDirection: 'row', gap: 10 },

  formGroup: { gap: 6, marginBottom: 14 },
  formLabel: type.label,
  input: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.input,
    fontSize: 15,
    color: colors.heading,
    backgroundColor: colors.cardSubtle,
  },

  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.cardSubtle,
  },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.body },
  chipTextActive: { color: colors.white },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.border,
    padding: 4,
    borderRadius: radius.button,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.surface,
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentText: { fontSize: 13, fontWeight: '800', color: colors.muted },
  segmentTextActive: { color: colors.heading },

  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderColor: colors.heading,
    transform: [{ scale: 1.12 }],
  },

  banner: {
    backgroundColor: colors.bannerTo,
    borderWidth: 1,
    borderColor: colors.bannerBorder,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...shadow.soft,
  },
  bannerIcon: { fontSize: 20 },
  bannerTitle: { fontSize: 13, fontWeight: '800', color: colors.bannerText },
  bannerBody: { fontSize: 12.5, color: colors.bannerText, lineHeight: 17 },
  bannerClose: { fontSize: 17, color: colors.bannerText, paddingHorizontal: 4 },

  statusBadge: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
  },
  statusText: { fontSize: 12.5, fontWeight: '800' },

  empty: { alignItems: 'center', paddingVertical: 48, gap: 6 },
  emptyIcon: { fontSize: 34, marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.heading },
  emptyBody: { fontSize: 13, color: colors.muted, textAlign: 'center' },
});

export { styles as uiStyles };
