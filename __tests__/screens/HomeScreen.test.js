import { fireEvent, screen, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import { renderScreen } from '../../test/renderScreen';
import HomeScreen from '../../src/screens/HomeScreen';
import {
  registerUser,
  loginUser,
  logoutUser,
  addMedicine,
  recordDose,
  getSession,
} from '../../src/utils/storage';

const db = () => globalThis.__db;
const pushes = () =>
  globalThis.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

// Tue 10 June 2025, local (IST).
function atLocal(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  jest.setSystemTime(new Date(2025, 5, 10, h, m, 0, 0));
}

async function signIn(username = 'alice') {
  await registerUser(username, 'password123');
  await loginUser(username, 'password123');
  return db().session.user;
}

// HomeScreen.load() is a deep promise chain (session -> medicines -> per-med
// dose entries -> pending requests -> profile). Drain it deterministically
// rather than racing it with waitFor.
async function flush(times = 25) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function show({ params } = {}) {
  const utils = renderScreen(HomeScreen, { params });
  await flush();
  return utils;
}

// Unfold a settled slot, found by its time ("8:00 AM").
async function openSlot(time) {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(new RegExp(`^${time} slot`)));
  });
  await flush(3);
}

// Open a dose's status dropdown and choose a new state. `which` picks the row
// when a medicine appears in more than one slot.
async function setStatus(label, which = 0) {
  const badges = screen.getAllByLabelText(/^Dose status:/);
  await act(async () => {
    fireEvent.press(badges[which]);
  });
  await flush(3);
  await act(async () => {
    fireEvent.press(screen.getByText(label));
  });
  await flush();
}

// Accepts a string, a regex, or an already-queried element.
async function press(target) {
  const el =
    typeof target === 'string' || target instanceof RegExp
      ? screen.getByText(target)
      : target;
  await act(async () => {
    fireEvent.press(el);
  });
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  atLocal('08:10'); // inside the 8 AM dose's grace, so it reads as due
});

describe('HomeScreen — session', () => {
  // Logging out clears the active role, which swaps the whole navigator back to
  // the Login flow. There is no 'Login' route inside the patient stack to
  // navigate to, so this is asserted on the role, not on navigation.
  it('drops the role when there is no session', async () => {
    const { setRole } = renderScreen(HomeScreen);
    await waitFor(() => expect(setRole).toHaveBeenCalledWith(null));
  });

  it('greets the signed-in user by name', async () => {
    await signIn();
    await show();
    expect(screen.getByText('alice')).toBeTruthy();
  });

  it('no longer carries a log out control — that lives in Settings', async () => {
    await signIn();
    await show();
    expect(screen.queryByText('Log out')).toBeNull();
  });
});

describe('HomeScreen — profile prompt', () => {
  it('nudges the user to finish their details, without blocking anything', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    const { navigation } = await show();

    expect(screen.getByText('Finish setting up your profile')).toBeTruthy();
    // The schedule is still right there — the prompt is not a gate.
    expect(screen.getByText(/Aspirin/)).toBeTruthy();

    await press('Finish setting up your profile');
    expect(navigation.navigate).toHaveBeenCalledWith('ProfileDetails');
  });

  it('stops nudging once the details step has been completed or skipped', async () => {
    const user = await signIn();
    db().rows('profiles').find((p) => p.id === user.id).onboarded_at =
      new Date().toISOString();
    await show();
    expect(screen.queryByText('Finish setting up your profile')).toBeNull();
  });

  it('can be dismissed for the session', async () => {
    await signIn();
    await show();
    await press('✕');
    expect(screen.queryByText('Finish setting up your profile')).toBeNull();
  });
});

