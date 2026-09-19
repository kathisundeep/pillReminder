import { screen, fireEvent, act } from '@testing-library/react-native';
import { showScreen, press, typeInto, flush } from '../../test/renderScreen';
import RegisterScreen from '../../src/screens/RegisterScreen';
import ProfileDetailsScreen from '../../src/screens/ProfileDetailsScreen';
import SettingsScreen from '../../src/screens/SettingsScreen';
import * as Ringtones from '../../modules/ringtones';
import { registerUser, loginUser } from '../../src/utils/storage';
import { getMyDetails, needsOnboarding } from '../../src/utils/profile';
import { ROLES } from '../../src/utils/role';

const db = () => globalThis.__db;

async function signedIn(username = 'alice', opts) {
  await registerUser(username, 'password123', opts);
  await loginUser(username, 'password123');
  return db().session.user;
}

// Stand in for the Edge Functions, which hold the service role in production.
function backendAccepts({ code = '123456' } = {}) {
  // Kept so tests can assert what was actually sent to the server, not just
  // what the screen did afterwards.
  const calls = {};
  const record = (fn) => (body) => {
    calls[fn] = body;
  };
  const invoked = (fn) => calls[fn];

  const sendOtp = record('send-otp');
  db().onFunction('send-otp', async (body) => {
    sendOtp(body);
    return { ok: true };
  });
  db().onFunction('verify-otp', async (body) =>
    String(body.code) === code
      ? { ok: true, claimToken: 'claim-1' }
      : { error: 'That code is not right. Request a new one.' }
  );
  const createAccount = record('create-account');
  db().onFunction('create-account', async (body) => {
    createAccount(body);
    const { username, password, isGuardian, phone } = body;
    const user = db().makeUser(username, { is_guardian: isGuardian, phone });
    user.password = password;
    return { ok: true };
  });

  return { invoked };
}

