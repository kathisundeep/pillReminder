import { screen, act } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';
import { showScreen, press, typeInto, flush } from '../../test/renderScreen';
import TrackersScreen from '../../src/screens/TrackersScreen';
import HealthReportScreen from '../../src/screens/HealthReportScreen';
import PlansScreen from '../../src/screens/PlansScreen';
import { registerUser, loginUser } from '../../src/utils/storage';
import { addReading } from '../../src/utils/health';

const db = () => globalThis.__db;
const readings = () => db().rows('health_readings');

async function signedIn(username = 'alice') {
  await registerUser(username, 'password123');
  await loginUser(username, 'password123');
  return db().session.user;
}

beforeEach(() => {
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
});

// ===========================================================================
describe('TrackersScreen', () => {
  it('offers all four measurements and defaults to blood pressure', async () => {
    await signedIn();
    await showScreen(TrackersScreen);

    for (const label of ['Blood pressure', 'Blood sugar', 'Cholesterol', 'Hemoglobin']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('Systolic')).toBeTruthy();
    expect(screen.getByText('Diastolic')).toBeTruthy();
    expect(screen.getByText('Unit: mmHg')).toBeTruthy();
  });

  it('swaps the fields and unit when the type changes', async () => {
    await signedIn();
    await showScreen(TrackersScreen);

    await press('Cholesterol');
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getByText('HDL')).toBeTruthy();
    expect(screen.getByText('LDL')).toBeTruthy();
    expect(screen.getByText('Unit: mg/dL')).toBeTruthy();

    await press('Hemoglobin');
    expect(screen.getByText('Unit: g/dL')).toBeTruthy();
    expect(screen.queryByText('HDL')).toBeNull();
  });

  it('saves a blood-pressure reading', async () => {
    await signedIn();
    await showScreen(TrackersScreen);

    const inputs = screen.UNSAFE_getAllByType(require('react-native').TextInput);
    await act(async () => {
      inputs[0].props.onChangeText('120');
      inputs[1].props.onChangeText('80');
    });
    await press('Save reading');

    expect(readings()).toHaveLength(1);
    expect(readings()[0]).toMatchObject({
      type: 'bp',
      reading_values: { systolic: 120, diastolic: 80 },
      unit: 'mmHg',
    });
  });

  it('stores an optional note', async () => {
    await signedIn();
    await showScreen(TrackersScreen);
    await press('Hemoglobin');

    const inputs = screen.UNSAFE_getAllByType(require('react-native').TextInput);
    await act(async () => {
      inputs[0].props.onChangeText('71');
    });
    await typeInto('Note (optional) — e.g. fasting, after food', 'morning weigh-in');
    await press('Save reading');

    expect(readings()[0].note).toBe('morning weigh-in');
  });

  it('refuses a missing or non-numeric field', async () => {
    await signedIn();
    await showScreen(TrackersScreen);

    await press('Save reading');
    expect(Alert.alert).toHaveBeenCalledWith('Missing', 'Enter Systolic.');
    expect(readings()).toHaveLength(0);

    const inputs = screen.UNSAFE_getAllByType(require('react-native').TextInput);
    await act(async () => {
      inputs[0].props.onChangeText('abc');
      inputs[1].props.onChangeText('80');
    });
    await press('Save reading');
    expect(Alert.alert).toHaveBeenCalledWith('Missing', 'Enter Systolic.');
    expect(readings()).toHaveLength(0);
  });

  it('clears the form after a successful save', async () => {
    await signedIn();
    await showScreen(TrackersScreen);
    await press('Hemoglobin');

    let inputs = screen.UNSAFE_getAllByType(require('react-native').TextInput);
    await act(async () => {
      inputs[0].props.onChangeText('71');
    });
    await press('Save reading');

    inputs = screen.UNSAFE_getAllByType(require('react-native').TextInput);
    expect(inputs[0].props.value).toBe('');
  });

  it('lists recent readings with their formatted value', async () => {
    await signedIn();
    await addReading('bp', { systolic: 118, diastolic: 76 });
    await showScreen(TrackersScreen);

    expect(screen.getByText(/Blood pressure: 118\/76/)).toBeTruthy();
  });

  it('says when there is nothing recorded', async () => {
    await signedIn();
    await showScreen(TrackersScreen);
    expect(screen.getByText('No readings yet')).toBeTruthy();
  });

  it('deletes a reading on long press + confirm', async () => {
    await signedIn();
    await addReading('sugar', { value: 96 });
    await showScreen(TrackersScreen);

    await act(async () => {
      require('@testing-library/react-native').fireEvent(
        screen.getByText(/Blood sugar: 96/), 'longPress'
      );
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete reading', 'Remove this entry?', expect.any(Array)
    );

    await act(async () => {
      await globalThis.pressAlertButton('Delete');
    });
    await flush();
    expect(readings()).toHaveLength(0);
  });

  it('reports a save failure', async () => {
    await signedIn();
    db().failOn('health_readings', 'insert', { message: 'storage full' });
    await showScreen(TrackersScreen);

    const inputs = screen.UNSAFE_getAllByType(require('react-native').TextInput);
    await act(async () => {
      inputs[0].props.onChangeText('120');
      inputs[1].props.onChangeText('80');
    });
    await press('Save reading');
    expect(Alert.alert).toHaveBeenCalledWith('Could not save', 'storage full');
  });
});

