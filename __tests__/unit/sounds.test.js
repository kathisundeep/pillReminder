import { Platform } from 'react-native';
import * as Ringtones from '../../modules/ringtones';
import {
  hashUri,
  deviceSoundId,
  isDeviceSound,
  channelIdFor,
  listSoundOptions,
  canUseDeviceSounds,
  rememberDeviceSound,
  getRememberedSounds,
  forgetDeviceSound,
  ensureChannelForSound,
  pruneUnusedChannels,
  resolveSound,
  BUNDLED,
} from '../../src/utils/sounds';

const state = Ringtones.__state;

beforeEach(() => {
  state.available = true;
  state.channels = {};
  state.throwOnList = false;
  Platform.OS = 'android';
});

describe('sound ids', () => {
  it('gives the same uri the same id every time', () => {
    const uri = 'content://media/internal/audio/media/10';
    expect(deviceSoundId(uri)).toBe(deviceSoundId(uri));
  });

  it('gives different uris different ids', () => {
    expect(hashUri('content://a')).not.toBe(hashUri('content://b'));
  });

  it('handles an empty or missing uri without throwing', () => {
    expect(typeof hashUri('')).toBe('string');
    expect(typeof hashUri(null)).toBe('string');
    expect(typeof hashUri(undefined)).toBe('string');
  });

  it('tells a device sound from a bundled one', () => {
    expect(isDeviceSound(deviceSoundId('content://x'))).toBe(true);
    expect(isDeviceSound('classic')).toBe(false);
    expect(isDeviceSound(null)).toBe(false);
    expect(isDeviceSound(undefined)).toBe(false);
  });
});

describe('channelIdFor', () => {
  it('uses the bundled tone channel for a bundled id', () => {
    expect(channelIdFor('chime')).toBe('pill-alarm-chime');
  });

  it('falls back to the default channel for an unknown id', () => {
    expect(channelIdFor('nonsense')).toBe('pill-alarm-classic');
  });

  // A channel's sound is fixed once created, so the id must derive from the
  // sound — otherwise every change leaves another row in the user's system
  // notification settings.
  it('derives a stable channel from the sound itself', () => {
    const id = deviceSoundId('content://media/internal/audio/media/10');
    expect(channelIdFor(id)).toBe(channelIdFor(id));
    expect(channelIdFor(id)).toMatch(/^pill-alarm-dev-/);
  });

  it('cannot collide with a bundled channel', () => {
    const bundled = new Set(BUNDLED.map((b) => b.channelId));
    for (const r of state.ringtones) {
      expect(bundled.has(channelIdFor(deviceSoundId(r.uri)))).toBe(false);
    }
  });
});

describe('listSoundOptions', () => {
  it('puts the bundled tones first', () => {
    const list = listSoundOptions();
    expect(list.slice(0, BUNDLED.length).every((o) => o.kind === 'bundled')).toBe(true);
  });

  // Alarms are built to be heard through sleep; a message blip is a poor way
  // to be reminded of a dose.
  it('orders device sounds alarms first, then ringtones, then notifications', () => {
    const device = listSoundOptions().filter((o) => o.kind === 'device');
    expect(device.map((d) => d.type)).toEqual([
      'alarm', 'alarm', 'ringtone', 'notification',
    ]);
    expect(device.slice(0, 2).map((d) => d.title)).toEqual(['Argon', 'Barium']);
  });

  it('returns only bundled tones when the device offers none', () => {
    state.available = false;
    expect(listSoundOptions().every((o) => o.kind === 'bundled')).toBe(true);
  });
});

describe('canUseDeviceSounds', () => {
  it('is true on Android with the module present', () => {
    expect(canUseDeviceSounds()).toBe(true);
  });

  // Apple exposes no system ringtones to third-party apps at all.
  it('is false on iOS', () => {
    Platform.OS = 'ios';
    expect(canUseDeviceSounds()).toBe(false);
  });

  // An APK built before the module existed still receives JS over the air.
  it('is false when the native module is missing', () => {
    state.available = false;
    expect(canUseDeviceSounds()).toBe(false);
  });
});