// ===========================================================================
describe('RegisterScreen', () => {
  const stepThrough = async () => {
    await press('Continue');                       // role
    await typeInto('e.g. sundeep', 'newbie');
    await press('Check and continue');             // username
    await typeInto('98765 43210', '9876543210');
    await press('Send code');                      // phone
    await typeInto('000000', '123456');
    await press('Verify');                         // code
  };

  it('asks one thing at a time, in order', async () => {
    await showScreen(RegisterScreen);
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
    expect(screen.getByText('Who is this account for?')).toBeTruthy();

    await press('Continue');
    expect(screen.getByText('Step 2 of 5')).toBeTruthy();
    expect(screen.getByText('Choose a username')).toBeTruthy();
  });

  it('warns that the username is permanent, because a guardian pairs on it', async () => {
    await showScreen(RegisterScreen);
    await press('Continue');
    expect(screen.getByText(/cannot be changed later/i)).toBeTruthy();
  });

  it('refuses a taken username before asking for anything else', async () => {
    await registerUser('taken', 'password123');
    await showScreen(RegisterScreen);
    await press('Continue');
    await typeInto('e.g. sundeep', 'taken');
    await press('Check and continue');

    expect(screen.getByText('That username is taken. Try another.')).toBeTruthy();
    expect(screen.getByText('Step 2 of 5')).toBeTruthy(); // did not advance
  });

  it('preselects a country so the code never has to be typed', async () => {
    backendAccepts();
    await showScreen(RegisterScreen);
    await press('Continue');
    await typeInto('e.g. sundeep', 'newbie');
    await press('Check and continue');

    // TZ is pinned to Asia/Kolkata in jest.config, so detection lands on India.
    expect(screen.getByText('+91')).toBeTruthy();
    expect(screen.getByText('🇮🇳')).toBeTruthy();
  });

  it('rejects a too-short number by its length, not by a missing country code', async () => {
    backendAccepts();
    await showScreen(RegisterScreen);
    await press('Continue');
    await typeInto('e.g. sundeep', 'newbie');
    await press('Check and continue');
    await typeInto('98765 43210', '98');
    await press('Send code');

    expect(screen.getByText(/looks too short/i)).toBeTruthy();
    expect(screen.getByText('Step 3 of 5')).toBeTruthy(); // did not advance
  });

  it('strips the trunk zero people type out of local habit', async () => {
    const { invoked } = backendAccepts();
    await showScreen(RegisterScreen);
    await press('Continue');
    await typeInto('e.g. sundeep', 'newbie');
    await press('Check and continue');
    await typeInto('98765 43210', '09876543210');
    await press('Send code');

    // +9109876543210 would be undeliverable, and silently so.
    expect(invoked('send-otp')).toMatchObject({ phone: '+919876543210' });
  });

  it('will not spend an SMS on a number that already has this role', async () => {
    const alice = await signedIn('alice');
    db().rows('profiles').find((p) => p.id === alice.id).phone = '+919876543210';
    let smsSent = false;
    db().onFunction('send-otp', async () => {
      smsSent = true;
      return { ok: true };
    });

    await showScreen(RegisterScreen);
    await press('Continue'); // patient
    await typeInto('e.g. sundeep', 'newbie');
    await press('Check and continue');
    await typeInto('98765 43210', '9876543210');
    await press('Send code');

    expect(screen.getByText(/already has a patient account/i)).toBeTruthy();
    expect(smsSent).toBe(false);
  });

  it('lets a guardian use a number that already has a patient account', async () => {
    const alice = await signedIn('alice');
    db().rows('profiles').find((p) => p.id === alice.id).phone = '+919876543210';
    backendAccepts();

    await showScreen(RegisterScreen);
    await press("I'm a guardian");
    await press('Continue');
    await typeInto('e.g. sundeep', 'carer');
    await press('Check and continue');
    await typeInto('98765 43210', '9876543210');
    await press('Send code');

    expect(screen.getByText('Enter the code')).toBeTruthy();
  });

  // With no SMS provider the server hands the code back so registration can be
  // exercised end to end. It has to be impossible to mistake for normal.
  describe('test mode', () => {
    async function reachCodeStep(sendResult) {
      db().onFunction('send-otp', async () => sendResult);
      await showScreen(RegisterScreen);
      await press('Continue');
      await typeInto('e.g. sundeep', 'newbie');
      await press('Check and continue');
      await typeInto('98765 43210', '9876543210');
      await press('Send code');
    }

    it('shows the code and says plainly that no SMS was sent', async () => {
      await reachCodeStep({ ok: true, testMode: true, testCode: '424242' });

      expect(screen.getByText('424242')).toBeTruthy();
      expect(screen.getByText(/TEST MODE — no SMS was sent/)).toBeTruthy();
      expect(screen.getByText(/must be turned off before real users/)).toBeTruthy();
    });

    it('shows nothing at all when a provider is configured', async () => {
      await reachCodeStep({ ok: true });

      expect(screen.queryByText(/TEST MODE/)).toBeNull();
      expect(screen.getByText(/We sent a 6-digit code/)).toBeTruthy();
    });

    // The code is displayed, never pre-filled: typing it is what proves the
    // step works, and a filled field would hide a broken verify call.
    it('does not fill the field in for you', async () => {
      await reachCodeStep({ ok: true, testMode: true, testCode: '424242' });
      expect(screen.getByPlaceholderText('000000').props.value).toBe('');
    });
  });

  it('rejects a wrong code and stays on the step', async () => {
    backendAccepts({ code: '999999' });
    await showScreen(RegisterScreen);
    await press('Continue');
    await typeInto('e.g. sundeep', 'newbie');
    await press('Check and continue');
    await typeInto('98765 43210', '9876543210');
    await press('Send code');
    await typeInto('000000', '111111');
    await press('Verify');

    expect(screen.getByText(/not right/i)).toBeTruthy();
    expect(screen.getByText('Step 4 of 5')).toBeTruthy();
  });

  it('requires the two passwords to match', async () => {
    backendAccepts();
    await showScreen(RegisterScreen);
    await stepThrough();

    await typeInto('Password', 'goodpass1');
    await typeInto('Type it again', 'goodpass2');
    await press('Create account');

    expect(screen.getByText(/must match/i)).toBeTruthy();
  });

  it('creates the account and enters the patient flow', async () => {
    backendAccepts();
    const { setRole } = await showScreen(RegisterScreen);
    await stepThrough();

    await typeInto('Password', 'goodpass1');
    await typeInto('Type it again', 'goodpass1');
    await press('Create account');

    expect(setRole).toHaveBeenCalledWith(ROLES.PATIENT);
    expect(db().rows('profiles')[0].username).toBe('newbie');
  });

  it('creates a guardian account in the guardian flow', async () => {
    backendAccepts();
    const { setRole } = await showScreen(RegisterScreen);
    await press("I'm a guardian");
    await stepThrough();

    await typeInto('Password', 'goodpass1');
    await typeInto('Type it again', 'goodpass1');
    await press('Create account');

    expect(setRole).toHaveBeenCalledWith(ROLES.GUARDIAN);
    expect(db().rows('profiles')[0].is_guardian).toBe(true);
  });

  it('offers a way back to logging in', async () => {
    const { navigation } = await showScreen(RegisterScreen);
    await press('Already have an account? Log in');
    expect(navigation.goBack).toHaveBeenCalled();
  });
});