// ===========================================================================
describe('HealthReportScreen', () => {
  it('says when nothing has been recorded', async () => {
    await signedIn();
    await showScreen(HealthReportScreen);
    expect(screen.getByText('No health readings yet')).toBeTruthy();
    expect(screen.queryByText('Share report')).toBeNull();
  });

  it('summarises each type with latest, average, min and max', async () => {
    await signedIn();
    await addReading('sugar', { value: 90 });
    await addReading('sugar', { value: 100 });
    await addReading('sugar', { value: 110 });

    const rows = db().rows('health_readings');
    rows[0].measured_at = '2025-06-01T00:00:00.000Z';
    rows[1].measured_at = '2025-06-02T00:00:00.000Z';
    rows[2].measured_at = '2025-06-03T00:00:00.000Z';

    await showScreen(HealthReportScreen);

    expect(screen.getByText('Blood sugar')).toBeTruthy();
    expect(screen.getByText('Latest: 110 mg/dL')).toBeTruthy();
    expect(screen.getByText('Reading: avg 100 · min 90 · max 110 (3)')).toBeTruthy();
  });

  it('reports each field of a multi-field measurement', async () => {
    await signedIn();
    await addReading('bp', { systolic: 120, diastolic: 80 });
    await addReading('bp', { systolic: 130, diastolic: 90 });
    await showScreen(HealthReportScreen);

    expect(screen.getByText(/Systolic: avg 125 · min 120 · max 130 \(2\)/)).toBeTruthy();
    expect(screen.getByText(/Diastolic: avg 85 · min 80 · max 90 \(2\)/)).toBeTruthy();
  });

  it('titles a guardian`s view with the patient handle and reads their data', async () => {
    const alice = db().makeUser('alice');
    db().as(alice);
    await addReading('weight', { value: 70 });

    const bob = await signedIn('bob');
    db().link(alice.id, bob.id);

    const { navigation } = await showScreen(HealthReportScreen, {
      params: { userId: alice.id, username: 'alice' },
    });
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: "@alice's report" });
    expect(screen.getByText('Weight')).toBeTruthy();
    expect(screen.getByText('Latest: 70 kg')).toBeTruthy();
  });

  it('shares a text summary', async () => {
    await signedIn();
    await addReading('sugar', { value: 96 });
    await showScreen(HealthReportScreen);
    await press('Share report');

    expect(Share.share).toHaveBeenCalled();
    const { message } = Share.share.mock.calls[0][0];
    expect(message).toContain('My health report');
    expect(message).toContain('Blood sugar (mg/dL): latest 96, 1 reading(s)');
  });

  it('names the patient in a shared guardian report', async () => {
    const alice = db().makeUser('alice');
    db().as(alice);
    await addReading('sugar', { value: 96 });
    const bob = await signedIn('bob');
    db().link(alice.id, bob.id);

    await showScreen(HealthReportScreen, { params: { userId: alice.id, username: 'alice' } });
    await press('Share report');
    expect(Share.share.mock.calls[0][0].message).toContain('Health report for @alice');
  });

  it('omits types with no readings', async () => {
    await signedIn();
    await addReading('weight', { value: 70 });
    await showScreen(HealthReportScreen);

    // Weight is entered on the profile now, but its history still reports.
    expect(screen.getByText('Weight')).toBeTruthy();
    expect(screen.queryByText('Cholesterol')).toBeNull();
  });
});

