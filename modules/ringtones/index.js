import { requireOptionalNativeModule } from 'expo-modules-core';

// requireOptionalNativeModule, NOT requireNativeModule.
//
// This module only exists in a build made after it was added. Any older APK
// still in the field — and there are several — receives JS updates over the
// air, so the moment this file uses the strict variant, every one of those
// installs crashes on launch with a missing-module error and no way back
// except a reinstall. Optional means they simply see the bundled tones.
const Ringtones = requireOptionalNativeModule('Ringtones');

export const hasNativeSounds = Ringtones != null;

const EMPTY = [];

export function getRingtones() {
  if (!Ringtones?.getRingtones) return EMPTY;
  try {
    return Ringtones.getRingtones() || EMPTY;
  } catch (e) {
    return EMPTY;
  }
}

export function ensureAlarmChannel(channelId, name, soundUri) {
  if (!Ringtones?.ensureAlarmChannel) return false;
  try {
    return Ringtones.ensureAlarmChannel(channelId, name, soundUri ?? null);
  } catch (e) {
    return false;
  }
}

export function deleteChannel(channelId) {
  if (!Ringtones?.deleteChannel) return false;
  try {
    return Ringtones.deleteChannel(channelId);
  } catch (e) {
    return false;
  }
}

export function listChannelIds() {
  if (!Ringtones?.listChannelIds) return EMPTY;
  try {
    return Ringtones.listChannelIds() || EMPTY;
  } catch (e) {
    return EMPTY;
  }
}

export function channelSound(channelId) {
  if (!Ringtones?.channelSound) return null;
  try {
    return Ringtones.channelSound(channelId) ?? null;
  } catch (e) {
    return null;
  }
}

// iOS only. Resolves to the filename to hand to the notification, or throws
// with a message worth showing — the iOS rules (30 seconds, caf/aif/wav) are
// not guessable, and breaking them makes iOS quietly play its own default
// instead, which reads as the chosen sound being ignored.
export async function importSound(sourceUri, name) {
  if (!Ringtones?.importSound) {
    throw new Error('Importing sounds is not supported in this build.');
  }
  return Ringtones.importSound(sourceUri, name);
}

export function listImportedSounds() {
  if (!Ringtones?.listImportedSounds) return EMPTY;
  try {
    return Ringtones.listImportedSounds() || EMPTY;
  } catch (e) {
    return EMPTY;
  }
}

export function deleteImportedSound(name) {
  if (!Ringtones?.deleteImportedSound) return false;
  try {
    return Ringtones.deleteImportedSound(name);
  } catch (e) {
    return false;
  }
}