describe('remembering device sounds', () => {
  it('stores the uri against the id so it can be played later', async () => {
    const uri = 'content://media/internal/audio/media/10';
    await rememberDeviceSound({ uri, title: 'Argon' });
    const all = await getRememberedSounds();
    expect(all[deviceSoundId(uri)]).toMatchObject({ uri, title: 'Argon' });
  });

  it('forgets one without disturbing the others', async () => {
    await rememberDeviceSound({ uri: 'content://a', title: 'A' });
    await rememberDeviceSound({ uri: 'content://b', title: 'B' });
    await forgetDeviceSound(deviceSoundId('content://a'));

    const all = await getRememberedSounds();
    expect(all[deviceSoundId('content://a')]).toBeUndefined();
    expect(all[deviceSoundId('content://b')]).toBeDefined();
  });
});

describe('ensureChannelForSound', () => {
  it('returns the bundled channel unchanged for a bundled tone', async () => {
    expect(await ensureChannelForSound('bell')).toBe('pill-alarm-bell');
    expect(Ringtones.ensureAlarmChannel).not.toHaveBeenCalled();
  });

  it('creates a channel carrying the chosen sound', async () => {
    const uri = 'content://media/internal/audio/media/11';
    await rememberDeviceSound({ uri, title: 'Barium' });
    const id = deviceSoundId(uri);

    const channel = await ensureChannelForSound(id);
    expect(channel).toBe(channelIdFor(id));
    expect(state.channels[channel].sound).toBe(uri);
    expect(state.channels[channel].name).toContain('Barium');
  });

  // An alarm with the wrong tone still wakes you. One that never fires does not.
  it('falls back to a bundled channel when the sound is not remembered', async () => {
    const orphan = deviceSoundId('content://gone');
    expect(await ensureChannelForSound(orphan)).toBe('pill-alarm-classic');
  });

  it('falls back when the native call fails', async () => {
    const uri = 'content://media/internal/audio/media/10';
    await rememberDeviceSound({ uri, title: 'Argon' });
    state.available = false;
    expect(await ensureChannelForSound(deviceSoundId(uri))).toBe('pill-alarm-classic');
  });

  it('does nothing on iOS, where channels do not exist', async () => {
    Platform.OS = 'ios';
    expect(await ensureChannelForSound('classic')).toBeNull();
  });
});

describe('pruneUnusedChannels', () => {
  it('removes device channels nothing uses', async () => {
    const a = deviceSoundId('content://a');
    const b = deviceSoundId('content://b');
    await rememberDeviceSound({ uri: 'content://a', title: 'A' });
    await rememberDeviceSound({ uri: 'content://b', title: 'B' });
    await ensureChannelForSound(a);
    await ensureChannelForSound(b);

    const removed = await pruneUnusedChannels([a]);
    expect(removed).toBe(1);
    expect(state.channels[channelIdFor(a)]).toBeDefined();
    expect(state.channels[channelIdFor(b)]).toBeUndefined();
  });

  it('never removes a bundled or guardian channel', async () => {
    state.channels['pill-alarm-classic'] = { id: 'pill-alarm-classic' };
    state.channels['guardian-alerts'] = { id: 'guardian-alerts' };
    await pruneUnusedChannels([]);
    expect(state.channels['pill-alarm-classic']).toBeDefined();
    expect(state.channels['guardian-alerts']).toBeDefined();
  });
});

describe('resolveSound', () => {
  it('resolves a bundled tone to its file', async () => {
    expect(await resolveSound('siren')).toMatchObject({
      id: 'siren', kind: 'bundled', sound: 'siren',
    });
  });

  it('resolves a device sound to its uri', async () => {
    const uri = 'content://media/internal/audio/media/20';
    await rememberDeviceSound({ uri, title: 'Zen' });
    expect(await resolveSound(deviceSoundId(uri))).toMatchObject({
      kind: 'device', uri, title: 'Zen',
    });
  });

  // Restoring a backup onto a new phone, or deleting the ringtone, must not
  // leave a medicine with no sound at all.
  it('falls back to a bundled tone when the sound is gone', async () => {
    expect(await resolveSound(deviceSoundId('content://vanished'))).toMatchObject({
      kind: 'bundled', sound: 'alarm',
    });
  });

  it('treats an unknown id as the default tone', async () => {
    expect(await resolveSound('nonsense')).toMatchObject({ id: 'classic' });
    expect(await resolveSound(null)).toMatchObject({ id: 'classic' });
  });
});
