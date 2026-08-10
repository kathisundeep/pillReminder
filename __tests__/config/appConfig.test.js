// Configuration invariants. These are the failures that do not show up in
// development but break a release build: a tone with no bundled sound file, a
// missing Android permission, a broken OTA channel, a store-blocking omission.

import fs from 'fs';
import path from 'path';
import appJson from '../../app.json';
import pkg from '../../package.json';
import { TONES } from '../../src/utils/notifications';

const root = path.resolve(__dirname, '../..');
const expo = appJson.expo;

const notificationPlugin = expo.plugins.find(
  (p) => Array.isArray(p) && p[0] === 'expo-notifications'
);
const imagePickerPlugin = expo.plugins.find(
  (p) => Array.isArray(p) && p[0] === 'expo-image-picker'
);

describe('alarm sounds', () => {
  it('bundles a file for every selectable tone', () => {
    for (const tone of TONES) {
      const file = path.join(root, 'assets/sounds', `${tone.sound}.wav`);
      expect(fs.existsSync(file)).toBe(true);
    }
  });

  it('declares every tone in the expo-notifications plugin', () => {
    // A sound missing here is NOT copied into res/raw, so the Android channel
    // silently falls back to the default notification sound in a release build.
    const declared = notificationPlugin[1].sounds.map((s) => path.basename(s, '.wav'));
    for (const tone of TONES) {
      expect(declared).toContain(tone.sound);
    }
  });

  it('declares no sound that is not on disk', () => {
    for (const rel of notificationPlugin[1].sounds) {
      expect(fs.existsSync(path.join(root, rel))).toBe(true);
    }
  });

  it('ships non-empty audio', () => {
    for (const tone of TONES) {
      const file = path.join(root, 'assets/sounds', `${tone.sound}.wav`);
      expect(fs.statSync(file).size).toBeGreaterThan(1000);
    }
  });
});

describe('Android configuration', () => {
  const permissions = expo.android.permissions;

  it('requests the permissions an exact-time alarm needs', () => {
    for (const p of [
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.USE_EXACT_ALARM',
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.WAKE_LOCK',
      'android.permission.VIBRATE',
      'android.permission.POST_NOTIFICATIONS',
    ]) {
      expect(permissions).toContain(p);
    }
  });

  it('requests RECEIVE_BOOT_COMPLETED so alarms survive a reboot', () => {
    expect(permissions).toContain('android.permission.RECEIVE_BOOT_COMPLETED');
  });

  it('requests CAMERA for the medicine photo feature', () => {
    expect(permissions).toContain('android.permission.CAMERA');
  });

  it('has a stable application id', () => {
    expect(expo.android.package).toBe('com.pillreminder.app');
  });

  it('uses an integer versionCode that a store upload can increment', () => {
    expect(Number.isInteger(expo.android.versionCode)).toBe(true);
    expect(expo.android.versionCode).toBeGreaterThan(0);
  });
});

describe('iOS configuration', () => {
  const infoPlist = expo.ios.infoPlist;

  it('declares the background modes the sweep and push need', () => {
    expect(infoPlist.UIBackgroundModes).toEqual(
      expect.arrayContaining(['fetch', 'remote-notification'])
    );
  });

  it('explains why it wants the camera and the photo library', () => {
    // App Store review rejects a build that uses these APIs without a purpose
    // string, and iOS crashes at the call site.
    expect(infoPlist.NSCameraUsageDescription).toMatch(/medicine/i);
    expect(infoPlist.NSPhotoLibraryUsageDescription).toMatch(/medicine/i);
  });

  it('has a bundle identifier, so an App Store build can be produced', () => {
    expect(expo.ios.bundleIdentifier).toBe('com.pillreminder.app');
    expect(expo.ios.buildNumber).toBeTruthy();
  });

  it('uses the same identifier on both platforms', () => {
    expect(expo.ios.bundleIdentifier).toBe(expo.android.package);
  });
});

describe('photo permissions plugin', () => {
  it('is configured with both purpose strings', () => {
    expect(imagePickerPlugin).toBeDefined();
    expect(imagePickerPlugin[1].cameraPermission).toBeTruthy();
    expect(imagePickerPlugin[1].photosPermission).toBeTruthy();
  });
});