// ===========================================================================
describe('ProfileDetailsScreen', () => {
  it('says every field is optional', async () => {
    await signedIn();
    await showScreen(ProfileDetailsScreen);
    expect(screen.getByText(/Every field is optional/)).toBeTruthy();
    expect(screen.getByText(/reminders already work/)).toBeTruthy();
  });

  it('explains why it asks for a date of birth rather than an age', async () => {
    await signedIn();
    await showScreen(ProfileDetailsScreen);
    expect(screen.getByText(/stays right as years pass/)).toBeTruthy();
  });

  it('records weight here rather than in Trackers', async () => {
    await signedIn();
    await showScreen(ProfileDetailsScreen);
    expect(screen.getByText(/Recorded here rather than in Trackers/)).toBeTruthy();
  });

  it('takes the date of birth day-first', async () => {
    await signedIn();
    await showScreen(ProfileDetailsScreen);
    const field = screen.getByPlaceholderText('28/01/2000');
    fireEvent.changeText(field, '28012000');
    expect(field.props.value).toBe('28/01/2000');
  });

  it('offers both height and weight units', async () => {
    await signedIn();
    await showScreen(ProfileDetailsScreen);
    expect(screen.getByText('cm')).toBeTruthy();
    expect(screen.getByText('inches')).toBeTruthy();
    expect(screen.getByText('kg')).toBeTruthy();
    expect(screen.getByText('lbs')).toBeTruthy();
  });

  it('saves the details and stops asking', async () => {
    await signedIn();
    const { navigation } = await showScreen(ProfileDetailsScreen);

    await typeInto('e.g. Sundeep Kathi', 'Alice R');
    await press('Female');
    await typeInto('28/01/2000', '01051990'); // 1 May 1990, day-first
    await typeInto('e.g. 172', '165');
    await typeInto('e.g. India', 'India');
    await press('Save and continue');

    const details = await getMyDetails();
    expect(details).toMatchObject({
      full_name: 'Alice R', gender: 'female', height_cm: 165, country: 'India',
    });
    expect(await needsOnboarding()).toBe(false);
    expect(navigation.navigate).toHaveBeenCalledWith('Home');
  });

  it('seeds the weight as a tracker reading', async () => {
    await signedIn();
    await showScreen(ProfileDetailsScreen);
    await typeInto('e.g. 71', '71');
    await press('Save and continue');

    expect(db().rows('health_readings')).toHaveLength(1);
    expect(db().rows('health_readings')[0].type).toBe('weight');
  });

  it('lets the user skip without recording anything', async () => {
    await signedIn();
    const { navigation } = await showScreen(ProfileDetailsScreen);

    await press('Skip for now');

    expect((await getMyDetails()).full_name).toBeNull();
    expect(await needsOnboarding()).toBe(false); // never asked twice
    expect(navigation.navigate).toHaveBeenCalledWith('Home');
  });

  it('reports a bad height instead of saving it', async () => {
    await signedIn();
    await showScreen(ProfileDetailsScreen);
    await typeInto('e.g. 172', '5'); // feet, not centimetres
    await press('Save and continue');

    expect(screen.getByText(/centimetres/i)).toBeTruthy();
    expect(await needsOnboarding()).toBe(true);
  });

  it('has no skip button when reached from Settings', async () => {
    await signedIn();
    await showScreen(ProfileDetailsScreen, { params: { editing: true } });
    expect(screen.queryByText('Skip for now')).toBeNull();
    expect(screen.getByText('Save changes')).toBeTruthy();
  });

  it('prefills the existing details when editing', async () => {
    const user = await signedIn();
    Object.assign(db().rows('profiles').find((p) => p.id === user.id), {
      full_name: 'Alice R', height_cm: 165, country: 'India',
    });

    await showScreen(ProfileDetailsScreen, { params: { editing: true } });
    expect(screen.getByDisplayValue('Alice R')).toBeTruthy();
    expect(screen.getByDisplayValue('165')).toBeTruthy();
    expect(screen.getByDisplayValue('India')).toBeTruthy();
  });
});