describe('HomeScreen — medicine list', () => {
  it('shows the empty state with no medicines', async () => {
    await signIn();
    await show();
    expect(screen.getByText('No medicines yet')).toBeTruthy();
    expect(screen.getByText(/Tap "Add" below/)).toBeTruthy();
  });

  it('groups medicines into time slots, formatted for humans', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00', '20:00'] });
    await addMedicine(null, { name: 'Metformin', times: ['08:00'] });
    await show();

    expect(screen.getByText('8:00 AM Slot')).toBeTruthy();
    expect(screen.getByText('8:00 PM Slot')).toBeTruthy();
    expect(screen.getAllByText(/Aspirin/)).toHaveLength(2); // in both slots
    expect(screen.getAllByText(/Metformin/)).toHaveLength(1);
    // Each slot is labelled by time of day, as in the reference design.
    expect(screen.getByText('Morning')).toBeTruthy();
    expect(screen.getByText('Evening')).toBeTruthy();
  });

  it('orders slots chronologically', async () => {
    await signIn();
    await addMedicine(null, { name: 'Night', times: ['22:00'] });
    await addMedicine(null, { name: 'Morning', times: ['06:00'] });
    await show();

    const times = screen
      .getAllByText(/^\d{1,2}:\d{2} (AM|PM) Slot$/)
      .map((n) => n.props.children.join(''));
    expect(times).toEqual(['6:00 AM Slot', '10:00 PM Slot']);
  });

  it('separates medicines not scheduled for today', async () => {
    await signIn();
    // 10 June 2025 is a Tuesday (2).
    await addMedicine(null, {
      name: 'Weekend only', times: ['09:00'], frequency: 'weekly', daysOfWeek: [0, 6],
    });
    await show();

    expect(screen.getByText('Other days')).toBeTruthy();
    expect(screen.getByText('Weekend only')).toBeTruthy();
    expect(screen.getByText('9:00 AM')).toBeTruthy(); // listed, not scheduled
    // ...and no slot card was rendered for it today.
    expect(screen.queryByText('9:00 AM Slot')).toBeNull();
  });

  it('shows the medicine form and frequency under the name', async () => {
    await signIn();
    await addMedicine(null, { name: 'Cough syrup', times: ['08:00'], form: 'Syrup' });
    await show();
    expect(screen.getByText('Cough syrup')).toBeTruthy();
    expect(screen.getByText(/Syrup/)).toBeTruthy();
    expect(screen.getByText(/Daily/)).toBeTruthy();
  });

  it('marks a passed dose Due and a future one Upcoming', async () => {
    await signIn();
    await addMedicine(null, { name: 'Past', times: ['08:00'] });
    await addMedicine(null, { name: 'Future', times: ['18:00'] });
    await show();

    expect(screen.getByText('⏳ Due')).toBeTruthy();
    expect(screen.getByText('Upcoming')).toBeTruthy();
  });

  it('marks a slot Taken once its medicine is taken', async () => {
    await signIn();
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await recordDose(null, id, 'taken', '08:00');
    await show();

    expect(screen.getByText('✓ Taken')).toBeTruthy();
    expect(screen.queryByText('⏳ Due')).toBeNull();
  });

  it('tags a skipped and a snoozed medicine', async () => {
    await signIn();
    const skipped = await addMedicine(null, { name: 'Skipped med', times: ['08:00'] });
    const snoozed = await addMedicine(null, { name: 'Snoozed med', times: ['08:00'], snoozeMinutes: 30 });
    await recordDose(null, skipped, 'skipped', '08:00');
    atLocal('11:50');
    await recordDose(null, snoozed, 'snoozed', '08:00');
    atLocal('12:00');
    await show();
    await openSlot('8:00 AM');

    expect(screen.getByText('✕ Skipped')).toBeTruthy();
    expect(screen.getByText('💤 Snoozed')).toBeTruthy();
  });

  // Was BUG-06: "taken" was a property of the whole day, so taking the morning
  // dose pre-ticked and struck through the evening one.
  it('taking the morning dose leaves the evening slot due', async () => {
    await signIn();
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00', '20:00'] });
    await recordDose(null, id, 'taken', '08:00');
    atLocal('20:15'); // inside the 8 PM dose's grace
    await show();
    await openSlot('8:00 AM');

    // Read the two status badges directly: the 8 PM slot also renders a
    // "✓ Taken" bulk-action button, which is a different control.
    const states = screen
      .getAllByLabelText(/^Dose status:/)
      .map((n) => n.props.accessibilityLabel);
    expect(states[0]).toContain('✓ Taken');
    expect(states[1]).toContain('⏳ Due');
  });

  it('marks only the chosen dose taken', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00', '20:00'] });
    atLocal('20:15');
    await show();
    // The 8 AM dose is past its grace, so its slot is folded as missed.
    await openSlot('8:00 AM');

    // Two rows on screen, one per slot; act on the first (08:00).
    await setStatus('Taken', 0);

    const taken = db().rows('dose_history').filter((r) => r.status === 'taken');
    expect(taken).toHaveLength(1);
    expect(taken[0].slot).toBe('08:00');
  });

  it('renders a photo thumbnail when the medicine has one', async () => {
    await signIn();
    await addMedicine(null, { name: 'WithPhoto', times: ['08:00'], photo: 'BASE64DATA' });
    await show();

    const images = screen.UNSAFE_getAllByType(require('react-native').Image);
    expect(images.some((i) => i.props.source?.uri === 'data:image/jpeg;base64,BASE64DATA')).toBe(true);
  });
});

