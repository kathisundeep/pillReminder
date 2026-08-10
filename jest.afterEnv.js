/* eslint-disable global-require */
// Runs after the test framework is installed. Resets every stateful mock
// between tests so suites can't leak into each other.

const AsyncStorage = require('@react-native-async-storage/async-storage');
const Notifications = require('expo-notifications');
const Av = require('expo-av');
const TaskManager = require('expo-task-manager');
const BackgroundFetch = require('expo-background-fetch');
const Device = require('expo-device');
const ImagePicker = require('expo-image-picker');
const ImageManipulator = require('expo-image-manipulator');
const { resetFakeIds } = require('./test/fakeSupabase');

// Force the @supabase/supabase-js mock factory to run even in test files that
// never import it, so globalThis.__db is always available to reset.
require('@supabase/supabase-js');

// Alerts are fired through RN's Alert.alert. Tests assert on the arguments and
// often need to invoke a button's onPress (e.g. the Delete confirmation).
jest.mock('react-native/Libraries/Alert/Alert', () => ({
  alert: jest.fn(),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  resetFakeIds();
  globalThis.__db.reset();
  Notifications.__reset();
  Av.__reset();
  TaskManager.__reset();
  BackgroundFetch.__reset();
  ImagePicker.__reset();
  ImageManipulator.__reset();
  Device.isDevice = true;
  await AsyncStorage.clear();
  // src/utils/storage.js caches the signed-in uid in a module-level object that
  // outlives a test. Clear it so a test that switches identity with db.as()
  // is not writing rows as the previous test's user.
  // eslint-disable-next-line global-require
  await require('./src/utils/storage').logoutUser();
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { status: 'ok', id: 'receipt-1' } }),
  }));
});

// Test helper: press a button inside the most recent Alert.alert(...) call.
const { Alert } = require('react-native');

globalThis.pressAlertButton = async (label) => {
  const calls = Alert.alert.mock.calls;
  if (calls.length === 0) throw new Error('Alert.alert was never called');
  const buttons = calls[calls.length - 1][2] || [];
  const btn = buttons.find((b) => b.text === label);
  if (!btn) {
    throw new Error(
      `No "${label}" button. Available: ${buttons.map((b) => b.text).join(', ') || '(none)'}`
    );
  }
  return btn.onPress ? btn.onPress() : undefined;
};

globalThis.lastAlert = () => {
  const calls = Alert.alert.mock.calls;
  return calls.length ? calls[calls.length - 1] : null;
};

// Fixed clock helper — most dose logic is time-of-day sensitive.
globalThis.setNow = (isoLocal) => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date(isoLocal));
};

afterEach(() => {
  jest.useRealTimers();
});