// ===========================================================================
describe('SettingsScreen — medicine alarm', () => {
  it('shows the phone`s alarm tone and opens the phone setting to change it', async () => {
    Ringtones.__state.alarms.available = true;
    await signedIn('alice');
    await showScreen(SettingsScreen);

    expect(screen.getByText('Medicine alarm')).toBeTruthy();
    expect(screen.getByText('Oxygen')).toBeTruthy();
    await press(screen.getByLabelText('Change alarm tone'));
    expect(Ringtones.openAlarmSoundSettings).toHaveBeenCalled();
  });

  it('switches between a full-screen alarm and a notification only', async () => {
    Ringtones.__state.alarms.available = true;
    await signedIn('alice');
    await showScreen(SettingsScreen);
    expect(screen.getByText(/Shows over the lock screen/)).toBeTruthy();

    await act(async () => {
      fireEvent(screen.getByLabelText('Full-screen alarm'), 'valueChange', false);
    });
    await flush();

    expect(Ringtones.setFullScreenAlarms).toHaveBeenCalledWith(false);
    expect(screen.getByText('A ringing notification only.')).toBeTruthy();
  });

  it('asks for full-screen permission when the phone has not allowed it', async () => {
    Ringtones.__state.alarms.available = true;
    Ringtones.canUseFullScreenAlarms.mockReturnValue(false);
    await signedIn('alice');
    await showScreen(SettingsScreen);

    await press('Allow full-screen alarms');
    expect(Ringtones.openFullScreenSettings).toHaveBeenCalled();
    Ringtones.canUseFullScreenAlarms.mockReturnValue(true);
  });

  it('explains when this build cannot use the phone`s tones', async () => {
    await signedIn('alice');
    await showScreen(SettingsScreen);
    expect(screen.queryByLabelText('Change alarm tone')).toBeNull();
    expect(screen.getByText(/alarm sound|latest version/)).toBeTruthy();
  });

  it('shows no alarm settings to a guardian', async () => {
    await signedIn('bob', { isGuardian: true });
    await showScreen(SettingsScreen, { role: ROLES.GUARDIAN });
    expect(screen.queryByText('Medicine alarm')).toBeNull();
  });
});

describe('SettingsScreen', () => {
  it('shows who you are and that it cannot be changed', async () => {
    await signedIn('alice');
    await showScreen(SettingsScreen);

    expect(screen.getByText('@alice')).toBeTruthy();
    expect(screen.getByText('Patient')).toBeTruthy();
    expect(screen.getByText(/username and account type cannot be changed/i)).toBeTruthy();
  });

  it('brands a guardian account in teal and hides the patient-only sections', async () => {
    await signedIn('bob', { isGuardian: true });
    await showScreen(SettingsScreen, { role: ROLES.GUARDIAN });

    expect(screen.getByText('Guardian')).toBeTruthy();
    expect(screen.queryByText('Care & plan')).toBeNull();
    expect(screen.queryByText(/Weight is recorded in Trackers/)).toBeNull();
  });

  it('opens the details editor', async () => {
    await signedIn();
    const { navigation } = await showScreen(SettingsScreen);
    await press('Edit name, gender, date of birth, height, country');
    expect(navigation.navigate).toHaveBeenCalledWith('ProfileDetails', {
      editing: true,
    });
  });

  it('points weight at Trackers rather than duplicating it here', async () => {
    await signedIn();
    await showScreen(SettingsScreen);
    expect(screen.getByText(/Weight is recorded in Trackers/)).toBeTruthy();
  });

  it('summarises the details that have been recorded', async () => {
    const user = await signedIn();
    Object.assign(db().rows('profiles').find((p) => p.id === user.id), {
      date_of_birth: '1990-05-01', height_cm: 165, country: 'India',
    });

    await showScreen(SettingsScreen);
    expect(screen.getByText(/165 cm/)).toBeTruthy();
    expect(screen.getByText(/India/)).toBeTruthy();
  });

  it('shows the verified number and explains why changing it needs a code', async () => {
    const user = await signedIn();
    db().rows('profiles').find((p) => p.id === user.id).phone = '+919876543210';

    await showScreen(SettingsScreen);
    expect(screen.getByText(/Verified number \+919876543210/)).toBeTruthy();
    expect(screen.getByText(/needs a fresh code/i)).toBeTruthy();
  });

  it('reaches Guardian and Plans from one place', async () => {
    await signedIn();
    const { navigation } = await showScreen(SettingsScreen);

    await press('♥  Guardian');
    expect(navigation.navigate).toHaveBeenCalledWith('Guardian');

    await press('⭐  Plans & subscription');
    expect(navigation.navigate).toHaveBeenCalledWith('Plans');
  });

  it('logs out by dropping the role', async () => {
    await signedIn();
    const { setRole } = await showScreen(SettingsScreen);
    await press('Log out');
    expect(setRole).toHaveBeenCalledWith(null);
  });
});