describe('HomeScreen — marking doses', () => {
  it('marks a dose taken from the status dropdown', async () => {
    await signIn();
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await show();

    await setStatus('Taken');

    const taken = db().rows('dose_history').filter((r) => r.status === 'taken');
    expect(taken).toHaveLength(1);
    expect(taken[0].medicine_id).toBe(id);
    expect(taken[0].slot).toBe('08:00');
  });

  it('offers every dose state up front', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await show();

    await act(async () => {
      fireEvent.press(screen.getAllByLabelText(/^Dose status:/)[0]);
    });
    await flush(3);

    expect(screen.getByText('Mark this dose as')).toBeTruthy();
    for (const label of ['Taken', 'Snoozed', 'Skipped']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // Due is a state, not an answer, so it is not offered.
    expect(screen.queryByText('Due')).toBeNull();
  });

  it('changes a taken dose to skipped', async () => {
    await signIn();
    const id = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await recordDose(null, id, 'taken', '08:00');
    await show();
    await openSlot('8:00 AM');

    await setStatus('Skipped');

    expect(db().rows('dose_history').filter((r) => r.status === 'taken')).toHaveLength(0);
    expect(screen.getAllByText('✕ Skipped').length).toBeGreaterThan(0);
  });

  it('records a snooze and arms a re-alarm from the dropdown', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'], snoozeMinutes: 15 });
    await show();

    await setStatus('Snoozed');

    expect(db().rows('dose_history').filter((r) => r.status === 'snoozed')).toHaveLength(1);
    const snooze = Notifications.__state.scheduled.find(
      (n) => n.content.title === 'Snoozed reminder'
    );
    expect(snooze.trigger.seconds).toBe(900);
    expect(snooze.content.data.slot).toBe('08:00');
  });

  it('records a skip from the dropdown', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await show();

    await setStatus('Skipped');

    expect(db().rows('dose_history').filter((r) => r.status === 'skipped')).toHaveLength(1);
  });

  it('"Taken" marks every medicine in the slot', async () => {
    await signIn();
    await addMedicine(null, { name: 'A', times: ['08:00'] });
    await addMedicine(null, { name: 'B', times: ['08:00'] });
    await show();

    await press('✓ Taken');

    await waitFor(() =>
      expect(db().rows('dose_history').filter((r) => r.status === 'taken')).toHaveLength(2)
    );
  });

  it('"Skip" records a skip for the whole slot', async () => {
    await signIn();
    await addMedicine(null, { name: 'A', times: ['08:00'] });
    await addMedicine(null, { name: 'B', times: ['08:00'] });
    await show();

    await press('✗ Skip');

    await waitFor(() =>
      expect(db().rows('dose_history').filter((r) => r.status === 'skipped')).toHaveLength(2)
    );
  });

  it('"Reschedule" logs a snooze and arms a new local alarm per medicine', async () => {
    await signIn();
    await addMedicine(null, { name: 'A', times: ['08:00'], snoozeMinutes: 15 });
    await addMedicine(null, { name: 'B', times: ['08:00'] });
    await show();

    await press('Reschedule');

    await waitFor(() =>
      expect(db().rows('dose_history').filter((r) => r.status === 'snoozed')).toHaveLength(2)
    );
    const snoozeNotifs = Notifications.__state.scheduled.filter(
      (n) => n.content.title === 'Snoozed reminder'
    );
    expect(snoozeNotifs).toHaveLength(2);
    expect(snoozeNotifs[0].trigger.seconds).toBe(900); // 15 min
    expect(snoozeNotifs[1].trigger.seconds).toBe(600); // default 10 min
  });

  // Was BUG-08 — now fixed.
  it('keeps the medicine`s chosen tone when rescheduling', async () => {
    await signIn();
    await addMedicine(null, { name: 'A', times: ['08:00'], toneId: 'siren' });
    await show();

    await press('Reschedule');

    await waitFor(() =>
      expect(Notifications.__state.scheduled.some((n) => n.content.title === 'Snoozed reminder')).toBe(true)
    );
    const snooze = Notifications.__state.scheduled.find(
      (n) => n.content.title === 'Snoozed reminder'
    );
    expect(snooze.content.sound).toBe('siren');
    expect(snooze.trigger.channelId).toBe('pill-alarm-siren');
  });

  it('bulk actions leave an already-taken medicine alone', async () => {
    await signIn();
    const a = await addMedicine(null, { name: 'A', times: ['08:00'] });
    await addMedicine(null, { name: 'B', times: ['08:00'] });
    await recordDose(null, a, 'taken', '08:00');
    await show();

    await press('✗ Skip');

    await waitFor(() =>
      expect(db().rows('dose_history').filter((r) => r.status === 'skipped')).toHaveLength(1)
    );
  });

  it('notifies the guardian on taken when the user opted into "both"', async () => {
    const alice = await signIn();
    const bob = db().makeUser('bob', { push_token: 'ExponentPushToken[bob]' });
    db().link(alice.id, bob.id);
    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    profile.settings = { ...profile.settings, notifyMode: 'both' };

    // Due 10 minutes ago: inside the 30-minute grace, so the missed-dose sweep
    // that also runs on load stays quiet and only the "taken" push is sent.
    await addMedicine(null, { name: 'Aspirin', times: ['11:50'] });
    await show();

    await setStatus('Taken');

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(pushes()).toHaveLength(1);
    expect(pushes()[0].title).toBe('Medicine taken');
    expect(pushes()[0].body).toBe('alice just took Aspirin.');
  });
});