describe('over-the-air updates', () => {
  it('points at the EAS update endpoint for this project', () => {
    expect(expo.updates.url).toContain(expo.extra.eas.projectId);
  });

  // This used to assert { policy: 'appVersion' }, which derived the runtime
  // version from expo.version. That is the safe default when the version moves
  // only at releases — but the version is now a change counter that moves on
  // every edit, and under that policy every bump would start a new runtime,
  // strand every installed app, and demand a fresh APK. So the two are
  // deliberately separated.
  it('pins the runtime version instead of deriving it from the app version', () => {
    expect(typeof expo.runtimeVersion).toBe('string');
    expect(expo.runtimeVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('keeps the runtime version matching the APK already in the field', () => {
    // Change this ONLY alongside a new native build. Every phone carrying the
    // app asks for this exact string; changing it here without shipping a
    // binary that reports the same value cuts them off from updates silently.
    // Bumped to 1.2.0 when the ringtones native module was added: a binary
    // without it cannot run this JS, so the two must not share updates.
    expect(expo.runtimeVersion).toBe('1.2.0');
  });

  it('lets the app version move independently of the runtime version', () => {
    expect(expo.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(expo.version).not.toBe(expo.runtimeVersion);
  });

  it('has a Play-acceptable versionCode', () => {
    // Google Play rejects an upload whose versionCode is not strictly higher
    // than the previous one, so it only ever counts up — it does not track the
    // displayed version, which wraps at 99.
    expect(Number.isInteger(expo.android.versionCode)).toBe(true);
    expect(expo.android.versionCode).toBeGreaterThanOrEqual(4);
  });
});

describe('Supabase credentials', () => {
  it('ships only the publishable key, never a service-role key', () => {
    const raw = JSON.stringify(appJson);
    expect(expo.extra.supabaseAnonKey.startsWith('sb_publishable_')).toBe(true);
    expect(raw).not.toMatch(/service_role/);
    expect(raw).not.toMatch(/sb_secret_/);
    // A JWT-shaped key would mean the legacy secret format leaked in.
    expect(expo.extra.supabaseAnonKey).not.toMatch(/^eyJ/);
  });

  it('points at the configured project', () => {
    expect(expo.extra.supabaseUrl).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
  });
});

describe('dependency alignment', () => {
  it('targets Expo SDK 51', () => {
    expect(pkg.dependencies.expo).toMatch(/^~51\./);
    expect(pkg.dependencies['react-native']).toBe('0.74.5');
    expect(pkg.dependencies.react).toBe('18.2.0');
  });

  it('keeps react-test-renderer in step with react', () => {
    // A mismatch here produces confusing renderer errors rather than real ones.
    expect(pkg.devDependencies['react-test-renderer']).toMatch(/18\.2\.0/);
  });

  it('declares every native module the app imports at runtime', () => {
    for (const dep of [
      'expo-notifications', 'expo-av', 'expo-device', 'expo-task-manager',
      'expo-background-fetch', 'expo-keep-awake', 'expo-constants',
      'expo-image-picker', 'expo-image-manipulator', 'expo-linear-gradient',
      '@react-native-async-storage/async-storage', '@supabase/supabase-js',
      'react-native-url-polyfill',
    ]) {
      expect(pkg.dependencies[dep]).toBeDefined();
    }
  });

  it('declares no dependency the app never imports', () => {
    // expo-intent-launcher went with src/utils/ringtone.js (CLEAN-01) and the
    // datetimepicker was superseded by WheelTimePicker (CLEAN-02).
    for (const gone of [
      'expo-intent-launcher',
      '@react-native-community/datetimepicker',
    ]) {
      expect(pkg.dependencies[gone]).toBeUndefined();
    }
  });

  it('keeps test tooling out of the shipped dependency list', () => {
    for (const dev of ['jest', 'jest-expo', '@testing-library/react-native']) {
      expect(pkg.dependencies[dev]).toBeUndefined();
      expect(pkg.devDependencies[dev]).toBeDefined();
    }
  });
});

describe('database schema', () => {
  const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');

  it('caps the stored photo so an un-shrunk image cannot be written', () => {
    expect(schema).toMatch(/medicines_photo_size/);
    expect(schema).toMatch(/char_length\(photo\) <= 60000/);
  });

  it('adds the photo column to databases created before it existed', () => {
    expect(schema).toMatch(/add column if not exists photo text/);
  });

  it('enables row-level security on every user-data table', () => {
    for (const table of [
      'profiles', 'guardian_links', 'pairing_codes', 'medicines',
      'dose_history', 'health_readings', 'action_requests',
      'subscriptions', 'payment_methods',
    ]) {
      expect(schema).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`)
      );
    }
  });

  it('records a slot on every dose so twice-daily medicines work', () => {
    expect(schema).toMatch(/slot\s+text,/);
    expect(schema).toMatch(/add column if not exists slot text/);
    expect(schema).toMatch(/dose_history_slot_idx/);
  });
});

describe('security hardening migration', () => {
  const hardening = fs.readFileSync(
    path.join(root, 'supabase/hardening.sql'),
    'utf8'
  );

  it('takes subscription writes away from the client (SEC-01)', () => {
    expect(hardening).toMatch(/drop policy if exists subscriptions_owner/);
    expect(hardening).toMatch(
      /create policy subscriptions_read_own on public\.subscriptions\s+for select/
    );
    expect(hardening).toMatch(
      /revoke insert, update, delete on public\.subscriptions\s+from anon, authenticated/
    );
  });

  it('caps the guardian request payload (SEC-02)', () => {
    expect(hardening).toMatch(/action_requests_payload_size/);
    expect(hardening).toMatch(/pg_column_size\(payload\) <= 80000/);
  });

  it('stops a user rewriting their own identity columns (SEC-03)', () => {
    expect(hardening).toMatch(/guard_profile_columns/);
    expect(hardening).toMatch(/new\.username\s+:= old\.username/);
    expect(hardening).toMatch(/new\.is_guardian := old\.is_guardian/);
  });

  it('removes the pairing enumeration oracle and rate-limits guesses (SEC-04)', () => {
    expect(hardening).toMatch(/generic_error/);
    expect(hardening).toMatch(/pairing_attempts/);
    expect(hardening).toMatch(/Too many attempts/);
    // The old distinguishable errors must be gone from the new function.
    expect(hardening).not.toMatch(/raise exception 'user not found'/);
  });

  it('renames the reserved-word column (DB-01)', () => {
    expect(hardening).toMatch(/rename column "values" to reading_values/);
  });

  it('schedules server-side retention (DB-02)', () => {
    expect(hardening).toMatch(/cron\.schedule\(\s*'prune-dose-history'/);
    expect(hardening).toMatch(/interval '2 years'/);
  });
});
