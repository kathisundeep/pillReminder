import { screen, fireEvent, act } from '@testing-library/react-native';
import { Alert, Share, Image } from 'react-native';
import * as Notifications from 'expo-notifications';
import { showScreen, press, typeInto, flush } from '../../test/renderScreen';
import GuardianScreen from '../../src/screens/GuardianScreen';
import GuardianDashboardScreen from '../../src/screens/GuardianDashboardScreen';
import GuardianUserScreen from '../../src/screens/GuardianUserScreen';
import ApprovalsScreen from '../../src/screens/ApprovalsScreen';
import {
  registerUser,
  loginUser,
  addMedicine,
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
  it('shows there is no guardian yet', async () => {
    await signIn('alice');
    await showScreen(GuardianScreen);
    expect(screen.getByText('Your guardian')).toBeTruthy();
    expect(screen.getByText(/No guardian linked yet/)).toBeTruthy();
    expect(screen.getByText('Invite a guardian')).toBeTruthy();
  });

  it('shows the linked guardian and switches to "change" wording', async () => {
    const alice = await signIn('alice');
    const bob = db().makeUser('bob', { display_name: 'Bob Kumar' });
    db().link(alice.id, bob.id);

    await showScreen(GuardianScreen);
    expect(screen.getByText('Bob Kumar')).toBeTruthy();
    expect(screen.getByText('@bob · linked')).toBeTruthy();
    expect(screen.getByText('Change guardian')).toBeTruthy();
    expect(screen.getByText('Remove guardian')).toBeTruthy();
  });

  it('generates a 6-digit pairing code on demand', async () => {
    await signIn('alice');
    await showScreen(GuardianScreen);

    await press('Generate pairing code');
    const code = db().rows('pairing_codes')[0];
    expect(code.status).toBe('active');
    expect(screen.getByText(/expires in 30 days/)).toBeTruthy();
    expect(screen.getByText('Generate a new code')).toBeTruthy();
  });

  it('shares an invite containing the username and code', async () => {
    await signIn('alice');
    await showScreen(GuardianScreen);
    await press('Generate pairing code');
    await press('Share invite');

    expect(Share.share).toHaveBeenCalled();
    const { message } = Share.share.mock.calls[0][0];
    expect(message).toContain('alice');
    expect(message).toMatch(/\d{6}/);
  });

  it('offers no share button before a code exists', async () => {
    await signIn('alice');
    await showScreen(GuardianScreen);
    expect(screen.queryByText('Share invite')).toBeNull();
  });

  it('reports a failure to create a code', async () => {
    await signIn('alice');
    db().failOn('rpc', 'generate_pairing_code', { message: 'rate limited' });
    await showScreen(GuardianScreen);
    await press('Generate pairing code');
    expect(Alert.alert).toHaveBeenCalledWith('Could not create code', 'rate limited');
  });

  it('removes the guardian after confirmation', async () => {
    const alice = await signIn('alice');
    const bob = db().makeUser('bob');
    db().link(alice.id, bob.id);
    await showScreen(GuardianScreen);

    await press('Remove guardian');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Remove guardian', 'Stop sharing with your guardian?', expect.any(Array)
    );
    await act(async () => {
      await globalThis.pressAlertButton('Remove');
    });
    await flush();

    expect(db().rows('guardian_links')[0].status).toBe('deactivated');
    expect(screen.getByText(/No guardian linked yet/)).toBeTruthy();
  });

  it('keeps the guardian when the removal is cancelled', async () => {
    const alice = await signIn('alice');
    db().link(alice.id, db().makeUser('bob').id);
    await showScreen(GuardianScreen);

    await press('Remove guardian');
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

  it('offers the three actions for a linked person', async () => {
    const alice = db().makeUser('alice');
    const bob = await signIn('bob');
    db().link(alice.id, bob.id);

    const { navigation } = await showScreen(GuardianDashboardScreen, {
      role: ROLES.GUARDIAN,
    });

    await press('📋  View medicines');
    expect(navigation.navigate).toHaveBeenCalledWith('GuardianUser', {
      userId: alice.id, username: 'alice',
    });

    await press('📊  View health report');
    expect(navigation.navigate).toHaveBeenCalledWith('HealthReport', {
      userId: alice.id, username: 'alice',
    });

    await press('➕  Propose a medicine');
    expect(navigation.navigate).toHaveBeenCalledWith('AddMedicine', {
      requestUserId: alice.id, requestUsername: 'alice',
    });
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
    const { navigation } = await showScreen(GuardianUserScreen, {
      params: { userId: alice.id, username: 'alice' },
    });
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: '@alice' });
  });

  it('says when the person has no medicines', async () => {
    const { alice } = await linkedTo();
    await showScreen(GuardianUserScreen, { params: { userId: alice.id, username: 'alice' } });
    expect(screen.getByText('No medicines yet')).toBeTruthy();
  });

  it('lists the person`s medicines with times and settings', async () => {
    const { alice } = await linkedTo([
      { name: 'Aspirin', times: ['08:00', '20:00'], form: 'Tablet', snoozeMinutes: 15, toneId: 'bell' },
    ]);
    await showScreen(GuardianUserScreen, { params: { userId: alice.id, username: 'alice' } });

    expect(screen.getByText('Aspirin')).toBeTruthy();
    expect(screen.getByText('8:00 AM  •  8:00 PM')).toBeTruthy();
    expect(screen.getByText(/Snooze 15 min/)).toBeTruthy();
    expect(screen.getByText(/Tablet/)).toBeTruthy();
  });

  it('shows a medicine photo instead of the colour dot', async () => {
    const { alice } = await linkedTo([
      { name: 'Aspirin', times: ['08:00'], photo: 'GUARDIANVIEW' },
    ]);
    await showScreen(GuardianUserScreen, { params: { userId: alice.id, username: 'alice' } });

    const images = screen.UNSAFE_getAllByType(Image);
    expect(images.some((i) => i.props.source?.uri === 'data:image/jpeg;base64,GUARDIANVIEW')).toBe(true);
  });

  it('opens the request form and the health report', async () => {
    const { alice } = await linkedTo();
    const { navigation } = await showScreen(GuardianUserScreen, {
      params: { userId: alice.id, username: 'alice' },
    });

    await press('➕  Propose a medicine');
    expect(navigation.navigate).toHaveBeenCalledWith('AddMedicine', {
      requestUserId: alice.id, requestUsername: 'alice',
    });

    await press('📄  View health report');
    expect(navigation.navigate).toHaveBeenCalledWith('HealthReport', {
      userId: alice.id, username: 'alice',
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