describe('HomeScreen — editing', () => {
  it('offers Edit and Delete on press and hold', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    const { navigation } = await show();

    await act(async () => {
      fireEvent(screen.getByText('Aspirin'), 'longPress');
    });
    expect(screen.getByText('🗑  Delete')).toBeTruthy();

    await press('✏️  Edit');
    expect(navigation.navigate).toHaveBeenCalledWith('AddMedicine', {
      medicineId: db().rows('medicines')[0].id,
    });
  });

  it('asks before deleting from the press-and-hold menu', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await show();

    await act(async () => {
      fireEvent(screen.getByText('Aspirin'), 'longPress');
    });
    await press('🗑  Delete');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete Aspirin?',
      'This removes the medicine, its alarms and its dose history.',
      expect.any(Array)
    );
    await act(async () => {
      await globalThis.pressAlertButton('Delete');
    });
    await flush();

    await waitFor(() => expect(db().rows('medicines')).toHaveLength(0));
  });

  it('deletes from the swipe button only after confirming', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await show();

    // The red button sits under the row; a swipe uncovers it.
    await press(screen.getByLabelText('Delete Aspirin'));
    expect(db().rows('medicines')).toHaveLength(1);

    await act(async () => {
      await globalThis.pressAlertButton('Cancel');
    });
    await flush();
    expect(db().rows('medicines')).toHaveLength(1);

    await press(screen.getByLabelText('Delete Aspirin'));
    await act(async () => {
      await globalThis.pressAlertButton('Delete');
    });
    await flush();
    await waitFor(() => expect(db().rows('medicines')).toHaveLength(0));
  });

  it('marks a whole slot from press and hold on its header', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await addMedicine(null, { name: 'Metformin', times: ['08:00'] });
    await show();

    await act(async () => {
      fireEvent(screen.getByLabelText(/^8:00 AM slot/), 'longPress');
    });
    expect(screen.getByText('Aspirin, Metformin')).toBeTruthy();
    await press('✓  Mark all taken');

    expect(db().rows('dose_history').filter((r) => r.status === 'taken')).toHaveLength(2);
    expect(screen.getByText('✓ All 2 taken')).toBeTruthy();
  });

  it('shows the gesture tip until it is dismissed', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await show();
    expect(screen.getByText(/Press and hold a medicine/)).toBeTruthy();

    await press(screen.getByLabelText('Dismiss tip'));
    expect(screen.queryByText(/Press and hold a medicine/)).toBeNull();
  });

  it('opens the editor for a medicine listed under Other days', async () => {
    await signIn();
    await addMedicine(null, {
      name: 'Weekend only', times: ['09:00'], frequency: 'weekly', daysOfWeek: [0, 6],
    });
    const { navigation } = await show();

    await press('Weekend only');
    expect(navigation.navigate).toHaveBeenCalledWith('AddMedicine', {
      medicineId: db().rows('medicines')[0].id,
    });
  });

  // Report moved off the bar to make room for Calendar; it is now reached
  // from the Calendar screen, so it is still one tap from here.
  it.each([
    ['Add', 'AddMedicine'],
    ['Calendar', 'Calendar'],
    ['Trackers', 'Trackers'],
    ['Settings', 'Settings'],
  ])('the bottom bar item "%s" opens %s', async (label, route) => {
    await signIn();
    const { navigation } = await show();
    fireEvent.press(screen.getByText(label));
    expect(navigation.navigate).toHaveBeenCalledWith(route);
  });

  it('marks Home as the active bottom-bar item and does not re-navigate', async () => {
    await signIn();
    const { navigation } = await show();
    fireEvent.press(screen.getByText('Home'));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ['♥', 'Guardian'],
    ['🔔', 'Approvals'],
  ])('the header icon %s opens %s', async (label, route) => {
    await signIn();
    const { navigation } = await show();
    fireEvent.press(screen.getByText(label));
    expect(navigation.navigate).toHaveBeenCalledWith(route);
  });
});

