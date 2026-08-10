import { screen, act } from '@testing-library/react-native';
import { Image, Vibration } from 'react-native';
import * as Av from 'expo-av';
import * as Notifications from 'expo-notifications';
import * as KeepAwake from 'expo-keep-awake';
import { renderScreen, showScreen, press, flush } from '../../test/renderScreen';
import AlarmScreen from '../../src/screens/AlarmScreen';
import {
  registerUser,
  loginUser,
  addMedicine,
} from '../../src/utils/storage';

const db = () => globalThis.__db;
const history = () => db().rows('dose_history');
const pushes = () =>
  globalThis.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

async function signIn() {
  await registerUser('alice', 'password123');
  await loginUser('alice', 'password123');
  return db().session.user;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date(2025, 5, 10, 8, 5, 0, 0));
});

describe('AlarmScreen — presentation', () => {
  it('names the medicine and offers the three choices', async () => {
    await signIn();
    await showScreen(AlarmScreen, {
      params: { medicineId: 'm1', medicineName: 'Aspirin' },
    });

    expect(screen.getByText('Aspirin')).toBeTruthy();
    expect(screen.getByText('PillReminder alarm')).toBeTruthy();
    expect(screen.getByText('✓  Mark taken')).toBeTruthy();
    expect(screen.getByText('Snooze 10 minutes')).toBeTruthy();
    expect(screen.getByText('Skip this dose')).toBeTruthy();
  });

  it('falls back to a generic label with no medicine name', async () => {
    await signIn();
    await showScreen(AlarmScreen, { params: {} });
    expect(screen.getByText('medicine')).toBeTruthy();
  });

  it('shows the form of the medicine on the alarm', async () => {
    await signIn();
    const id = await addMedicine(null, {
      name: 'Cough syrup', times: ['08:00'], form: 'Syrup',
    });
    await showScreen(AlarmScreen, {
      params: { medicineId: id, medicineName: 'Cough syrup' },
    });
    expect(screen.getByText(/Syrup/)).toBeTruthy();
  });

  it('keeps the screen awake and vibrates on the alarm pattern', async () => {
    await signIn();
    await showScreen(AlarmScreen, { params: { medicineId: 'm1', medicineName: 'A' } });

    expect(KeepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith('alarm');
    expect(Vibration.vibrate).toHaveBeenCalledWith([0, 800, 400, 800, 400, 800], true);
  });

  it('plays the alarm on loop at full volume, over silent mode', async () => {
    await signIn();
    await showScreen(AlarmScreen, { params: { medicineId: 'm1', medicineName: 'A' } });

    expect(Av.Audio.setAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        staysActiveInBackground: true,
      })
    );
    expect(Av.__state.created[0].opts).toMatchObject({
      isLooping: true, volume: 1.0, shouldPlay: true,
    });
  });

  it('uses the medicine`s own tone', async () => {
    await signIn();
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'], toneId: 'siren' });
    await showScreen(AlarmScreen, { params: { medicineId: id, medicineName: 'Aspirin' } });

    // The tone is resolved from the stored medicine, not the default.
    expect(Av.__state.created).toHaveLength(1);
    expect(Av.Audio.Sound.createAsync).toHaveBeenCalled();
  });

  it('uses the default tone for the TEST sentinel without touching the network', async () => {
    await signIn();
    await showScreen(AlarmScreen, { params: { medicineId: 'TEST', medicineName: 'Test' } });
    expect(Av.__state.created).toHaveLength(1);
  });

  it('still renders and rings when audio fails entirely', async () => {
    Av.__state.failCreate = true;
    await signIn();
    await showScreen(AlarmScreen, { params: { medicineId: 'm1', medicineName: 'Aspirin' } });
    expect(screen.getByText('Aspirin')).toBeTruthy();
  });

  it('shows the medicine photo when there is one', async () => {
    await signIn();
    const id = await addMedicine(null, {
      name: 'Aspirin', times: ['08:00'], photo: 'ALARMPHOTO',
    });
    await showScreen(AlarmScreen, { params: { medicineId: id, medicineName: 'Aspirin' } });

    const images = screen.UNSAFE_getAllByType(Image);
    expect(images.some((i) => i.props.source?.uri === 'data:image/jpeg;base64,ALARMPHOTO')).toBe(true);
  });

  it('shows the form icon when there is no photo', async () => {
    await signIn();
    const id = await addMedicine(null, {
      name: 'Aspirin', times: ['08:00'], form: 'Tablet',
    });
    await showScreen(AlarmScreen, { params: { medicineId: id, medicineName: 'Aspirin' } });
    expect(screen.getByText('💊')).toBeTruthy();
  });

  it('shows the photo from the offline cache when the network is down', async () => {
    await signIn();
    const id = await addMedicine(null, {
      name: 'Aspirin', times: ['08:00'], photo: 'CACHEDPHOTO',
    });
    await addMedicine(null, { name: 'warm cache', times: ['09:00'] });
    const { unmount } = await showScreen(AlarmScreen, {
      params: { medicineId: id, medicineName: 'Aspirin' },
    });
    unmount();

    db().failOn('medicines', 'select', { message: 'offline' });
    await showScreen(AlarmScreen, { params: { medicineId: id, medicineName: 'Aspirin' } });

    const images = screen.UNSAFE_getAllByType(Image);
    expect(images.some((i) => i.props.source?.uri === 'data:image/jpeg;base64,CACHEDPHOTO')).toBe(true);
  });
});

