/* eslint-disable global-require */
// Module-registry mocks for the default (fully mocked, offline) project.
// Every native/expo module the app touches is replaced with a stateful fake so
// tests can assert on real behaviour instead of just "it didn't crash".

// ---------------------------------------------------------------------------
// Supabase — one fake instance shared by the whole test file, reset between
// tests in jest.afterEnv.js. Identity must stay stable because src/utils/
// supabase.js captures the client at module load.
// ---------------------------------------------------------------------------
jest.mock('@supabase/supabase-js', () => {
  const { createFakeSupabase } = require('./test/fakeSupabase');
  const { client, db } = createFakeSupabase();

  db.reset = () => {
    for (const t of Object.keys(db.tables)) db.tables[t] = [];
    db.authUsers.length = 0;
    db.session = null;
    db.errors = {};
    db.pairingAttempts.length = 0;
    db.functionHandlers = {};
    db.rlsEnabled = true;
    // The plan catalog is seeded by schema.sql / subscriptions.sql in prod.
    db.tables.plans.push(
      { id: 'free', name: 'Free', price_cents: 0, currency: 'INR', interval: 'month', max_guardians: 1, features: {} },
      { id: 'plus', name: 'Plus', price_cents: 9900, currency: 'INR', interval: 'month', max_guardians: 3, features: { trackers: true, historyYears: 2 } },
      { id: 'family', name: 'Family', price_cents: 19900, currency: 'INR', interval: 'month', max_guardians: 5, features: { trackers: true, historyYears: 2 } }
    );
  };

  globalThis.__db = db;
  return { createClient: () => client };
});

// ---------------------------------------------------------------------------
// AsyncStorage
// ---------------------------------------------------------------------------
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// ---------------------------------------------------------------------------
// expo-notifications — stateful: it remembers what was scheduled so tests can
// assert on alarm arming/cancelling rather than just call counts.
// ---------------------------------------------------------------------------
jest.mock('expo-notifications', () => {
  const state = {
    permission: 'granted',
    scheduled: [], // { identifier, content, trigger }
    channels: {},
    deletedChannels: [],
    categories: {},
    handler: null,
    receivedListeners: [],
    responseListeners: [],
    pushToken: 'ExponentPushToken[test-device]',
    pushTokenError: null,
    nextId: 0,
  };

  const api = {
    __state: state,
    __reset() {
      state.permission = 'granted';
      state.scheduled = [];
      state.channels = {};
      state.deletedChannels = [];
      state.categories = {};
      state.handler = null;
      state.receivedListeners = [];
      state.responseListeners = [];
      state.pushToken = 'ExponentPushToken[test-device]';
      state.pushTokenError = null;
      state.nextId = 0;
    },
    // Test helpers to drive the listeners registered by App.js.
    __emitReceived(notification) {
      state.receivedListeners.forEach((fn) => fn(notification));
    },
    __emitResponse(response) {
      return Promise.all(state.responseListeners.map((fn) => fn(response)));
    },

    AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3 },
    AndroidNotificationPriority: { MAX: 'max', HIGH: 'high', DEFAULT: 'default' },
    AndroidNotificationVisibility: { PUBLIC: 1, PRIVATE: 0, SECRET: -1 },

    setNotificationHandler: jest.fn((h) => {
      state.handler = h;
    }),
    getPermissionsAsync: jest.fn(async () => ({ status: state.permission })),
    requestPermissionsAsync: jest.fn(async () => ({ status: state.permission })),
    deleteNotificationChannelAsync: jest.fn(async (id) => {
      state.deletedChannels.push(id);
      delete state.channels[id];
    }),
    setNotificationChannelAsync: jest.fn(async (id, cfg) => {
      state.channels[id] = cfg;
      return cfg;
    }),
    getNotificationChannelsAsync: jest.fn(async () =>
      Object.entries(state.channels).map(([id, cfg]) => ({ id, ...cfg }))
    ),
    setNotificationCategoryAsync: jest.fn(async (id, actions) => {
      state.categories[id] = actions;
      return actions;
    }),
    scheduleNotificationAsync: jest.fn(async ({ content, trigger }) => {
      state.nextId += 1;
      const identifier = `notif-${state.nextId}`;
      state.scheduled.push({ identifier, content, trigger });
      return identifier;
    }),
    getAllScheduledNotificationsAsync: jest.fn(async () => [...state.scheduled]),
    cancelScheduledNotificationAsync: jest.fn(async (id) => {
      state.scheduled = state.scheduled.filter((n) => n.identifier !== id);
    }),
    cancelAllScheduledNotificationsAsync: jest.fn(async () => {
      state.scheduled = [];
    }),
    getExpoPushTokenAsync: jest.fn(async () => {
      if (state.pushTokenError) throw state.pushTokenError;
      return { data: state.pushToken };
    }),
    addNotificationReceivedListener: jest.fn((fn) => {
      state.receivedListeners.push(fn);
      return {
        remove: jest.fn(() => {
          state.receivedListeners = state.receivedListeners.filter((f) => f !== fn);
        }),
      };
    }),
    addNotificationResponseReceivedListener: jest.fn((fn) => {
      state.responseListeners.push(fn);
      return {
        remove: jest.fn(() => {
          state.responseListeners = state.responseListeners.filter((f) => f !== fn);
        }),
      };
    }),
  };
  return api;
});

// ---------------------------------------------------------------------------
// Remaining expo modules
// ---------------------------------------------------------------------------
jest.mock('expo-device', () => ({ __esModule: true, isDevice: true }));

