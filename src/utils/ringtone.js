import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

const ACTION_PICKER = 'android.intent.action.RINGTONE_PICKER';
const EXTRA_TYPE = 'android.intent.extra.ringtone.TYPE';
const EXTRA_TITLE = 'android.intent.extra.ringtone.TITLE';
const EXTRA_SHOW_DEFAULT = 'android.intent.extra.ringtone.SHOW_DEFAULT';
const EXTRA_SHOW_SILENT = 'android.intent.extra.ringtone.SHOW_SILENT';
const EXTRA_EXISTING_URI = 'android.intent.extra.ringtone.EXISTING_URI';
const EXTRA_PICKED_URI = 'android.intent.extra.ringtone.PICKED_URI';
const RINGTONE_TYPE_ALARM = 4;

export async function pickRingtone(currentUri) {
  if (Platform.OS !== 'android') return null;

  const extra = {
    [EXTRA_TYPE]: RINGTONE_TYPE_ALARM,
    [EXTRA_TITLE]: 'Select alarm tone',
    [EXTRA_SHOW_DEFAULT]: true,
    [EXTRA_SHOW_SILENT]: false,
  };
  if (currentUri) extra[EXTRA_EXISTING_URI] = currentUri;

  const result = await IntentLauncher.startActivityAsync(ACTION_PICKER, {
    extra,
  });

  if (result.resultCode !== IntentLauncher.ResultCode.Success) return null;
  const uri =
    result.extra?.[EXTRA_PICKED_URI] ||
    result.data ||
    null;
  return uri;
}

export function shortToneLabel(uri) {
  if (!uri) return 'Default beep (bundled)';
  try {
    const m = String(uri).match(/\/([0-9]+)$/);
    if (m) return `System tone #${m[1]}`;
  } catch (e) {}
  return 'Custom tone selected';
}