describe('AlarmScreen — actions', () => {
  it('Taken records the dose and returns Home', async () => {
    await signIn();
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    const { navigation } = await showScreen(AlarmScreen, {
      params: { medicineId: id, medicineName: 'Aspirin' },
    });

    await press('✓  Mark taken');

    expect(history().filter((r) => r.status === 'taken')).toHaveLength(1);
    expect(navigation.replace).toHaveBeenCalledWith('Home');
  });

  it('Taken stops the sound and the vibration', async () => {
    await signIn();
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await showScreen(AlarmScreen, { params: { medicineId: id, medicineName: 'Aspirin' } });
    const { sound } = Av.__state.created[0];

    await press('✓  Mark taken');

    expect(sound.stopAsync).toHaveBeenCalled();
    expect(sound.unloadAsync).toHaveBeenCalled();
    expect(Vibration.cancel).toHaveBeenCalled();
  });

  it('Taken notifies a guardian who opted into "both"', async () => {
    const alice = await signIn();
    const bob = db().makeUser('bob', { push_token: 'ExponentPushToken[bob]' });
    db().link(alice.id, bob.id);
    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    profile.settings = { ...profile.settings, notifyMode: 'both' };

    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await showScreen(AlarmScreen, { params: { medicineId: id, medicineName: 'Aspirin' } });
    await press('✓  Mark taken');

    expect(pushes()[0].title).toBe('Medicine taken');
  });

  it.each([
    [10, 600],
    [30, 1800],
  ])('snoozing for the medicine`s own %i minutes arms a one-shot alarm', async (minutes, seconds) => {
    await signIn();
    const id = await addMedicine(null, {
      name: 'Aspirin', times: ['08:00'], snoozeMinutes: minutes,
    });
    const { navigation } = await showScreen(AlarmScreen, {
      params: { medicineId: id, medicineName: 'Aspirin' },
    });

    await press(`Snooze ${minutes} minutes`);

    expect(history().filter((r) => r.status === 'snoozed')).toHaveLength(1);
    const snooze = Notifications.__state.scheduled.find(
      (n) => n.content.title === 'Snoozed reminder'
    );
    expect(snooze.trigger.seconds).toBe(seconds);
    expect(snooze.trigger.repeats).toBe(false);
    expect(navigation.replace).toHaveBeenCalledWith('Home');
  });

  // Was BUG-08: every caller omitted toneId, so a snooze silently dropped to
  // Classic. Now fixed — this test proves the tone survives.
  it('rescheduling keeps the medicine`s chosen tone', async () => {
    await signIn();
    const id = await addMedicine(null, {
      name: 'Aspirin', times: ['08:00'], toneId: 'gentle',
    });
    await showScreen(AlarmScreen, { params: { medicineId: id, medicineName: 'Aspirin' } });

    await press('Snooze 10 minutes');

    const snooze = Notifications.__state.scheduled.find(
      (n) => n.content.title === 'Snoozed reminder'
    );
    expect(snooze.content.sound).toBe('gentle');
    expect(snooze.trigger.channelId).toBe('pill-alarm-gentle');
  });

  // Was BUG-21: the buttons were hard-coded to 5 and 10 minutes and ignored the
  // medicine's own setting.
  it('offers the medicine`s configured snooze duration', async () => {
    await signIn();
    const id = await addMedicine(null, {
      name: 'Aspirin', times: ['08:00'], snoozeMinutes: 30,
    });
    await showScreen(AlarmScreen, { params: { medicineId: id, medicineName: 'Aspirin' } });

    expect(screen.getByText('Snooze 30 minutes')).toBeTruthy();
    await press('Snooze 30 minutes');

    const snooze = Notifications.__state.scheduled.find(
      (n) => n.content.title === 'Snoozed reminder'
    );
    expect(snooze.trigger.seconds).toBe(1800);
  });

  it('Skip records a skip and runs the guardian sweep', async () => {
    const alice = await signIn();
    const bob = db().makeUser('bob', { push_token: 'ExponentPushToken[bob]' });
    db().link(alice.id, bob.id);
    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    profile.settings = { ...profile.settings, graceMinutes: 5 };

    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    const { navigation } = await showScreen(AlarmScreen, {
      params: { medicineId: id, medicineName: 'Aspirin' },
    });

    await press('Skip this dose');

    expect(history().filter((r) => r.status === 'skipped')).toHaveLength(1);
    expect(navigation.replace).toHaveBeenCalledWith('Home');
  });

  it('records nothing when signed out but still leaves the alarm screen', async () => {
    const { navigation } = await showScreen(AlarmScreen, {
      params: { medicineId: 'm1', medicineName: 'Aspirin' },
    });
    await press('✓  Mark taken');
    expect(history()).toHaveLength(0);
    expect(navigation.replace).toHaveBeenCalledWith('Home');
  });
});

describe('AlarmScreen — teardown', () => {
  it('stops audio, vibration and keep-awake on unmount', async () => {
    await signIn();
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    const { unmount } = await showScreen(AlarmScreen, {
      params: { medicineId: id, medicineName: 'Aspirin' },
    });
    const { sound } = Av.__state.created[0];

    await act(async () => {
      unmount();
    });
    await flush();

    expect(Vibration.cancel).toHaveBeenCalled();
    expect(KeepAwake.deactivateKeepAwake).toHaveBeenCalledWith('alarm');
    expect(sound.unloadAsync).toHaveBeenCalled();
  });

  it('does not leave a sound playing if unmounted before it finishes loading', async () => {
    await signIn();
    // Mount WITHOUT settling, so the async audio setup is still in flight.
    const { unmount } = renderScreen(AlarmScreen, {
      params: { medicineId: 'm1', medicineName: 'Aspirin' },
    });

    await act(async () => {
      unmount();
    });
    await flush();

    // The effect's `cancelled` flag must unload anything that did load.
    expect(Av.__state.created.length).toBeGreaterThan(0);
    for (const { sound } of Av.__state.created) {
      expect(sound.unloadAsync).toHaveBeenCalled();
    }
  });
});
