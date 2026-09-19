import { screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { showScreen, press, typeInto } from '../../test/renderScreen';
import ForgotPasswordScreen from '../../src/screens/ForgotPasswordScreen';
import ChangePasswordScreen from '../../src/screens/ChangePasswordScreen';
import ChangePhoneScreen from '../../src/screens/ChangePhoneScreen';
import LoginScreen from '../../src/screens/LoginScreen';
import SettingsScreen from '../../src/screens/SettingsScreen';
import { registerUser, loginUser } from '../../src/utils/storage';
import { ROLES } from '../../src/utils/role';

const db = () => globalThis.__db;

// Record every call to a stand-in server function.
function serve(name, reply) {
  const calls = [];
  db().onFunction(name, async (body) => {
    calls.push(body);
    return typeof reply === 'function' ? reply(body) : reply;
  });
  return calls;
}

describe('Forgot password', () => {
  it('resets the password by phone and names the account', async () => {
    const sent = serve('send-otp', { ok: true, testMode: true, testCode: '424242' });
    const verified = serve('verify-otp', { ok: true, claimToken: 'claim-1' });
    const reset = serve('reset-password', { ok: true, username: 'alice' });
    const { navigation } = await showScreen(ForgotPasswordScreen, { params: { asGuardian: false } });

    await typeInto('98765 43210', '9876543210');
    await press('Send code');
    expect(sent[0]).toMatchObject({ isGuardian: false, purpose: 'reset' });
    expect(screen.getByText('424242')).toBeTruthy();

    await typeInto('000000', '424242');
    await press('Verify');
    expect(verified[0]).toMatchObject({ code: '424242', purpose: 'reset' });

    await typeInto('New password', 'newpass12');
    await typeInto('Type it again', 'newpass12');
    await press('Set new password');
    expect(reset[0]).toMatchObject({ claimToken: 'claim-1', password: 'newpass12', isGuardian: false });

    expect(screen.getByText('Password changed')).toBeTruthy();
    expect(screen.getByText('@alice')).toBeTruthy();
    await press('Log in');
    expect(navigation.navigate).toHaveBeenCalledWith('Login', { username: 'alice', asGuardian: false });
  });

  it('looks up a guardian account when "I\'m a guardian" is chosen', async () => {
    const sent = serve('send-otp', { ok: true });
    await showScreen(ForgotPasswordScreen);
    await press("I'm a guardian");
    await typeInto('98765 43210', '9876543210');
    await press('Send code');
    expect(sent[0]).toMatchObject({ isGuardian: true, purpose: 'reset' });
  });

  it('shows a wrong code and stays on the code step', async () => {
    serve('send-otp', { ok: true });
    serve('verify-otp', { error: 'That code is not right. Request a new one.' });
    await showScreen(ForgotPasswordScreen);
    await typeInto('98765 43210', '9876543210');
    await press('Send code');
    await typeInto('000000', '111111');
    await press('Verify');

    expect(screen.getByText('That code is not right. Request a new one.')).toBeTruthy();
    expect(screen.getByText('Enter the code')).toBeTruthy();
  });

  it('is reached from the login screen, keeping the account type', async () => {
    const { navigation } = await showScreen(LoginScreen);
    await press("I'm a guardian");
    await press('Forgot password?');
    expect(navigation.navigate).toHaveBeenCalledWith('ForgotPassword', { asGuardian: true });
  });

  it('comes back to the login screen with the username filled in', async () => {
    await showScreen(LoginScreen, { params: { username: 'alice', asGuardian: false } });
    expect(screen.getByDisplayValue('alice')).toBeTruthy();
  });
});

describe('Change password', () => {
  beforeEach(async () => {
    await registerUser('alice', 'password123');
    await loginUser('alice', 'password123');
  });

  it('changes it with the current password', async () => {
    const calls = serve('change-password', { ok: true });
    const { navigation } = await showScreen(ChangePasswordScreen);

    await typeInto('Current password', 'password123');
    await typeInto('New password', 'newpass456');
    await typeInto('Type it again', 'newpass456');
    await press('Save new password');

    expect(calls[0]).toEqual({ currentPassword: 'password123', newPassword: 'newpass456' });
    expect(Alert.alert).toHaveBeenCalledWith('Password changed', expect.any(String));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('says so when the current password is wrong', async () => {
    serve('change-password', { error: 'Your current password is not right.' });
    const { navigation } = await showScreen(ChangePasswordScreen);

    await typeInto('Current password', 'nope1234');
    await typeInto('New password', 'newpass456');
    await typeInto('Type it again', 'newpass456');
    await press('Save new password');

    expect(screen.getByText('Your current password is not right.')).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('is opened from Settings', async () => {
    const { navigation } = await showScreen(SettingsScreen);
    await press('Change password');
    expect(navigation.navigate).toHaveBeenCalledWith('ChangePassword');
  });
});

describe('Change phone number', () => {
  beforeEach(async () => {
    await registerUser('alice', 'password123');
    await loginUser('alice', 'password123');
  });

  async function toCodeStep(role) {
    const sent = serve('send-otp', { ok: true, testMode: true, testCode: '555111' });
    const utils = await showScreen(ChangePhoneScreen, role ? { role } : undefined);
    await typeInto('98765 43210', '9123456780');
    await press('Send code');
    return { sent, ...utils };
  }

  it('sends the code to the new number, for this account type', async () => {
    const { sent } = await toCodeStep(ROLES.GUARDIAN);
    expect(sent[0]).toMatchObject({ isGuardian: true, purpose: 'change_phone' });
    expect(screen.getByText('555111')).toBeTruthy();
  });

  it('changes the number with the code and the current password', async () => {
    const { navigation } = await toCodeStep();
    const verified = serve('verify-otp', { ok: true, claimToken: 'claim-9' });
    const changed = serve('change-phone', (b) => ({ ok: true, phone: b.phone }));

    await typeInto('000000', '555111');
    await typeInto('Current password', 'password123');
    await press('Change number');

    expect(verified[0]).toMatchObject({ code: '555111', purpose: 'change_phone' });
    expect(changed[0]).toMatchObject({ claimToken: 'claim-9', password: 'password123' });
    expect(Alert.alert).toHaveBeenCalledWith('Number changed', expect.stringContaining('+91'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('lets a mistyped password be retried without a new code', async () => {
    await toCodeStep();
    const verified = serve('verify-otp', { ok: true, claimToken: 'claim-9' });
    let attempt = 0;
    serve('change-phone', () => {
      attempt += 1;
      return attempt === 1 ? { error: 'Your current password is not right.' } : { ok: true, phone: '+919123456780' };
    });

    await typeInto('000000', '555111');
    await typeInto('Current password', 'wrong999');
    await press('Change number');
    expect(screen.getByText('Your current password is not right.')).toBeTruthy();
    expect(screen.queryByPlaceholderText('000000')).toBeNull();

    await typeInto('Current password', 'password123');
    await press('Change number');
    expect(verified).toHaveLength(1);
    expect(attempt).toBe(2);
  });

  it('is opened from Settings', async () => {
    const { navigation } = await showScreen(SettingsScreen);
    await press('Change phone number');
    expect(navigation.navigate).toHaveBeenCalledWith('ChangePhone');
  });
});