jest.mock('expo-av', () => {
  const state = { created: [], audioMode: null, failCreate: false };
  const makeSound = () => ({
    stopAsync: jest.fn(async () => {}),
    unloadAsync: jest.fn(async () => {}),
    playAsync: jest.fn(async () => {}),
    setVolumeAsync: jest.fn(async () => {}),
  });
  return {
    __state: state,
    __reset() {
      state.created = [];
      state.audioMode = null;
      state.failCreate = false;
    },
    InterruptionModeAndroid: { DoNotMix: 1, DuckOthers: 2 },
    InterruptionModeIOS: { DoNotMix: 1, DuckOthers: 2 },
    Audio: {
      setAudioModeAsync: jest.fn(async (m) => {
        state.audioMode = m;
      }),
      Sound: {
        createAsync: jest.fn(async (source, opts) => {
          if (state.failCreate) throw new Error('audio unavailable');
          const sound = makeSound();
          state.created.push({ source, opts, sound });
          return { sound, status: { isLoaded: true } };
        }),
      },
    },
  };
});

jest.mock('expo-task-manager', () => {
  const state = { tasks: {}, registered: {} };
  return {
    __state: state,
    __reset() {
      state.tasks = {};
      state.registered = {};
    },
    defineTask: jest.fn((name, fn) => {
      state.tasks[name] = fn;
    }),
    isTaskRegisteredAsync: jest.fn(async (name) => !!state.registered[name]),
    unregisterTaskAsync: jest.fn(async (name) => {
      delete state.registered[name];
    }),
  };
});

jest.mock('expo-background-fetch', () => {
  const TaskManager = require('expo-task-manager');
  const state = { status: 3 };
  return {
    __state: state,
    __reset() {
      state.status = 3;
    },
    BackgroundFetchStatus: { Denied: 1, Restricted: 2, Available: 3 },
    BackgroundFetchResult: { NoData: 1, NewData: 2, Failed: 3 },
    getStatusAsync: jest.fn(async () => state.status),
    registerTaskAsync: jest.fn(async (name, opts) => {
      TaskManager.__state.registered[name] = opts;
    }),
    unregisterTaskAsync: jest.fn(async (name) => {
      delete TaskManager.__state.registered[name];
    }),
  };
});

// Photo capture. `__state` drives permission grants, cancellation and the
// picked asset so the whole capture->shrink->store path can be exercised.
jest.mock('expo-image-picker', () => {
  const state = {
    cameraPermission: { granted: true },
    libraryPermission: { granted: true },
    result: { canceled: false, assets: [{ uri: 'file:///photo.jpg' }] },
  };
  return {
    __state: state,
    __reset() {
      state.cameraPermission = { granted: true };
      state.libraryPermission = { granted: true };
      state.result = { canceled: false, assets: [{ uri: 'file:///photo.jpg' }] };
    },
    MediaTypeOptions: { Images: 'Images', All: 'All' },
    requestCameraPermissionsAsync: jest.fn(async () => state.cameraPermission),
    requestMediaLibraryPermissionsAsync: jest.fn(async () => state.libraryPermission),
    launchCameraAsync: jest.fn(async () => state.result),
    launchImageLibraryAsync: jest.fn(async () => state.result),
  };
});

// Image compression. Returns a base64 string whose LENGTH is driven by the
// requested resize width, so the shrink() budget loop is genuinely exercised
// instead of being short-circuited by a constant-size fake.
jest.mock('expo-image-manipulator', () => {
  const state = {
    // base64 length produced for each resize width.
    sizeForWidth: { 400: 30000, 320: 18000, 256: 9000, 192: 4000 },
    calls: [],
    omitBase64: false,
  };
  return {
    __state: state,
    __reset() {
      state.sizeForWidth = { 400: 30000, 320: 18000, 256: 9000, 192: 4000 };
      state.calls = [];
      state.omitBase64 = false;
    },
    SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
    manipulateAsync: jest.fn(async (uri, actions, opts) => {
      const width = actions?.[0]?.resize?.width;
      state.calls.push({ uri, width, opts });
      const len = state.sizeForWidth[width] ?? 1000;
      return {
        uri: `${uri}#w${width}`,
        width,
        height: width,
        base64: state.omitBase64 ? undefined : 'x'.repeat(len),
      };
    }),
  };
});

jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children, style, colors: gradientColors, ...rest }) =>
      React.createElement(
        View,
        { ...rest, style: [{ backgroundColor: gradientColors?.[0] }, style] },
        children
      ),
  };
});

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => {}),
  deactivateKeepAwake: jest.fn(() => {}),
}));

jest.mock('expo-constants', () => {
  // Required inside the factory: jest.mock factories are hoisted above imports.
  const config = require('./app.json');
  return {
    __esModule: true,
    default: {
      expoConfig: config.expo,
      easConfig: { projectId: config.expo.extra.eas.projectId },
      manifest: config.expo,
    },
  };
});

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

// ---------------------------------------------------------------------------
// react-native ecosystem
// ---------------------------------------------------------------------------
// The library ships its own mock; a hand-rolled one omits SafeAreaInsetsContext
// / SafeAreaFrameContext, which @react-navigation/elements reads directly.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default
);

require('react-native-gesture-handler/jestSetup');

// Silence the RN Animated helper warning that jest-expo surfaces.
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

// fetch — used only for the Expo push endpoint. Default: accepted delivery.
globalThis.fetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ data: { status: 'ok', id: 'receipt-1' } }),
}));
