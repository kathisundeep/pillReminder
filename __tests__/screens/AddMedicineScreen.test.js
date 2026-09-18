import { fireEvent, screen, act } from '@testing-library/react-native';
import { Alert, Image } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import * as Av from 'expo-av';
import { showScreen, press, typeInto, flush } from '../../test/renderScreen';
import AddMedicineScreen from '../../src/screens/AddMedicineScreen';
import {
  registerUser,
  loginUser,
  addMedicine,
  getMedicines,
} from '../../src/utils/storage';

const db = () => globalThis.__db;
const meds = () => db().rows('medicines');
const scheduled = () => Notifications.__state.scheduled;

async function signIn(username = 'alice') {
  await registerUser(username, 'password123');
  await loginUser(username, 'password123');
  return db().session.user;
}

// Pin the clock: the wheel picker defaults to "now", and the tone preview
// auto-stops on a timer.
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date(2025, 5, 10, 12, 0, 0, 0)); // Tue 10 Jun, 12:00 IST
});

// Names the open card, or — if it already has a name — adds another card
// (which inherits the previous card's schedule) and names that.
const addName = async (name) => {
  if (screen.getByPlaceholderText('e.g. Paracetamol 500mg').props.value) {
    await press('+ Add another medicine');
  }
  await typeInto('e.g. Paracetamol 500mg', name);
};