describe('HomeScreen — guardian approval requests', () => {
  async function withPendingRequest({ approvalRequired = true } = {}) {
    const alice = await signIn('alice');
    const bob = db().makeUser('bob');
    db().link(alice.id, bob.id);

    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    profile.settings = { ...profile.settings, approvalRequired };

    db().seed('action_requests', [
      {
        user_id: alice.id,
        guardian_id: bob.id,
        kind: 'add_medicine',
        payload: { name: 'Vitamin D', times: ['09:00'] },
        status: 'pending',
      },
    ]);
    return { alice, bob };
  }

  it('shows a banner when approval is required', async () => {
    await withPendingRequest();
    const { navigation } = await show();

    await waitFor(() => expect(screen.getByText('1 guardian request to review')).toBeTruthy());
    fireEvent.press(screen.getByText('1 guardian request to review'));
    expect(navigation.navigate).toHaveBeenCalledWith('Approvals');
  });

  it('pluralises the banner', async () => {
    const { alice, bob } = await withPendingRequest();
    db().seed('action_requests', [
      {
        user_id: alice.id, guardian_id: bob.id, kind: 'add_medicine',
        payload: { name: 'Zinc', times: ['10:00'] }, status: 'pending',
      },
    ]);
    await show();
    await waitFor(() => expect(screen.getByText('2 guardian requests to review')).toBeTruthy());
  });

  it('auto-applies requests when the user turned approval off', async () => {
    await withPendingRequest({ approvalRequired: false });
    await show();

    await waitFor(() => expect(db().rows('medicines')).toHaveLength(1));
    expect(db().rows('medicines')[0].name).toBe('Vitamin D');
    expect(db().rows('action_requests')[0].status).toBe('approved');
    expect(screen.queryByText(/guardian request/)).toBeNull();
  });

  it('arms alarms for an auto-applied medicine', async () => {
    await withPendingRequest({ approvalRequired: false });
    await show();
    await waitFor(() => expect(Notifications.__state.scheduled).toHaveLength(1));
    expect(Notifications.__state.scheduled[0].trigger.hour).toBe(9);
  });

  it('shows no banner when there is nothing pending', async () => {
    await signIn();
    await show();
    expect(screen.queryByText(/guardian request/)).toBeNull();
  });

  // Was BUG-03/04: getPendingRequests was not scoped to the signed-in user, so
  // a guardian saw the request THEY filed and — with approval off — it was
  // applied to their own account. Both tests now prove the fix.
  it('never offers a guardian their own outgoing request to approve', async () => {
    const alice = db().makeUser('alice');
    await registerUser('bob', 'password123');
    await loginUser('bob', 'password123');
    const bob = db().session.user;
    db().link(alice.id, bob.id);

    db().seed('action_requests', [
      {
        user_id: alice.id, guardian_id: bob.id, kind: 'add_medicine',
        payload: { name: 'Vitamin D', times: ['09:00'] }, status: 'pending',
      },
    ]);

    await show();
    expect(screen.queryByText(/guardian request/)).toBeNull();
  });

  it('a guardian with approval off never copies their request into their own account', async () => {
    const alice = db().makeUser('alice');
    await registerUser('bob', 'password123');
    await loginUser('bob', 'password123');
    const bob = db().session.user;
    db().link(alice.id, bob.id);

    const bobProfile = db().rows('profiles').find((p) => p.id === bob.id);
    bobProfile.settings = { ...bobProfile.settings, approvalRequired: false };

    db().seed('action_requests', [
      {
        user_id: alice.id, guardian_id: bob.id, kind: 'add_medicine',
        payload: { name: 'Vitamin D', times: ['09:00'] }, status: 'pending',
      },
    ]);

    await show();

    // Nothing is created: the request belongs to alice, not to bob.
    expect(db().rows('medicines')).toHaveLength(0);
    expect(db().rows('action_requests')[0].status).toBe('pending');
    expect(alice.id).not.toBe(bob.id);
  });
});

