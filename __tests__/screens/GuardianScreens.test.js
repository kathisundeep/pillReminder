import { screen, fireEvent, act } from '@testing-library/react-native';
import { Alert, Share, Image } from 'react-native';
import * as Notifications from 'expo-notifications';
import { showScreen, press, typeInto, flush } from '../../test/renderScreen';
import GuardianScreen from '../../src/screens/GuardianScreen';
import GuardianDashboardScreen from '../../src/screens/GuardianDashboardScreen';
import GuardianUserScreen from '../../src/screens/GuardianUserScreen';
import ApprovalsScreen from '../../src/screens/ApprovalsScreen';
import CalendarScreen from '../../src/screens/CalendarScreen';
import TrackersScreen from '../../src/screens/TrackersScreen';
import { addReading } from '../../src/utils/health';
import {
  registerUser,
  loginUser,
  addMedicine,
  todayKey,
} from '../../src/utils/storage';
import { generatePairingCode } from '../../src/utils/guardianCloud';
import { ROLES } from '../../src/utils/role';

const db = () => globalThis.__db;

async function signIn(username) {
  await registerUser(username, 'password123');
  await loginUser(username, 'password123');
  return db().session.user;
}

beforeEach(() => {
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
});

// ===========================================================================
describe('GuardianScreen (patient side)', () => {
  // A patient with a plan: the default here is room for one guardian.
  async function patient({ plan = 'g1_m1' } = {}) {
    const alice = await signIn('alice');
    if (plan) db().subscribe(alice.id, plan);
    return alice;
  }

  it('shows there is no guardian yet, and the invite', async () => {
    await patient();
    await showScreen(GuardianScreen);
    expect(screen.getByText('Your guardians')).toBeTruthy();
    expect(screen.getByText('Your plan allows 1 guardian · 0 linked')).toBeTruthy();
    expect(screen.getByText(/No guardian linked yet/)).toBeTruthy();
    expect(screen.getByText('Invite a guardian')).toBeTruthy();
  });

  it('sends a user with no plan to the plans instead of offering a code', async () => {
    await patient({ plan: null });
    const { navigation } = await showScreen(GuardianScreen);

    expect(screen.getByText('Your plan does not include a guardian.')).toBeTruthy();
    expect(screen.queryByText('Generate pairing code')).toBeNull();
    await press('See plans');
    expect(navigation.navigate).toHaveBeenCalledWith('Plans');
  });

  it('says the plan is full once every place is taken', async () => {
    const alice = await patient();
    db().link(alice.id, db().makeUser('bob', { display_name: 'Bob Kumar' }).id);
    await showScreen(GuardianScreen);

    expect(screen.getByText('Bob Kumar')).toBeTruthy();
    expect(screen.getByText('@bob · linked')).toBeTruthy();
    expect(screen.getByText('Your plan is full')).toBeTruthy();
    expect(screen.queryByText('Generate pairing code')).toBeNull();
  });

  it('lists every guardian on a bigger plan, with room for more', async () => {
    const alice = await patient({ plan: 'g3_m6' });
    db().link(alice.id, db().makeUser('bob').id);
    db().link(alice.id, db().makeUser('carol').id);
    await showScreen(GuardianScreen);

    expect(screen.getByText('@bob · linked')).toBeTruthy();
    expect(screen.getByText('@carol · linked')).toBeTruthy();
    expect(screen.getByText('Your plan allows 3 guardians · 2 linked')).toBeTruthy();
    expect(screen.getByText('Invite a guardian')).toBeTruthy();
  });

  it('generates a 6-digit pairing code on demand', async () => {
    await patient();
    await showScreen(GuardianScreen);

    await press('Generate pairing code');
    const code = db().rows('pairing_codes')[0];
    expect(code.status).toBe('active');
    expect(screen.getByText(/expires in 30 days/)).toBeTruthy();
    expect(screen.getByText('Generate a new code')).toBeTruthy();
  });

  it('shares an invite containing the username and code', async () => {
    await patient();
    await showScreen(GuardianScreen);
    await press('Generate pairing code');
    await press('Share invite');

    expect(Share.share).toHaveBeenCalled();
    const { message } = Share.share.mock.calls[0][0];
    expect(message).toContain('alice');
    expect(message).toMatch(/\d{6}/);
  });

  it('offers no share button before a code exists', async () => {
    await patient();
    await showScreen(GuardianScreen);
    expect(screen.queryByText('Share invite')).toBeNull();
  });

  it('reports a failure to create a code', async () => {
    await patient();
    db().failOn('rpc', 'generate_pairing_code', { message: 'rate limited' });
    await showScreen(GuardianScreen);
    await press('Generate pairing code');
    expect(Alert.alert).toHaveBeenCalledWith('Could not create code', 'rate limited');
  });

  it('removes one guardian after confirmation, leaving the others', async () => {
    const alice = await patient({ plan: 'g2_m1' });
    const bob = db().makeUser('bob');
    const carol = db().makeUser('carol');
    db().link(alice.id, bob.id);
    db().link(alice.id, carol.id);
    await showScreen(GuardianScreen);

    await press(screen.getByLabelText('Remove @bob'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Remove guardian', 'Stop sharing with @bob?', expect.any(Array)
    );
    await act(async () => {
      await globalThis.pressAlertButton('Remove');
    });
    await flush();

    const status = (id) => db().rows('guardian_links').find((l) => l.guardian_id === id).status;
    expect(status(bob.id)).toBe('deactivated');
    expect(status(carol.id)).toBe('active');
    expect(screen.queryByText('@bob · linked')).toBeNull();
  });

  it('keeps the guardian when the removal is cancelled', async () => {
    const alice = await patient();
    db().link(alice.id, db().makeUser('bob').id);
    await showScreen(GuardianScreen);

    await press(screen.getByLabelText('Remove @bob'));
    await act(async () => {
      await globalThis.pressAlertButton('Cancel');
    });
    await flush();
    expect(db().rows('guardian_links')[0].status).toBe('active');
  });

  it('shows the default alert settings', async () => {
    await signIn('alice');
    await showScreen(GuardianScreen);
    expect(screen.getByText('Alert my guardian if I`m late by'.replace('`', "'"))).toBeTruthy();
    for (const label of ['5 min', '15 min', '30 min', '60 min']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('persists a new grace period', async () => {
    const alice = await signIn('alice');
    await showScreen(GuardianScreen);
    await press('60 min');

    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    expect(profile.settings.graceMinutes).toBe(60);
  });

  it('offers all three notification modes', async () => {
    await signIn('alice');
    await showScreen(GuardianScreen);
    expect(screen.getByText('Notify my guardian')).toBeTruthy();
    for (const label of [
      'When I miss a dose', 'When I take a dose', 'Both',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it.each([
    ['When I miss a dose', 'missed'],
    ['When I take a dose', 'intake'],
    ['Both', 'both'],
  ])('persists "%s" as notifyMode=%s', async (label, mode) => {
    const alice = await signIn('alice');
    await showScreen(GuardianScreen);
    await press(label);

    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    expect(profile.settings.notifyMode).toBe(mode);
  });

  it('defaults to missed-only', async () => {
    const alice = await signIn('alice');
    await showScreen(GuardianScreen);
    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    expect(profile.settings.notifyMode).toBe('missed');
  });

  it('persists the approval-required toggle', async () => {
    const alice = await signIn('alice');
    await showScreen(GuardianScreen);

    const switches = screen.UNSAFE_getAllByType(require('react-native').Switch);
    await act(async () => {
      switches[0].props.onValueChange(false);
    });
    await flush();

    const profile = db().rows('profiles').find((p) => p.id === alice.id);
    expect(profile.settings.approvalRequired).toBe(false);
  });
});

// ===========================================================================
describe('GuardianDashboardScreen', () => {
  it('greets the guardian and shows the pairing form', async () => {
    await signIn('bob');
    await showScreen(GuardianDashboardScreen, { role: ROLES.GUARDIAN });
    expect(screen.getByText('Guardian Dashboard')).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.getByPlaceholderText('Their username')).toBeTruthy();
    expect(screen.getByPlaceholderText('6-digit code')).toBeTruthy();
  });

  it('says when nobody is linked', async () => {
    await signIn('bob');
    await showScreen(GuardianDashboardScreen, { role: ROLES.GUARDIAN });
    expect(screen.getByText('No one linked yet')).toBeTruthy();
  });

  it('requires both a username and a code', async () => {
    await signIn('bob');
    await showScreen(GuardianDashboardScreen, { role: ROLES.GUARDIAN });
    await press('Link');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Missing', "Enter the person's username and their 6-digit code."
    );
  });

  it('links a person with a valid code and lists them', async () => {
    const alice = db().makeUser('alice', { display_name: 'Alice R' });
    db().subscribe(alice.id);
    db().as(alice);
    const code = await generatePairingCode();

    await signIn('bob');
    await showScreen(GuardianDashboardScreen, { role: ROLES.GUARDIAN });
    await typeInto('Their username', 'alice');
    await typeInto('6-digit code', code);
    await press('Link');

    expect(Alert.alert).toHaveBeenCalledWith(
      'Linked', 'You are now the guardian for alice.'
    );
    expect(screen.getByText('Alice R')).toBeTruthy();
    expect(screen.getByText('@alice · Active link')).toBeTruthy();
  });

  it('reports a bad code without linking', async () => {
    db().makeUser('alice');
    await signIn('bob');
    await showScreen(GuardianDashboardScreen, { role: ROLES.GUARDIAN });
    await typeInto('Their username', 'alice');
    await typeInto('6-digit code', '000000');
    await press('Link');

    expect(Alert.alert).toHaveBeenCalledWith(
      'Could not link', expect.stringMatching(/do not match/i)
    );
    expect(db().rows('guardian_links')).toHaveLength(0);
  });

  // SEC-04: an unknown username must be indistinguishable from a wrong code,
  // or the screen becomes an account-enumeration oracle.
  it('reports an unknown username exactly like a wrong code', async () => {
    await signIn('bob');
    await showScreen(GuardianDashboardScreen, { role: ROLES.GUARDIAN });
    await typeInto('Their username', 'ghost');
    await typeInto('6-digit code', '123456');
    await press('Link');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Could not link', expect.stringMatching(/do not match/i)
    );
  });

  it('restricts the code field to 6 numeric characters', async () => {
    await signIn('bob');
    await showScreen(GuardianDashboardScreen);
    const input = screen.getByPlaceholderText('6-digit code');
    expect(input.props.maxLength).toBe(6);
    expect(input.props.keyboardType).toBe('number-pad');
  });

  it('offers every action for a linked person', async () => {
    const alice = db().makeUser('alice');
    const bob = await signIn('bob');
    db().link(alice.id, bob.id);

    const { navigation } = await showScreen(GuardianDashboardScreen, {
      role: ROLES.GUARDIAN,
    });
    const person = { userId: alice.id, username: 'alice' };

    await press("💊  Today's medicines");
    expect(navigation.navigate).toHaveBeenCalledWith('GuardianUser', person);
    await press('🗓  Calendar');
    expect(navigation.navigate).toHaveBeenCalledWith('Calendar', person);
    await press('📄  Health report');
    expect(navigation.navigate).toHaveBeenCalledWith('HealthReport', person);
    await press('🩺  Add reading');
    expect(navigation.navigate).toHaveBeenCalledWith('Trackers', person);
    await press('➕  Propose');
    expect(navigation.navigate).toHaveBeenCalledWith('AddMedicine', {
      requestUserId: alice.id, requestUsername: 'alice',
    });
  });

  it('moves the code form off the dashboard once someone is linked', async () => {
    const alice = db().makeUser('alice');
    const bob = await signIn('bob');
    db().link(alice.id, bob.id);

    const { navigation } = await showScreen(GuardianDashboardScreen, {
      role: ROLES.GUARDIAN,
    });
    expect(screen.queryByPlaceholderText('6-digit code')).toBeNull();

    await press(screen.getByLabelText('Link another person'));
    expect(navigation.navigate).toHaveBeenCalledWith('GuardianLink');
  });

  it('keeps no link icon while nobody is linked — the form is right there', async () => {
    await signIn('bob');
    await showScreen(GuardianDashboardScreen, { role: ROLES.GUARDIAN });
    expect(screen.getByPlaceholderText('6-digit code')).toBeTruthy();
    expect(screen.queryByLabelText('Link another person')).toBeNull();
  });

  it('offers no route into the patient flow', async () => {
    // A guardian account has no medicines of its own, so there is no shortcut
    // into the patient Home.
    await signIn('bob');
    await showScreen(GuardianDashboardScreen, { role: ROLES.GUARDIAN });
    expect(screen.queryByText('My medicines')).toBeNull();
    expect(screen.queryByText("Today's Doses")).toBeNull();
  });

  it('logs out by dropping the role', async () => {
    await signIn('bob');
    const { setRole } = await showScreen(GuardianDashboardScreen, {
      role: ROLES.GUARDIAN,
    });

    await press('🚪');
    expect(setRole).toHaveBeenCalledWith(null);
  });
});

// ===========================================================================
describe('GuardianUserScreen', () => {
  async function linkedTo(patientMeds = []) {
    const alice = db().makeUser('alice');
    db().as(alice);
    for (const m of patientMeds) {
      // eslint-disable-next-line no-await-in-loop
      await addMedicine(null, m);
    }
    const bob = await signIn('bob');
    db().link(alice.id, bob.id);
    return { alice, bob };
  }

  it('titles the screen with the person`s handle', async () => {
    const { alice } = await linkedTo();
    await showScreen(GuardianUserScreen, { params: { userId: alice.id, username: 'alice' } });
    expect(screen.getByText('@alice')).toBeTruthy();
  });

  it('says when the person has no medicines', async () => {
    const { alice } = await linkedTo();
    await showScreen(GuardianUserScreen, { params: { userId: alice.id, username: 'alice' } });
    expect(screen.getByText('No medicines yet')).toBeTruthy();
  });

  it('groups today`s doses into time slots, as the person sees them', async () => {
    const { alice } = await linkedTo([
      { name: 'Aspirin', times: ['08:00', '20:00'], form: 'Tablet' },
      { name: 'Metformin', times: ['08:00'] },
    ]);
    await showScreen(GuardianUserScreen, { params: { userId: alice.id, username: 'alice' } });

    expect(screen.getByText('8:00 AM Slot')).toBeTruthy();
    expect(screen.getByText('8:00 PM Slot')).toBeTruthy();
    expect(screen.getAllByText('Aspirin')).toHaveLength(2);
    expect(screen.getByText('Metformin')).toBeTruthy();
  });

  it('shows each dose`s status and a settled slot`s summary', async () => {
    const { alice } = await linkedTo([
      { name: 'Aspirin', times: ['08:00'] },
      { name: 'Metformin', times: ['08:00'] },
    ]);
    const [a, m] = db().rows('medicines');
    for (const med of [a, m]) {
      db().rows('dose_history').push({
        user_id: alice.id, medicine_id: med.id, day: todayKey(), slot: '08:00',
        status: med === a ? 'taken' : 'skipped', at: new Date().toISOString(),
      });
    }
    await showScreen(GuardianUserScreen, { params: { userId: alice.id, username: 'alice' } });

    expect(screen.getByText('1 of 2 taken')).toBeTruthy();
    expect(screen.getByText('✓ Taken')).toBeTruthy();
    expect(screen.getByText('✕ Skipped')).toBeTruthy();
  });

  // The guardian must never set a dose's status — only the person can.
  it('offers no way to change a dose', async () => {
    const { alice } = await linkedTo([{ name: 'Aspirin', times: ['08:00'] }]);
    await showScreen(GuardianUserScreen, { params: { userId: alice.id, username: 'alice' } });

    expect(screen.getByText('View only')).toBeTruthy();
    expect(screen.queryByLabelText(/Tap to change/)).toBeNull();
    expect(screen.queryByText('Reschedule')).toBeNull();
    expect(screen.queryByText('✗ Skip')).toBeNull();
  });

  it('shows a medicine photo instead of the colour dot', async () => {
    const { alice } = await linkedTo([
      { name: 'Aspirin', times: ['08:00'], photo: 'GUARDIANVIEW' },
    ]);
    await showScreen(GuardianUserScreen, { params: { userId: alice.id, username: 'alice' } });

    const images = screen.UNSAFE_getAllByType(Image);
    expect(images.some((i) => i.props.source?.uri === 'data:image/jpeg;base64,GUARDIANVIEW')).toBe(true);
  });

  it('opens the calendar, report, readings and request form for the person', async () => {
    const { alice } = await linkedTo();
    const { navigation } = await showScreen(GuardianUserScreen, {
      params: { userId: alice.id, username: 'alice' },
    });
    const person = { userId: alice.id, username: 'alice' };

    await press('Calendar');
    expect(navigation.navigate).toHaveBeenCalledWith('Calendar', person);
    await press('Health report');
    expect(navigation.navigate).toHaveBeenCalledWith('HealthReport', person);
    await press('Add reading');
    expect(navigation.navigate).toHaveBeenCalledWith('Trackers', person);
    await press('Propose');
    expect(navigation.navigate).toHaveBeenCalledWith('AddMedicine', {
      requestUserId: alice.id, requestUsername: 'alice',
    });
  });

  it('shows nothing once the link is revoked', async () => {
    const { alice } = await linkedTo([{ name: 'Aspirin', times: ['08:00'] }]);
    db().rows('guardian_links')[0].status = 'deactivated';

    await showScreen(GuardianUserScreen, { params: { userId: alice.id, username: 'alice' } });
    expect(screen.getByText('No medicines yet')).toBeTruthy();
  });
});

// ===========================================================================
describe('Guardian — calendar and readings for a linked person', () => {
  async function linked() {
    const alice = db().makeUser('alice');
    db().as(alice);
    await addMedicine(null, { name: 'Aspirin', times: ['08:00'] });
    const bob = await signIn('bob');
    db().link(alice.id, bob.id);
    return { alice, bob };
  }

  it('shows the person`s calendar, not the guardian`s own', async () => {
    const { alice } = await linked();
    await showScreen(CalendarScreen, { params: { userId: alice.id, username: 'alice' } });

    expect(screen.getAllByText('@alice · Adherence').length).toBeGreaterThan(0);
    expect(screen.queryByText('No medicines yet')).toBeNull();
  });

  it('records a reading for the person, marked as entered by the guardian', async () => {
    const { alice, bob } = await linked();
    await showScreen(TrackersScreen, { params: { userId: alice.id, username: 'alice' } });
    expect(screen.getByText('Reading for @alice')).toBeTruthy();

    await addReading('sugar', { value: 110 }, null, alice.id);
    const [row] = db().rows('health_readings');
    expect(row).toMatchObject({ user_id: alice.id, recorded_by: bob.id });
  });

  it('refuses a reading for someone the guardian is not linked to', async () => {
    const stranger = db().makeUser('stranger');
    await signIn('bob');
    await expect(addReading('sugar', { value: 110 }, null, stranger.id)).rejects.toThrow(
      /not switched on yet|row-level/
    );
    expect(db().rows('health_readings')).toHaveLength(0);
  });

  it('offers no delete on the person`s readings', async () => {
    const { alice } = await linked();
    await addReading('sugar', { value: 110 }, null, alice.id);
    await showScreen(TrackersScreen, { params: { userId: alice.id, username: 'alice' } });

    expect(screen.queryByText('Long-press a reading to delete it.')).toBeNull();
  });
});

// ===========================================================================
describe('ApprovalsScreen', () => {
  async function withRequest(payload = { name: 'Vitamin D', times: ['09:00'] }) {
    const alice = await signIn('alice');
    const bob = db().makeUser('bob');
    db().link(alice.id, bob.id);
    db().seed('action_requests', [
      { user_id: alice.id, guardian_id: bob.id, kind: 'add_medicine', payload, status: 'pending' },
    ]);
    return { alice, bob };
  }

  it('says when there is nothing to review', async () => {
    await signIn('alice');
    await showScreen(ApprovalsScreen);
    expect(screen.getByText('No pending requests')).toBeTruthy();
  });

  it('shows what the guardian wants to add', async () => {
    await withRequest({ name: 'Vitamin D', times: ['09:00', '21:00'], form: 'Capsule' });
    await showScreen(ApprovalsScreen);

    expect(screen.getByText('Guardian wants to add:')).toBeTruthy();
    expect(screen.getByText('Vitamin D')).toBeTruthy();
    expect(screen.getByText(/Capsule/)).toBeTruthy();
    expect(screen.getByText('9:00 AM  •  9:00 PM')).toBeTruthy();
  });

  it('shows the proposed medicine`s photo', async () => {
    await withRequest({ name: 'Vitamin D', times: ['09:00'], photo: 'REQPHOTO' });
    await showScreen(ApprovalsScreen);

    const images = screen.UNSAFE_getAllByType(Image);
    expect(images.some((i) => i.props.source?.uri === 'data:image/jpeg;base64,REQPHOTO')).toBe(true);
  });

  it('approving creates the medicine on the patient`s account', async () => {
    const { alice } = await withRequest();
    await showScreen(ApprovalsScreen);
    await press('Approve');

    const meds = db().rows('medicines');
    expect(meds).toHaveLength(1);
    expect(meds[0].name).toBe('Vitamin D');
    expect(meds[0].user_id).toBe(alice.id);
    expect(db().rows('action_requests')[0].status).toBe('approved');
    expect(screen.getByText('No pending requests')).toBeTruthy();
  });

  it('approving arms the new medicine`s alarms', async () => {
    await withRequest();
    await showScreen(ApprovalsScreen);
    await press('Approve');

    expect(Notifications.__state.scheduled).toHaveLength(1);
    expect(Notifications.__state.scheduled[0].trigger.hour).toBe(9);
  });

  it('approving carries the photo onto the medicine', async () => {
    await withRequest({ name: 'Vitamin D', times: ['09:00'], photo: 'REQPHOTO' });
    await showScreen(ApprovalsScreen);
    await press('Approve');
    expect(db().rows('medicines')[0].photo).toBe('REQPHOTO');
  });

  it('rejecting creates nothing and clears the request', async () => {
    await withRequest();
    await showScreen(ApprovalsScreen);
    await press('Reject');

    expect(db().rows('medicines')).toHaveLength(0);
    expect(db().rows('action_requests')[0].status).toBe('rejected');
    expect(screen.getByText('No pending requests')).toBeTruthy();
  });

  it('reports a failure to approve and leaves the request pending', async () => {
    await withRequest();
    db().failOn('medicines', 'insert', { message: 'insert denied' });
    await showScreen(ApprovalsScreen);
    await press('Approve');

    expect(Alert.alert).toHaveBeenCalledWith('Could not approve', 'insert denied');
    expect(db().rows('action_requests')[0].status).toBe('pending');
  });

  it('lists several pending requests', async () => {
    const { alice, bob } = await withRequest();
    db().seed('action_requests', [
      {
        user_id: alice.id, guardian_id: bob.id, kind: 'add_medicine',
        payload: { name: 'Zinc', times: ['10:00'] }, status: 'pending',
      },
    ]);
    await showScreen(ApprovalsScreen);
    expect(screen.getAllByText('Guardian wants to add:')).toHaveLength(2);
  });
});