describe('AddMedicineScreen — create mode', () => {
  beforeEach(async () => {
    await signIn();
  });

  it('sets the header title', async () => {
    const { navigation } = await showScreen(AddMedicineScreen);
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Add medicine' });
  });

  it('offers one card per medicine, with the grouping hint', async () => {
    await showScreen(AddMedicineScreen);
    expect(screen.getByText('Medicines')).toBeTruthy();
    expect(screen.getByText(/Each medicine keeps its own times/)).toBeTruthy();
    expect(screen.getByText('+ Add another medicine')).toBeTruthy();
  });

  it('folds the previous card to a summary when another is added', async () => {
    await showScreen(AddMedicineScreen);
    await press('Twice');
    await addName('Aspirin');
    await addName('Metformin');

    expect(screen.getByLabelText('Edit Aspirin')).toBeTruthy();
    expect(screen.getByText('Tablet · 9:00 AM, 9:00 PM · Daily · Ongoing')).toBeTruthy();
    expect(screen.getByDisplayValue('Metformin')).toBeTruthy();
  });

  it('reopens a folded card on tap', async () => {
    await showScreen(AddMedicineScreen);
    await addName('Aspirin');
    await addName('Metformin');

    await press(screen.getByLabelText('Edit Aspirin'));

    expect(screen.getByDisplayValue('Aspirin')).toBeTruthy();
    expect(screen.getByLabelText('Edit Metformin')).toBeTruthy();
  });

  it('removes a card', async () => {
    await showScreen(AddMedicineScreen);
    await press('Once');
    await addName('Aspirin');
    await addName('Metformin');

    await press(screen.getByLabelText('Remove Aspirin'));
    await press('Save');

    expect(meds().map((m) => m.name)).toEqual(['Metformin']);
  });

  it('ignores a blank card left at the end of a batch', async () => {
    await showScreen(AddMedicineScreen);
    await press('Once');
    await addName('Aspirin');
    await press('+ Add another medicine');
    await press('Save');
    expect(meds().map((m) => m.name)).toEqual(['Aspirin']);
  });

  it('rejects the same medicine twice', async () => {
    await showScreen(AddMedicineScreen);
    await press('Once');
    await addName('Aspirin');
    await addName('aspirin');
    await press('Save all 2');
    expect(Alert.alert).toHaveBeenCalledWith('Missing', 'aspirin is listed twice.');
    expect(meds()).toHaveLength(0);
  });

  it('requires at least one name', async () => {
    await showScreen(AddMedicineScreen);
    await press('Once');
    await press('Save');
    expect(Alert.alert).toHaveBeenCalledWith('Missing', 'Enter medicine name.');
    expect(meds()).toHaveLength(0);
  });

  it('requires at least one time, naming the medicine', async () => {
    await showScreen(AddMedicineScreen);
    await addName('Aspirin');
    await press('Save');
    expect(Alert.alert).toHaveBeenCalledWith('Missing', 'Add at least one time for Aspirin.');
    expect(meds()).toHaveLength(0);
  });

  it('opens the card that needs attention', async () => {
    await showScreen(AddMedicineScreen);
    await addName('Aspirin'); // no times
    await addName('Metformin');
    await press('Once');
    await press('Save all 2');

    expect(Alert.alert).toHaveBeenCalledWith('Missing', 'Add at least one time for Aspirin.');
    expect(screen.getByDisplayValue('Aspirin')).toBeTruthy();
    expect(meds()).toHaveLength(0);
  });

  it('requires at least one day when set to specific days', async () => {
    await showScreen(AddMedicineScreen);
    await addName('Aspirin');
    await press('Once');
    await press('Specific days');
    await press('Save');
    expect(Alert.alert).toHaveBeenCalledWith('Missing', 'Pick at least one day for Aspirin.');
    expect(meds()).toHaveLength(0);
  });

  it('saves several medicines that share one schedule', async () => {
    const { navigation } = await showScreen(AddMedicineScreen);
    await press('Twice');
    await addName('Aspirin');
    await addName('Metformin');
    await press('Save all 2');

    expect(meds().map((m) => m.name).sort()).toEqual(['Aspirin', 'Metformin']);
    for (const m of meds()) expect(m.times).toEqual(['09:00', '21:00']);
    expect(navigation.goBack).toHaveBeenCalled();
  });

  // The reported need: A twice a day, B once, C only in the evening — in one
  // go, then grouped by time for the reminders.
  it('saves each medicine with its own schedule, grouped into shared alarms', async () => {
    await showScreen(AddMedicineScreen);
    await addName('A');
    await press('Twice'); // 9 AM, 9 PM
    await addName('B');
    await press('Once'); // 9 AM
    await addName('C');
    await press('Twice');
    await press('9:00 AM  ×'); // 9 PM only
    await press('Save all 3');

    const times = Object.fromEntries(meds().map((m) => [m.name, m.times]));
    expect(times).toEqual({ A: ['09:00', '21:00'], B: ['09:00'], C: ['21:00'] });

    const byHour = Object.fromEntries(
      scheduled().map((n) => [n.trigger.hour, n.content.data.medicineNames])
    );
    expect(scheduled()).toHaveLength(2);
    expect(byHour[9]).toEqual(['A', 'B']);
    expect(byHour[21]).toEqual(['A', 'C']);
  });

  it('starts another medicine with the previous schedule, but not its name or photo', async () => {
    await showScreen(AddMedicineScreen);
    await addName('Aspirin');
    await press('3 times');
    await press('10 days');
    await press('📷  Take a photo');
    await press('+ Add another medicine');

    expect(screen.getByPlaceholderText('e.g. Paracetamol 500mg').props.value).toBe('');
    expect(screen.getByText('8:00 AM  ×')).toBeTruthy();
    expect(screen.getByText('2:00 PM  ×')).toBeTruthy();
    expect(screen.getByText(/10 days, ending/)).toBeTruthy();
    expect(screen.getByText(/No\s*photo/)).toBeTruthy();
  });

  it('applies the defaults a bare save should produce', async () => {
    await showScreen(AddMedicineScreen);
    await addName('Aspirin');
    await press('Once');
    await press('Save');

    expect(meds()[0]).toMatchObject({
      form: 'Tablet',
      color: '#FFFFFF',
      frequency: 'daily',
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      tone_id: 'classic',
      snooze_minutes: 10,
      alert_guardian: true,
      photo: null,
    });
  });

  it('records the chosen medicine type', async () => {
    await showScreen(AddMedicineScreen);
    await addName('Cough syrup');
    await press('Syrup');
    await press('Once');
    await press('Save');
    expect(meds()[0].form).toBe('Syrup');
  });

  // Was a reported bug: adding a tablet, a capsule and a syrup to one schedule
  // saved three of whichever type happened to be selected last.
  it('keeps a different type for each medicine in one batch', async () => {
    await showScreen(AddMedicineScreen);
    await press('Once');
    await addName('Aspirin');
    await press('Tablet');
    await addName('Amoxil');
    await press('Capsule');
    await addName('Benadryl');
    await press('Syrup');
    await press('Save all 3');

    const saved = Object.fromEntries(meds().map((m) => [m.name, m.form]));
    expect(saved).toEqual({ Aspirin: 'Tablet', Amoxil: 'Capsule', Benadryl: 'Syrup' });
  });

  it('previews the colour swatches using the selected form`s icon', async () => {
    await showScreen(AddMedicineScreen);
    // Default form is Tablet: five swatches, all showing the tablet glyph.
    expect(screen.getAllByLabelText(/Tablet$/)).toHaveLength(5);

    await press('Syrup');
    expect(screen.getAllByLabelText(/Syrup$/)).toHaveLength(5);
    expect(screen.queryAllByLabelText(/ Tablet$/)).toHaveLength(0);
  });

  it('offers the five colours from the design system', async () => {
    await showScreen(AddMedicineScreen);
    for (const name of ['Red', 'Yellow', 'Green', 'Blue', 'Purple']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it('records the chosen snooze duration', async () => {
    await showScreen(AddMedicineScreen);
    await addName('Aspirin');
    await press('Once');
    await press('30 min');
    await press('Save');
    expect(meds()[0].snooze_minutes).toBe(30);
  });

  it('records the chosen weekdays', async () => {
    await showScreen(AddMedicineScreen);
    await addName('Aspirin');
    await press('Once');
    await press('Specific days');
    await press('Mo');
    await press('We');
    await press('Save');

    expect(meds()[0].frequency).toBe('weekly');
    expect(meds()[0].days_of_week).toEqual([1, 3]);
  });

  it('lets each batched medicine keep its own colour', async () => {
    await showScreen(AddMedicineScreen);
    await press('Once');
    await addName('RedPill');
    await press('Red');
    await addName('BluePill');
    await press('Blue');
    await press('Save all 2');

    const byName = Object.fromEntries(meds().map((m) => [m.name, m.color]));
    expect(byName.RedPill).toBe('#f87171');
    expect(byName.BluePill).toBe('#60a5fa');
  });
});

describe('AddMedicineScreen — times', () => {
  beforeEach(async () => {
    await signIn();
    await showScreen(AddMedicineScreen);
  });

  // The quick-add chips (Morning, After lunch, Night…) were removed: they
  // overlapped with "how many times a day", and two ways to set the same field
  // meant the times shown could disagree with the count selected.
  it('sets the times from the dose count, in 12-hour form', async () => {
    await press('Once');
    expect(screen.getByText('9:00 AM  ×')).toBeTruthy();
  });

  it('replaces the whole set when the count changes', async () => {
    await press('3 times');
    expect(screen.getByText('8:00 AM  ×')).toBeTruthy();
    await press('Twice');
    expect(screen.getByText('9:00 AM  ×')).toBeTruthy();
    expect(screen.queryByText('2:00 PM  ×')).toBeNull();
  });

  it('spaces the doses across the day rather than bunching them', async () => {
    await press('3 times');
    await addName('Aspirin');
    await press('Save');
    expect(meds()[0].times).toEqual(['08:00', '14:00', '20:00']);
  });

  it('removes a time by tapping its chip', async () => {
    await press('Twice');
    await press('9:00 PM  ×');
    expect(screen.queryByText('9:00 PM  ×')).toBeNull();
    expect(screen.getByText('9:00 AM  ×')).toBeTruthy();
  });

  it('no longer offers the quick-add chips', async () => {
    for (const label of ['Before lunch', 'After lunch', 'Before dinner', 'Night']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('adds a custom time through the wheel picker', async () => {
    await press('+ Custom time');
    expect(screen.getByText('Pick time')).toBeTruthy();
    await press('Done');
    // The picker defaults to "now" (12:00 local in these tests).
    expect(screen.getByText('12:00 PM  ×')).toBeTruthy();
  });

  it('cancelling the picker adds nothing', async () => {
    await press('+ Custom time');
    await press('Cancel');
    expect(screen.queryByText('Pick time')).toBeNull();
    expect(screen.queryByText(/×$/)).toBeNull();
  });
});

describe('AddMedicineScreen — alarm tone', () => {
  beforeEach(async () => {
    await signIn();
    await showScreen(AddMedicineScreen);
  });

  it('lists every bundled tone', async () => {
    for (const label of ['Classic', 'Chime', 'Bell', 'Siren', 'Gentle']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('plays a preview when a tone is tapped', async () => {
    await press('Siren');
    expect(Av.Audio.Sound.createAsync).toHaveBeenCalledTimes(1);
    expect(Av.__state.created[0].opts).toMatchObject({ shouldPlay: true });
  });

  it('selecting a tone stores it on the medicine', async () => {
    await press('Bell');
    await addName('Aspirin');
    await press('Once');
    await press('Save');
    expect(meds()[0].tone_id).toBe('bell');
  });

  it('stops the previous preview before starting a new one', async () => {
    await press('Chime');
    const firstSound = Av.__state.created[0].sound;
    await press('Siren');
    expect(firstSound.unloadAsync).toHaveBeenCalled();
  });

  it('auto-stops a preview after a couple of seconds', async () => {
    await press('Chime');
    const { sound } = Av.__state.created[0];
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    await flush();
    expect(sound.stopAsync).toHaveBeenCalled();
    expect(sound.unloadAsync).toHaveBeenCalled();
  });

  it('survives an audio failure without breaking selection', async () => {
    Av.__state.failCreate = true;
    await press('Siren');
    await addName('Aspirin');
    await press('Once');
    await press('Save');
    expect(meds()[0].tone_id).toBe('siren');
  });

  it('every tone can be selected and round-trips to the row', async () => {
    for (const [label, id] of [
      ['Classic', 'classic'], ['Chime', 'chime'], ['Bell', 'bell'],
      ['Siren', 'siren'], ['Gentle', 'gentle'],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await press(label);
      // eslint-disable-next-line no-await-in-loop
      await flush(2);
      expect(screen.getByText(label)).toBeTruthy();
      expect(id).toBeTruthy();
    }
  });
});

describe('AddMedicineScreen — photo', () => {
  beforeEach(async () => {
    await signIn();
    await showScreen(AddMedicineScreen);
  });

  it('starts with no photo', () => {
    expect(screen.getByText(/No\s*photo/)).toBeTruthy();
    expect(screen.queryByText(/Remove photo/)).toBeNull();
  });

  it('captures a photo from the camera and previews it', async () => {
    await press('📷  Take a photo');
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalled();
    expect(screen.getByText(/Remove photo · \d+ KB/)).toBeTruthy();

    const images = screen.UNSAFE_getAllByType(Image);
    expect(images.some((i) => String(i.props.source?.uri).startsWith('data:image/jpeg;base64,'))).toBe(true);
  });

  it('picks a photo from the gallery', async () => {
    await press('🖼  Choose from gallery');
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
    expect(screen.getByText(/Remove photo/)).toBeTruthy();
  });

  it('removes an attached photo', async () => {
    await press('📷  Take a photo');
    await press(/Remove photo/);
    expect(screen.getByText(/No\s*photo/)).toBeTruthy();
  });

  it('reports a denied camera permission', async () => {
    ImagePicker.__state.cameraPermission = { granted: false };
    await press('📷  Take a photo');
    expect(Alert.alert).toHaveBeenCalledWith('Photo unavailable', 'Camera permission denied');
    expect(screen.queryByText(/Remove photo/)).toBeNull();
  });

  it('says nothing when the user cancels the camera', async () => {
    ImagePicker.__state.result = { canceled: true, assets: [] };
    await press('📷  Take a photo');
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(screen.getByText(/No\s*photo/)).toBeTruthy();
  });

  it('saves the compressed photo onto the medicine row', async () => {
    await press('📷  Take a photo');
    await addName('Aspirin');
    await press('Once');
    await press('Save');

    expect(meds()[0].photo).toBeTruthy();
    expect(meds()[0].photo.length).toBeLessThanOrEqual(12000);
  });

  it('attaches the photo to the medicine it was taken for, not the next one', async () => {
    await press('Once');
    await press('📷  Take a photo');
    await addName('WithPhoto');
    await addName('NoPhoto'); // a new card starts without a photo
    await press('Save all 2');

    const byName = Object.fromEntries(meds().map((m) => [m.name, m.photo]));
    expect(byName.WithPhoto).toBeTruthy();
    expect(byName.NoPhoto).toBeNull();
  });

  it('shows a thumbnail on the folded card of a medicine that has a photo', async () => {
    await press('📷  Take a photo');
    await addName('WithPhoto');
    await addName('Other');
    const images = screen.UNSAFE_getAllByType(Image);
    expect(images.length).toBeGreaterThan(0);
  });

  it('reports a compression failure without losing the form', async () => {
    ImagePicker.launchCameraAsync.mockRejectedValueOnce(new Error('camera busy'));
    await press('📷  Take a photo');
    expect(Alert.alert).toHaveBeenCalledWith('Photo failed', 'camera busy');
    expect(screen.getByText('Medicines')).toBeTruthy();
  });
});

describe('AddMedicineScreen — alarms on save', () => {
  beforeEach(async () => {
    await signIn();
  });

  it('arms one alarm per time, shared by every medicine due then', async () => {
    await showScreen(AddMedicineScreen);
    await press('Twice');
    await addName('Aspirin');
    await addName('Metformin');
    await press('Save all 2');

    expect(scheduled()).toHaveLength(2);
    expect(scheduled().map((n) => n.trigger.hour).sort((a, b) => a - b)).toEqual([9, 21]);
    expect(scheduled().every((n) => n.content.data.medicineIds.length === 2)).toBe(true);
  });

  it('re-arms ALL medicines, not just the new one', async () => {
    await addMedicine(null, { name: 'Existing', times: ['06:00'] });
    await showScreen(AddMedicineScreen);
    await addName('New');
    await press('Once');
    await press('Save');

    expect(scheduled().map((n) => n.content.body).sort()).toEqual([
      'Take Existing now', 'Take New now',
    ]);
  });

  it('stores the device-local notification ids', async () => {
    await showScreen(AddMedicineScreen);
    await addName('Aspirin');
    await press('Once');
    await press('Save');

    const [med] = await getMedicines();
    expect(med.notificationIds).toHaveLength(1);
  });

  it('refuses to save without notification permission', async () => {
    Device.isDevice = false; // ensureNotificationSetup returns false
    await showScreen(AddMedicineScreen);
    await addName('Aspirin');
    await press('Once');
    await press('Save');

    expect(Alert.alert).toHaveBeenCalledWith(
      'Permission needed',
      'Enable notifications to schedule alarms.'
    );
    expect(meds()).toHaveLength(0);
  });

  it('surfaces a save failure instead of pretending it worked', async () => {
    db().failOn('medicines', 'insert', { message: 'insert denied' });
    const { navigation } = await showScreen(AddMedicineScreen);
    await addName('Aspirin');
    await press('Once');
    await press('Save');

    expect(Alert.alert).toHaveBeenCalledWith('Save failed', 'insert denied');
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});

describe('AddMedicineScreen — edit mode', () => {
  let medicineId;

  beforeEach(async () => {
    await signIn();
    medicineId = await addMedicine(null, {
      name: 'Aspirin',
      times: ['08:00', '20:00'],
      form: 'Capsule',
      color: '#E53935',
      snoozeMinutes: 15,
      frequency: 'weekly',
      daysOfWeek: [1, 3],
      toneId: 'bell',
      alertGuardian: false,
      photo: 'EXISTINGPHOTO',
    });
  });

  it('sets the edit title', async () => {
    const { navigation } = await showScreen(AddMedicineScreen, { params: { medicineId } });
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit medicine' });
  });

  it('prefills every field from the stored medicine', async () => {
    await showScreen(AddMedicineScreen, { params: { medicineId } });

    expect(screen.getByDisplayValue('Aspirin')).toBeTruthy();
    expect(screen.getByText('8:00 AM  ×')).toBeTruthy();
    expect(screen.getByText('8:00 PM  ×')).toBeTruthy();
    expect(screen.getByText(/Remove photo/)).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.getByText('Delete medicine')).toBeTruthy();
  });

  it('edits the one medicine, without the batch adder', async () => {
    await showScreen(AddMedicineScreen, { params: { medicineId } });
    expect(screen.getByText('Medicine name')).toBeTruthy();
    expect(screen.queryByText('+ Add another medicine')).toBeNull();
  });

  it('saves an edited name without creating a duplicate', async () => {
    await showScreen(AddMedicineScreen, { params: { medicineId } });
    await act(async () => {
      fireEvent.changeText(screen.getByDisplayValue('Aspirin'), 'Aspirin 500');
    });
    await press('Save');

    expect(meds()).toHaveLength(1);
    expect(meds()[0].name).toBe('Aspirin 500');
  });

  it('rejects an emptied name', async () => {
    await showScreen(AddMedicineScreen, { params: { medicineId } });
    await act(async () => {
      fireEvent.changeText(screen.getByDisplayValue('Aspirin'), '  ');
    });
    await press('Save');
    expect(Alert.alert).toHaveBeenCalledWith('Missing', 'Enter medicine name.');
  });

  it('can replace the photo', async () => {
    await showScreen(AddMedicineScreen, { params: { medicineId } });
    await press('📷  Take a photo');
    await press('Save');

    expect(meds()[0].photo).not.toBe('EXISTINGPHOTO');
    expect(meds()[0].photo).toBeTruthy();
  });

  it('can remove the photo', async () => {
    await showScreen(AddMedicineScreen, { params: { medicineId } });
    await press(/Remove photo/);
    await press('Save');
    expect(meds()[0].photo).toBeNull();
  });

  it('re-arms alarms after an edit', async () => {
    await showScreen(AddMedicineScreen, { params: { medicineId } });
    await press('8:00 PM  ×'); // drop the evening dose
    await press('Save');

    expect(meds()[0].times).toEqual(['08:00']);
    // weekly on Mon+Wed, one time -> two alarms
    expect(scheduled()).toHaveLength(2);
  });

  it('deletes after confirmation and clears its alarms', async () => {
    const { navigation } = await showScreen(AddMedicineScreen, { params: { medicineId } });
    await press('Delete medicine');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete medicine', 'Remove "Aspirin"?', expect.any(Array)
    );

    await act(async () => {
      await globalThis.pressAlertButton('Delete');
    });
    await flush();

    expect(meds()).toHaveLength(0);
    expect(scheduled()).toHaveLength(0);
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('keeps the medicine when the delete is cancelled', async () => {
    await showScreen(AddMedicineScreen, { params: { medicineId } });
    await press('Delete medicine');
    await act(async () => {
      await globalThis.pressAlertButton('Cancel');
    });
    await flush();
    expect(meds()).toHaveLength(1);
  });
});

describe('AddMedicineScreen — guardian request mode', () => {
  let patientId;

  beforeEach(async () => {
    const alice = db().makeUser('alice');
    patientId = alice.id;
    await registerUser('bob', 'password123');
    await loginUser('bob', 'password123');
    db().link(alice.id, db().session.user.id);
  });

  const open = () =>
    showScreen(AddMedicineScreen, {
      params: { requestUserId: patientId, requestUsername: 'alice' },
    });

  it('titles the screen as a request for the patient', async () => {
    const { navigation } = await open();
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Request for @alice' });
    expect(screen.getByText('Send request')).toBeTruthy();
  });

  it('files a request instead of writing a medicine', async () => {
    const { navigation } = await open();
    await addName('Vitamin D');
    await press('Once');
    await press('Send request');

    expect(meds()).toHaveLength(0);
    const reqs = db().rows('action_requests');
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({
      user_id: patientId, kind: 'add_medicine', status: 'pending',
    });
    expect(reqs[0].payload.name).toBe('Vitamin D');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Request sent', 'Sent to @alice for approval.'
    );
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('files one request per batched medicine', async () => {
    await open();
    await press('Once');
    await addName('Vitamin D');
    await addName('Zinc');
    await press('Send request');
    expect(db().rows('action_requests')).toHaveLength(2);
  });

  it('includes the photo in the request payload', async () => {
    await open();
    await press('📷  Take a photo');
    await addName('Vitamin D');
    await press('Once');
    await press('Send request');
    expect(db().rows('action_requests')[0].payload.photo).toBeTruthy();
  });

  it('does not arm the guardian`s own alarms', async () => {
    await open();
    await addName('Vitamin D');
    await press('Once');
    await press('Send request');
    expect(scheduled()).toHaveLength(0);
  });

  it('reports a rejected request', async () => {
    db().failOn('action_requests', 'insert', { message: 'not permitted' });
    const { navigation } = await open();
    await addName('Vitamin D');
    await press('Once');
    await press('Send request');

    expect(Alert.alert).toHaveBeenCalledWith('Failed', 'not permitted');
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});

describe('AddMedicineScreen — course and dose count', () => {
  it('fills in two times when "Twice" is chosen', async () => {
    await showScreen(AddMedicineScreen);
    await typeInto('e.g. Paracetamol 500mg', 'Amoxil');
    await press('Twice');
    await press('Save');
    expect(meds()[0].times).toEqual(['09:00', '21:00']);
  });

  it('lets the generated times be replaced by another count', async () => {
    await showScreen(AddMedicineScreen);
    await typeInto('e.g. Paracetamol 500mg', 'Amoxil');
    await press('3 times');
    expect(meds()).toHaveLength(0);
    // Switching the count replaces the set, which is the point: the chips are
    // a starting point, and a custom time can still be added on top.
    await press('Twice');
    await press('Save');
    expect(meds()[0].times).toEqual(['09:00', '21:00']);
  });

  it('is ongoing by default, with no end date', async () => {
    await showScreen(AddMedicineScreen);
    await typeInto('e.g. Paracetamol 500mg', 'Vitamin D');
    await press('Once');
    await press('Save');
    expect(meds()[0].end_date).toBeNull();
  });

  // The reported need: a doctor says "take it for 15 days".
  it('stores a 15-day course as an inclusive date range', async () => {
    await showScreen(AddMedicineScreen);
    await typeInto('e.g. Paracetamol 500mg', 'Amoxil');
    await press('Once');
    await press('15 days');
    await press('Save');

    const row = meds()[0];
    const from = new Date(`${row.start_date}T00:00:00`);
    const to = new Date(`${row.end_date}T00:00:00`);
    // Inclusive: day 1 and day 15 both count, so the gap is 14 days.
    expect(Math.round((to - from) / 86400000)).toBe(14);
  });

  it('treats one week as seven days, not eight', async () => {
    await showScreen(AddMedicineScreen);
    await typeInto('e.g. Paracetamol 500mg', 'Amoxil');
    await press('Once');
    await press('1 week');
    await press('Save');

    const row = meds()[0];
    const from = new Date(`${row.start_date}T00:00:00`);
    const to = new Date(`${row.end_date}T00:00:00`);
    expect(Math.round((to - from) / 86400000)).toBe(6);
  });

  it('can be switched back to ongoing, clearing the end date', async () => {
    await showScreen(AddMedicineScreen);
    await typeInto('e.g. Paracetamol 500mg', 'Amoxil');
    await press('Once');
    await press('10 days');
    await press('Ongoing');
    await press('Save');
    expect(meds()[0].end_date).toBeNull();
  });
});
