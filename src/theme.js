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

// Colours of a settled time slot, by how it went (see slotSummary).
export const SUMMARY_TONE = {
  taken: { bg: '#ecfdf5', pill: colors.takenBg, text: colors.takenText, border: '#a7f3d0' },
  partial: { bg: '#fff7ed', pill: '#ffedd5', text: '#c2410c', border: '#fed7aa' },
  skipped: { bg: '#fef2f2', pill: colors.skipBg, text: colors.skipText, border: '#fecaca' },
  snoozed: { bg: '#f0f9ff', pill: colors.snoozeBg, text: colors.snoozeText, border: '#bae6fd' },
};

export function statusStyle(state) {
  return DOSE_STATUS[state] || DOSE_STATUS.upcoming;
}

// ---------------------------------------------------------------------------
// Medicine presentation: the form decides the icon, the colour is the user's.
// Kept here so the Add screen, the Home list, the alarm and the guardian view
// can never disagree about what a given medicine looks like.
// ---------------------------------------------------------------------------
// Forms are DRAWN by src/components/MedIcon.js, not shown as emoji. There is
// no `icon` here on purpose: 💊 was used for both Tablet and Capsule, which
// made the two indistinguishable, and an emoji cannot take the medicine's
// colour — the colour could only appear as a dot beside it.
export const MED_FORMS = [
  { id: 'Tablet', label: 'Tablet' },
  { id: 'Capsule', label: 'Capsule' },
  { id: 'Syrup', label: 'Syrup' },
  { id: 'Injection', label: 'Injection' },
  { id: 'Drops', label: 'Drops' },
];

export function formFor(id) {
  return MED_FORMS.find((f) => f.id === id) || MED_FORMS[0];
}

export const MED_COLORS = [
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Yellow', hex: '#fbbf24' },
  { name: 'Red', hex: '#f87171' },
  { name: 'Blue', hex: '#60a5fa' },
  { name: 'Pink', hex: '#f472b6' },
];

// A pale wash of the medicine's colour, for the icon tile behind it.
// Green and purple are no longer offered, but medicines saved with them keep
// their wash.
const SOFT_TINTS = {
  '#f87171': '#fef2f2',
  '#fbbf24': '#fefce8',
  '#60a5fa': '#eff6ff',
  '#f472b6': '#fdf2f8',
  '#34d399': '#ecfdf5',
  '#c084fc': '#faf5ff',
};

export function tintFor(hex) {
  return SOFT_TINTS[hex] || colors.cardSubtle;
}

// ---------------------------------------------------------------------------
// Colour maths for the medicine icons
//
// The icons are drawn rather than emoji, so they need a darker edge and a
// readable detail colour derived from whatever the user picked — including
// white, which is a common real choice for a tablet and needs an outline to be
// visible at all against a white card.
// ---------------------------------------------------------------------------

function parseHex(hex) {
  const s = String(hex || '').replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

// amount > 0 lightens toward white, < 0 darkens toward black.
export function shade(hex, amount) {
  const rgb = parseHex(hex) || { r: 148, g: 163, b: 184 };
  const mix = (c) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const hh = (c) => Math.max(0, Math.min(255, mix(c))).toString(16).padStart(2, '0');
  return `#${hh(rgb.r)}${hh(rgb.g)}${hh(rgb.b)}`;
}

// Perceived brightness (ITU-R BT.601). Used to decide whether details drawn on
// top of the colour should be dark or light.
export function luminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return 1;
  return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 / 255;
}

export function isLight(hex) {
  return luminance(hex) > 0.65;
}

// A border that stays visible whatever the fill is: a white tablet gets a grey
// edge, a dark one gets a slightly darker edge rather than a black halo.
export function edgeFor(hex) {
  return isLight(hex) ? shade(hex, -0.22) : shade(hex, -0.3);
}

// For score lines, capsule seams and syringe markings.
export function detailFor(hex) {
  return isLight(hex) ? shade(hex, -0.45) : shade(hex, 0.6);
}