describe('HomeScreen — resilience', () => {
  it('renders from the offline cache when the backend is unreachable', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    const { unmount } = await show();
    unmount();

    db().failOn('medicines', 'select', { message: 'offline' });
    await show();
    expect(screen.getByText(/Aspirin/)).toBeTruthy();
  });

  it('still renders when the approval lookup fails', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    db().failOn('action_requests', 'select', { message: 'boom' });

    await show();
    expect(screen.getByText(/Aspirin/)).toBeTruthy();
    expect(screen.queryByText(/guardian request/)).toBeNull();
  });

  it('pull-to-refresh picks up a medicine added elsewhere', async () => {
    await signIn();
    await show();
    expect(screen.getByText('No medicines yet')).toBeTruthy();

    await addMedicine(null, { name: 'Added later', times: ['08:00'] });

    const scroll = screen.UNSAFE_getByType(
      require('react-native').ScrollView
    );
    await act(async () => {
      scroll.props.refreshControl.props.onRefresh();
    });
    await flush();

    expect(screen.getByText(/Added later/)).toBeTruthy();
  });
});

describe('HomeScreen — settled slots fold away', () => {
  beforeEach(() => atLocal('12:00'));

  it('folds a slot once every dose in it is taken, and says so in green', async () => {
    await signIn();
    const a = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    const b = await addMedicine(null, { name: 'Metformin', times: ['08:00'] });
    await recordDose(null, a, 'taken', '08:00');
    await recordDose(null, b, 'taken', '08:00');
    await show();

    expect(screen.getByText('✓ All 2 taken')).toBeTruthy();
    expect(screen.getByText('Aspirin, Metformin')).toBeTruthy();
    expect(screen.queryAllByLabelText(/^Dose status:/)).toHaveLength(0);
  });

  it('opens on tap to show every dose, and folds again on a second tap', async () => {
    await signIn();
    const a = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await recordDose(null, a, 'taken', '08:00');
    await show();

    await openSlot('8:00 AM');
    expect(screen.getAllByLabelText(/^Dose status:/)).toHaveLength(1);

    await openSlot('8:00 AM');
    expect(screen.queryAllByLabelText(/^Dose status:/)).toHaveLength(0);
  });

  it('shows a partly taken slot as "1 of 2 taken"', async () => {
    await signIn();
    const a = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    const b = await addMedicine(null, { name: 'Metformin', times: ['08:00'] });
    await recordDose(null, a, 'taken', '08:00');
    await recordDose(null, b, 'skipped', '08:00');
    await show();

    expect(screen.getByText('1 of 2 taken')).toBeTruthy();
    expect(screen.getByText('1 skipped')).toBeTruthy();
  });

  it('shows a fully skipped slot as skipped', async () => {
    await signIn();
    const a = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await recordDose(null, a, 'skipped', '08:00');
    await show();

    expect(screen.getByText('✕ Skipped')).toBeTruthy();
    expect(screen.queryAllByLabelText(/^Dose status:/)).toHaveLength(0);
  });

  it('keeps a slot open while any dose still needs an answer', async () => {
    await signIn();
    const a = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await addMedicine(null, { name: 'Metformin', times: ['08:00'] });
    await recordDose(null, a, 'taken', '08:00');
    atLocal('08:10'); // Metformin still inside its grace
    await show();

    expect(screen.getAllByLabelText(/^Dose status:/)).toHaveLength(2);
    expect(screen.queryByText('1 of 2 taken')).toBeNull();
  });

  it('folds a slot as soon as its last dose is answered', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    atLocal('08:10');
    await show();

    await setStatus('Taken');

    expect(screen.getByText('✓ Taken')).toBeTruthy();
    expect(screen.queryAllByLabelText(/^Dose status:/)).toHaveLength(0);
  });

  it('folds a taken + missed slot as partial', async () => {
    await signIn();
    const a = await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await addMedicine(null, { name: 'Metformin', times: ['08:00'] });
    await recordDose(null, a, 'taken', '08:00');
    await show(); // 12:00 — Metformin's 8 AM dose is long past its grace

    expect(screen.getByText('1 of 2 taken')).toBeTruthy();
    expect(screen.getByText('1 missed')).toBeTruthy();
    expect(screen.queryAllByLabelText(/^Dose status:/)).toHaveLength(0);
  });

  it('folds an unanswered slot as missed once its grace runs out', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await addMedicine(null, { name: 'Metformin', times: ['08:00'] });
    await show();

    expect(screen.getByText('✕ All 2 missed')).toBeTruthy();
  });

  it('keeps an unanswered slot open inside its grace period', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    atLocal('08:20');
    await show();

    expect(screen.getAllByLabelText(/^Dose status:/)).toHaveLength(1);
  });

  it('lets a missed dose be marked taken later today', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    await show();
    await openSlot('8:00 AM');

    await setStatus('Taken');

    expect(db().rows('dose_history').filter((r) => r.status === 'taken')).toHaveLength(1);
    // Opened by hand, so it stays open: the summary and the dose both say so.
    expect(screen.getAllByText('✓ Taken')).toHaveLength(2);
  });

  // A Home left open overnight still shows yesterday; a change made on it
  // must not be written into today.
  it('refuses a change made on yesterday`s screen after midnight', async () => {
    await signIn();
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    atLocal('23:50');
    await show();
    await openSlot('8:00 AM'); // folded as missed by now

    jest.setSystemTime(new Date(2025, 5, 11, 0, 10, 0, 0));
    await setStatus('Taken');

    expect(db().rows('dose_history').filter((r) => r.status === 'taken')).toHaveLength(0);
  });
});
