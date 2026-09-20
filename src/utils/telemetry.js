import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase, localUser } from './supabase';

// Crash reports and a few usage counts, written to public.app_events in this
// project's own database (supabase/diagnostics.sql). No third party, and the
// table is write-only for the app.
//
// WHAT IS NEVER SENT: medicine names, phone numbers, health readings, photos,
// anything a user typed. Each call names the fields it sends, and `clean()`
// below drops everything that is not a short string, a number or a boolean.
//
// Every function here swallows its own errors. Diagnostics must never be the
// reason something fails — least of all the crash handler.

const KEY = '@pr_diagnostics';
const appVersion = require('../../app.json').expo.version;

let enabled = true; // until the stored choice is read at startup

export async function loadDiagnosticsChoice() {
  try {
    enabled = (await AsyncStorage.getItem(KEY)) !== 'off';
  } catch (e) {
    enabled = true;
  }
  return enabled;
}

export function diagnosticsEnabled() {
  return enabled;
}

export async function setDiagnosticsEnabled(on) {
  enabled = !!on;
  try {
    await AsyncStorage.setItem(KEY, on ? 'on' : 'off');
  } catch (e) {}
  return enabled;
}

// Only simple values, and nothing long enough to hide a sentence of user text.
function clean(detail) {
  const out = {};
  for (const [k, v] of Object.entries(detail || {})) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 80);
  }
  return out;
}

async function write(kind, name, detail) {
  if (!enabled) return false;
  try {
    const { data: u } = await localUser();
    if (!u?.user) return false; // signed out: nothing to attach it to
    const { error } = await supabase.from('app_events').insert({
      user_id: u.user.id,
      kind,
      name: String(name).slice(0, 60),
      detail,
      app_version: appVersion,
      platform: Platform.OS,
    });
    return !error;
  } catch (e) {
    return false;
  }
}

// A thing that happened, for counting: 'app_open', 'dose_marked', …
export function track(name, detail) {
  return write('event', name, clean(detail));
}

// A crash. The message and stack are the app's own code, not user data; the
// stack is trimmed so one enormous report cannot fill the table.
export function reportCrash(error, detail) {
  const message = String(error?.message || error || 'Unknown error').slice(0, 300);
  const stack = String(error?.stack || '').slice(0, 4000);
  return write('crash', 'crash', { ...clean(detail), message, stack });
}

// React Native hands every uncaught JS error to this one handler.
export function installCrashReporting() {
  const RNErrorUtils = global.ErrorUtils;
  if (!RNErrorUtils?.setGlobalHandler || installCrashReporting.installed) return;
  const previous = RNErrorUtils.getGlobalHandler?.();
  RNErrorUtils.setGlobalHandler((error, isFatal) => {
    reportCrash(error, { fatal: !!isFatal });
    // Then let the app do what it did before — in a release build that is the
    // red screen or a restart, and swallowing it would hide the crash.
    if (previous) previous(error, isFatal);
  });
  installCrashReporting.installed = true;
}
