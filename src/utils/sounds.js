import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  getRingtones,
  ensureAlarmChannel,
  listChannelIds,
  deleteChannel,
  hasNativeSounds,
} from '../../modules/ringtones';
import { TONES, toneById } from './tones';

// One list of choosable alarm sounds, from two very different sources.
//
// A sound is identified by a single opaque string stored on the medicine:
//
//   'classic'                 a tone bundled with the app
//   'device:<hash>'           a sound already on the phone
//
// The hash is derived from the sound's URI, so the same ringtone always maps to
// the same id and therefore the same Android channel. That matters because a
// channel's sound cannot be changed after it is created — reusing the id reuses
// the channel instead of leaving a trail of near-identical entries in the
// user's system settings.

const KEY = '@pr_device_sounds';

// FNV-1a. Short, stable, and no dependency — this only needs to avoid
// collisions across a few dozen ringtones on one phone, not resist an attacker.
export function hashUri(uri) {
  let h = 0x811c9dc5;
  const s = String(uri ?? '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function deviceSoundId(uri) {
  return `device:${hashUri(uri)}`;
}

export function isDeviceSound(toneId) {
  return typeof toneId === 'string' && toneId.startsWith('device:');
}

export function channelIdFor(toneId) {
  if (!isDeviceSound(toneId)) return toneById(toneId).channelId;
  // Namespaced so it cannot collide with the bundled channels.
  return `pill-alarm-dev-${toneId.slice('device:'.length)}`;
}

// ---------------------------------------------------------------------------
// Remembering which device sounds have been chosen
//
// The URI is what actually plays, but a medicine stores only the id — so the
// mapping has to live somewhere. It is deliberately on the device rather than
// in the cloud: a content:// URI is meaningless on any other phone, and syncing
// it would mean a medicine whose alarm is silent on a second device.
// ---------------------------------------------------------------------------

export async function rememberDeviceSound({ uri, title }) {
  const id = deviceSoundId(uri);
  const all = await getRememberedSounds();
  const next = { ...all, [id]: { uri, title, id } };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next[id];
}

export async function getRememberedSounds() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

export async function forgetDeviceSound(id) {
  const all = await getRememberedSounds();
  delete all[id];
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
}

// ---------------------------------------------------------------------------
// The list the picker shows
// ---------------------------------------------------------------------------

export const BUNDLED = TONES.map((t) => ({
  id: t.id,
  title: t.label,
  kind: 'bundled',
  sound: t.sound,
  channelId: t.channelId,
}));

// Bundled tones first: they are known to be present, known to be the right
// length, and work identically on both platforms. Device sounds follow, with
// alarms before ringtones before notification blips — loudest and most
// insistent first, since a missed dose is the failure this exists to prevent.
const TYPE_ORDER = { alarm: 0, ringtone: 1, notification: 2, imported: 3 };

export function listSoundOptions() {
  const device = getRingtones()
    .map((r) => ({
      id: deviceSoundId(r.uri),
      title: r.title,
      kind: 'device',
      type: r.type,
      uri: r.uri,
      channelId: channelIdFor(deviceSoundId(r.uri)),
    }))
    .sort((a, b) => {
      const byType = (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
      return byType !== 0 ? byType : a.title.localeCompare(b.title);
    });

  return [...BUNDLED, ...device];
}

// Whether this build can offer anything beyond the bundled tones. False on iOS
// (Apple exposes no system sounds) and on any APK built before the native
// module existed.
export function canUseDeviceSounds() {
  return hasNativeSounds && Platform.OS === 'android' && getRingtones().length > 0;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

// Makes sure the Android channel backing this sound exists. Returns the channel
// id to schedule against, falling back to the default bundled channel if the
// sound cannot be honoured — an alarm with the wrong tone is a far better
// outcome than an alarm that does not fire.
export async function ensureChannelForSound(toneId) {
  if (Platform.OS !== 'android') return null;
  if (!isDeviceSound(toneId)) return toneById(toneId).channelId;

  const remembered = (await getRememberedSounds())[toneId];
  if (!remembered) return toneById(null).channelId;

  const channelId = channelIdFor(toneId);
  const ok = ensureAlarmChannel(
    channelId,
    `Pill Alarms – ${remembered.title}`,
    remembered.uri
  );
  return ok ? channelId : toneById(null).channelId;
}

// Removes channels for sounds nothing uses any more, so the app's entry in
// Android's notification settings does not accumulate one row per sound ever
// tried. Bundled channels are always kept — they are part of the app.
export async function pruneUnusedChannels(toneIdsInUse = []) {
  if (Platform.OS !== 'android') return 0;

  const keep = new Set([
    ...BUNDLED.map((b) => b.channelId),
    'guardian-alerts',
    ...toneIdsInUse.map(channelIdFor),
  ]);

  let removed = 0;
  for (const id of listChannelIds()) {
    if (id.startsWith('pill-alarm-dev-') && !keep.has(id)) {
      deleteChannel(id);
      removed += 1;
    }
  }
  return removed;
}

// What to actually play, for a given stored id. Returns either { sound } for a
// bundled tone or { uri } for a device one.
export async function resolveSound(toneId) {
  if (isDeviceSound(toneId)) {
    const remembered = (await getRememberedSounds())[toneId];
    if (remembered) {
      return { id: toneId, title: remembered.title, uri: remembered.uri, kind: 'device' };
    }
    // The sound was removed from the phone, or this is a different device.
    const fallback = toneById(null);
    return { id: fallback.id, title: fallback.label, sound: fallback.sound, kind: 'bundled' };
  }
  const tone = toneById(toneId);
  return { id: tone.id, title: tone.label, sound: tone.sound, kind: 'bundled' };
}
