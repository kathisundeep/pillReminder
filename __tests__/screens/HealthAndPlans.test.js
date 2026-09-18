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
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  });

  // Checkout pauses briefly to look like processing; run the clock past it.
  async function payFor(label) {
    await press(label);
    await press(/^Pay ₹/);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await flush();
  }

  it('says there is no plan, and that guardians need one', async () => {
    await signedIn();
    await showScreen(PlansScreen);
    expect(screen.getByText('No plan')).toBeTruthy();
    expect(screen.getByText(/Guardians need a plan/)).toBeTruthy();
  });

  it('shows 1, 2 and 3 guardians for a month at ₹150 / ₹250 / ₹300', async () => {
    await signedIn();
    await showScreen(PlansScreen);
    expect(screen.getByText('1 guardian')).toBeTruthy();
    expect(screen.getByText('2 guardians')).toBeTruthy();
    expect(screen.getByText('3 guardians')).toBeTruthy();
    for (const price of ['₹150', '₹250', '₹300']) expect(screen.getByText(price)).toBeTruthy();
  });

  it('switches to longer plans with their saving', async () => {
    await signedIn();
    await showScreen(PlansScreen);
    await press('3 months');
    expect(screen.getByText('₹425')).toBeTruthy();
    expect(screen.getByText('3 months · ₹142/month')).toBeTruthy();
    expect(screen.getAllByText(/^Save \d+%$/)).toHaveLength(3);
  });

  it('says plainly that checkout is a test', async () => {
    await signedIn();
    await showScreen(PlansScreen);
    expect(screen.getByText(/Test mode — checkout is simulated and no money is charged/)).toBeTruthy();
  });

  it('checks out and activates the plan', async () => {
    const user = await signedIn();
    await showScreen(PlansScreen);

    await press(screen.getAllByText('Choose')[1]); // 2 guardians · 1 month
    expect(screen.getByText('Checkout')).toBeTruthy();
    expect(screen.getByText('UPI')).toBeTruthy();
    await press('Debit / credit card');
    await press('Pay ₹250');
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await flush();

    expect(screen.getByText('Payment successful')).toBeTruthy();
    const active = db().rows('subscriptions').filter((x) => x.user_id === user.id && x.status === 'active');
    expect(active.map((x) => x.plan_id)).toEqual(['g2_m1']);
  });

  it('shows the plan it is on, with its end date, after paying', async () => {
    await signedIn();
    await showScreen(PlansScreen);
    await payFor(screen.getAllByText('Choose')[0]);
    await press('Done');

    expect(screen.getByText('1 guardian · 1 month')).toBeTruthy();
    expect(screen.getByText(/Up to 1 guardian · active until/)).toBeTruthy();
    expect(screen.getByText('Current plan')).toBeTruthy();
  });

  it('reports a failed checkout and activates nothing', async () => {
    const user = await signedIn();
    db().mockPayments = false;
    await showScreen(PlansScreen);
    await payFor(screen.getAllByText('Choose')[0]);

    expect(Alert.alert).toHaveBeenCalledWith('Payment failed', 'Test payments are switched off.');
    expect(db().rows('subscriptions').filter((x) => x.user_id === user.id)).toHaveLength(0);
  });
});
