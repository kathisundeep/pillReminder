import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { renderScreen } from '../../test/renderScreen';
import { ROLES } from '../../src/utils/role';
import LoginScreen from '../../src/screens/LoginScreen';
import {
  registerUser,
  loginUser,
  logoutUser,
  addMedicine,
  getSession,
} from '../../src/utils/storage';

const db = () => globalThis.__db;

const fillForm = (username, password) => {
  fireEvent.changeText(screen.getByPlaceholderText('Username'), username);
  fireEvent.changeText(screen.getByPlaceholderText('Password'), password);
};

const submit = () => fireEvent.press(screen.getByText('Log in'));

describe('LoginScreen — form', () => {
  it('starts in login mode for a medicine-taker', () => {
    renderScreen(LoginScreen);
    expect(screen.getByText('Welcome back')).toBeTruthy();
    expect(screen.getByText('Log in')).toBeTruthy();
  });

  it('sends registration to its own multi-step screen', () => {
    const { navigation } = renderScreen(LoginScreen);
    fireEvent.press(screen.getByText("Don't have an account? Register"));
    expect(navigation.navigate).toHaveBeenCalledWith('Register');
  });

  it('changes the wording when the guardian role is selected', () => {
    renderScreen(LoginScreen);
    fireEvent.press(screen.getByText("I'm a guardian"));
    expect(screen.getByText('Guardian log in')).toBeTruthy();
  });

  it('masks the password field', () => {
    renderScreen(LoginScreen);
    expect(screen.getByPlaceholderText('Password').props.secureTextEntry).toBe(true);
  });

  it('does not auto-capitalise the username', () => {
    renderScreen(LoginScreen);
    expect(screen.getByPlaceholderText('Username').props.autoCapitalize).toBe('none');
  });
});

describe('LoginScreen — validation', () => {
  it('refuses an empty username or password', async () => {
    renderScreen(LoginScreen);

    submit();
    expect(Alert.alert).toHaveBeenCalledWith('Missing info', 'Enter a username and password.');

    fillForm('alice', '   ');
    submit();
    expect(Alert.alert).toHaveBeenCalledTimes(2);
    expect(db().authUsers).toHaveLength(0);
  });

  it('shows the backend error when login fails', async () => {
    renderScreen(LoginScreen);
    fillForm('ghost', 'password123');
    submit();

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Failed', 'Invalid credentials'));
    expect(screen.getByText('Log in')).toBeTruthy(); // stayed put
  });


});

describe('LoginScreen — successful login', () => {
  beforeEach(async () => {
    await registerUser('alice', 'password123');
  });

  it('signs in and enters the patient flow', async () => {
    const { setRole } = renderScreen(LoginScreen);
    fillForm('alice', 'password123');
    submit();

    await waitFor(() => expect(setRole).toHaveBeenCalledWith(ROLES.PATIENT));
    expect(await getSession()).toBe('alice');
  });

  it('trims a padded username', async () => {
    const { setRole } = renderScreen(LoginScreen);
    fillForm('  alice  ', 'password123');
    submit();
    await waitFor(() => expect(setRole).toHaveBeenCalledWith(ROLES.PATIENT));
  });

  it('re-arms local alarms from the cloud on login', async () => {
    await loginUser('alice', 'password123');
    await addMedicine(null, { name: 'Aspirin', times: ['08:00', '20:00'] });
    await logoutUser();

    const { setRole } = renderScreen(LoginScreen);
    fillForm('alice', 'password123');
    submit();

    await waitFor(() => expect(setRole).toHaveBeenCalledWith(ROLES.PATIENT));
    expect(Notifications.__state.scheduled).toHaveLength(2);
  });

  it('imports legacy on-device medicines once and says so', async () => {
    await AsyncStorage.setItem(
      '@pr_meds_alice',
      JSON.stringify([{ name: 'Legacy', times: ['08:00'] }])
    );

    renderScreen(LoginScreen);
    fillForm('alice', 'password123');
    submit();

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Medicines imported',
        '1 medicine(s) from this device were added to your account.'
      )
    );
  });

  it('says nothing about importing when there is nothing to import', async () => {
    const { setRole } = renderScreen(LoginScreen);
    fillForm('alice', 'password123');
    submit();

    await waitFor(() => expect(setRole).toHaveBeenCalledWith(ROLES.PATIENT));
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('LoginScreen — guardian role', () => {
  const asGuardian = () => fireEvent.press(screen.getByText("I'm a guardian"));

  it('enters the guardian flow on a later login', async () => {
    await registerUser('bob', 'password123', { isGuardian: true });
    const { setRole } = renderScreen(LoginScreen);
    asGuardian();
    fillForm('bob', 'password123');
    submit();

    await waitFor(() => expect(setRole).toHaveBeenCalledWith(ROLES.GUARDIAN));
  });

  it('does not schedule any alarms for a guardian', async () => {
    await registerUser('bob', 'password123', { isGuardian: true });
    const { setRole } = renderScreen(LoginScreen);
    asGuardian();
    fillForm('bob', 'password123');
    submit();

    await waitFor(() => expect(setRole).toHaveBeenCalledWith(ROLES.GUARDIAN));
    expect(Notifications.__state.scheduled).toHaveLength(0);
  });

  it('refuses a patient account signing in as a guardian', async () => {
    await registerUser('alice', 'password123');
    const { setRole } = renderScreen(LoginScreen);
    asGuardian();
    fillForm('alice', 'password123');
    submit();

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Not a guardian account',
        expect.stringContaining('takes medicines')
      )
    );
    expect(setRole).not.toHaveBeenCalled();
    expect(await getSession()).toBeNull(); // signed back out
  });

  it('refuses a guardian account signing in as a patient', async () => {
    await registerUser('bob', 'password123', { isGuardian: true });
    const { setRole } = renderScreen(LoginScreen);
    fillForm('bob', 'password123');
    submit();

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Not a patient account',
        expect.stringContaining('guardian account')
      )
    );
    expect(setRole).not.toHaveBeenCalled();
    expect(await getSession()).toBeNull();
  });
});