// ===========================================================================
describe('PlansScreen', () => {
  it('shows the catalog with prices and the current plan', async () => {
    await signedIn();
    await showScreen(PlansScreen);

    // "Free" appears as the card name and as its price.
    expect(screen.getAllByText('Free').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/up to 1 guardian/)).toBeTruthy();
    expect(screen.getByText('Plus')).toBeTruthy();
    expect(screen.getByText('Family')).toBeTruthy();
    expect(screen.getByText('₹99/month')).toBeTruthy();
    expect(screen.getByText('₹199/month')).toBeTruthy();
    // A signed-in user with no subscription is on Free, so its button is
    // disabled and the two paid plans offer Subscribe.
    // Once as the section label, once as the Free card's disabled button.
    expect(screen.getAllByText('Current plan')).toHaveLength(2);
    expect(screen.getAllByText('Subscribe')).toHaveLength(2);
  });

  it('describes the guardian allowance per plan', async () => {
    await signedIn();
    await showScreen(PlansScreen);
    expect(screen.getByText('• Up to 1 guardian')).toBeTruthy();
    expect(screen.getByText('• Up to 3 guardians')).toBeTruthy();
    expect(screen.getByText('• Up to 5 guardians')).toBeTruthy();
  });

  it('warns that payments are not live', async () => {
    await signedIn();
    await showScreen(PlansScreen);
    expect(screen.getByText(/Online payment .* coming soon/)).toBeTruthy();
    expect(screen.getByText(/cannot be activated until then/)).toBeTruthy();
  });

  // Was SEC-01: checkout is a stub that always reports failure, and the code
  // activated the plan anyway — so anyone could take the top tier for free.
  it('refuses to activate a paid plan while payment is unavailable', async () => {
    const user = await signedIn();
    await showScreen(PlansScreen);
    await press(screen.getAllByText('Subscribe')[0]);

    expect(Alert.alert).toHaveBeenCalledWith(
      'Payment not available yet',
      expect.stringMatching(/not enabled/i)
    );
    expect(db().rows('subscriptions').filter((s2) => s2.user_id === user.id)).toHaveLength(0);
  });

  it('leaves the user on Free after a refused subscribe', async () => {
    await signedIn();
    await showScreen(PlansScreen);
    await press(screen.getAllByText('Subscribe')[0]);

    expect(screen.getAllByText('Free').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Subscribe')).toHaveLength(2);
  });

  it('sends a downgrade to Free through the server', async () => {
    const user = await signedIn();
    db().seed('subscriptions', [
      { user_id: user.id, plan_id: 'plus', status: 'active' },
    ]);
    let called = null;
    db().onFunction('change-plan', async (body) => {
      called = body;
      db().rows('subscriptions')[0].status = 'canceled';
      return { activated: 'free' };
    });

    await showScreen(PlansScreen);
    await press('Switch to Free');

    expect(called).toEqual({ planId: 'free' });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Plan updated', expect.stringContaining('Free')
    );
  });

  it('reports a billing service failure instead of pretending', async () => {
    await signedIn();
    db().seed('subscriptions', [
      { user_id: db().session.user.id, plan_id: 'plus', status: 'active' },
    ]);
    await showScreen(PlansScreen);
    await press('Switch to Free');

    expect(Alert.alert).toHaveBeenCalledWith(
      'Could not change plan', expect.stringMatching(/Function not found/)
    );
  });
});
