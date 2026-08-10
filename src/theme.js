// Design tokens, ported 1:1 from the reference prototype (prototype6.html).
//
// Two brands, deliberately kept apart: emerald is the patient's app, teal is
// the guardian's. Someone using both on one phone should never be unsure which
// one they are looking at.
//
// Status colours are a separate scale from either brand. A dose being "due" is
// a state, not a piece of branding, so it must not shift when the brand does.

export const colors = {
  // Base surfaces — warm slate
  canvas: '#f1f5f9',
  surface: '#ffffff',
  cardSubtle: '#f8fafc',

  // Patient brand — emerald
  emerald50: '#ecfdf5',
  emerald100: '#d1fae5',
  emerald600: '#059669',
  emerald700: '#047857',

  // Guardian brand — warm teal
  teal50: '#f0fdfa',
  teal600: '#0d9488',
  teal700: '#0f766e',

  // Semantic dose status
  takenBg: '#d1fae5',
  takenText: '#047857',
  dueBg: '#fef3c7',
  dueText: '#b45309',
  snoozeBg: '#e0f2fe',
  snoozeText: '#0369a1',
  skipBg: '#fee2e2',
  skipText: '#dc2626',

  // Medicine swatches
  medRed: '#f87171',
  medAmber: '#fbbf24',
  medBlue: '#60a5fa',
  medPurple: '#c084fc',
  medTeal: '#2dd4bf',

  // Typography + chrome
  heading: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  border: '#e2e8f0',
  hairline: '#f1f5f9',

  // Alarm screen
  alarmBg: '#0f172a',
  alarmAccent: '#4ade80',
  alarmMuted: '#94a3b8',
  alarmBody: '#cbd5e1',

  // Banner
  bannerFrom: '#fffbe3',
  bannerTo: '#fef3c7',
  bannerBorder: '#fde68a',
  bannerText: '#92400e',

  danger: '#dc2626',
  white: '#ffffff',
};

export const radius = {
  card: 20,
  input: 12,
  button: 14,
  thumb: 14,
  pill: 9999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

// The reference's --shadow-soft, expressed for both platforms.
export const shadow = {
  soft: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  button: (tint) => ({
    shadowColor: tint,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  }),
};

export const type = {
  h1: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  title: { fontSize: 18, fontWeight: '800', color: colors.heading },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.heading },
  body: { fontSize: 15, color: colors.body },
  subtitle: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  meta: { fontSize: 12.5, color: colors.muted },
  // Uppercase micro-label above a form field.
  label: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.heading,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
};

// Brand-aware helpers so a screen declares its role once and every control
// picks up the right colour.
export const BRANDS = {
  patient: {
    key: 'patient',
    tint: colors.emerald600,
    tintDark: colors.emerald700,
    tintSoft: colors.emerald50,
    tintSofter: colors.emerald100,
    gradient: [colors.emerald600, colors.emerald700],
    avatarGradient: ['#a7f3d0', colors.emerald600],
  },
  guardian: {
    key: 'guardian',
    tint: colors.teal600,
    tintDark: colors.teal700,
    tintSoft: colors.teal50,
    tintSofter: '#99f6e4',
    gradient: [colors.teal600, colors.teal700],
    avatarGradient: ['#99f6e4', colors.teal600],
  },
};

export function brandFor(role) {
  return role === 'guardian' ? BRANDS.guardian : BRANDS.patient;
}

// Time-of-day label shown beside a dose slot, matching the reference's
// "Morning / Afternoon" pills.
export function periodFor(hhmm) {
  const hour = Number(String(hhmm).split(':')[0]);
  if (Number.isNaN(hour)) return { label: '', bg: colors.cardSubtle, text: colors.muted };
  if (hour < 12) {
    return { label: 'Morning', bg: colors.emerald50, text: colors.emerald700 };
  }
  if (hour < 17) {
    return { label: 'Afternoon', bg: '#eff6ff', text: '#1d4ed8' };
  }
  if (hour < 21) {
    return { label: 'Evening', bg: '#fff7ed', text: '#c2410c' };
  }
  return { label: 'Night', bg: '#eef2ff', text: '#4338ca' };
}

// Dose status -> badge colours and label. One place, so Home, the calendar and
// any future surface cannot drift apart.
export const DOSE_STATUS = {
  taken: { label: '✓ Taken', bg: colors.takenBg, text: colors.takenText },
  due: { label: '⏳ Due', bg: colors.dueBg, text: colors.dueText },
  pending: { label: '⏳ Due', bg: colors.dueBg, text: colors.dueText },
  snoozed: { label: '💤 Snoozed', bg: colors.snoozeBg, text: colors.snoozeText },
  skipped: { label: '✕ Skipped', bg: colors.skipBg, text: colors.skipText },
  missed: { label: '✕ Missed', bg: colors.skipBg, text: colors.skipText },
  upcoming: { label: 'Upcoming', bg: colors.cardSubtle, text: colors.muted },
};

export function statusStyle(state) {
  return DOSE_STATUS[state] || DOSE_STATUS.upcoming;
}

// ---------------------------------------------------------------------------
// Medicine presentation: the form decides the icon, the colour is the user's.
// Kept here so the Add screen, the Home list, the alarm and the guardian view
// can never disagree about what a given medicine looks like.
// ---------------------------------------------------------------------------
export const MED_FORMS = [
  { id: 'Tablet', label: 'Tablet', icon: '💊' },
  { id: 'Capsule', label: 'Capsule', icon: '💊' },
  { id: 'Syrup', label: 'Syrup', icon: '🧪' },
  { id: 'Injection', label: 'Injection', icon: '💉' },
  { id: 'Drops', label: 'Drops', icon: '💧' },
];

export function formFor(id) {
  return MED_FORMS.find((f) => f.id === id) || MED_FORMS[0];
}

export const MED_COLORS = [
  { name: 'Red', hex: '#f87171' },
  { name: 'Yellow', hex: '#fbbf24' },
  { name: 'Green', hex: '#34d399' },
  { name: 'Blue', hex: '#60a5fa' },
  { name: 'Purple', hex: '#c084fc' },
];

// A pale wash of the medicine's colour, for the icon tile behind it.
export function tintFor(hex) {
  const found = MED_COLORS.find((c) => c.hex === hex);
  const soft = {
    '#f87171': '#fef2f2',
    '#fbbf24': '#fefce8',
    '#34d399': '#ecfdf5',
    '#60a5fa': '#eff6ff',
    '#c084fc': '#faf5ff',
  };
  return (found && soft[found.hex]) || colors.cardSubtle;
}
