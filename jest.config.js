// Jest harness for PillReminder.
//
// Two projects:
//   default — fully mocked, no network. This is what `npm test` runs and what
//             must stay green on every change.
//   live    — hits the real Supabase project. Excluded from the default run and
//             gated behind RUN_LIVE=1 (see __tests__/live/).
//
// The `jest-expo` preset supplies the React Native transform + the
// transformIgnorePatterns needed to compile the untranspiled expo/RN packages.

// Pin the timezone so date-sensitive tests are reproducible on any machine and
// in CI. IST is the app's primary market and is UTC+5:30 — a non-zero, non-whole
// -hour offset, which is exactly what exposes UTC-vs-local date-key bugs.
process.env.TZ = process.env.TEST_TZ || 'Asia/Kolkata';

module.exports = {
  projects: [
    {
      // Android preset: this app is Android-first (alarm channels, exact-alarm
      // permissions, the background sweep). Tests that need iOS behaviour flip
      // Platform.OS explicitly.
      preset: 'jest-expo/android',
      displayName: 'unit',
      testMatch: [
        '<rootDir>/__tests__/unit/**/*.test.js',
        '<rootDir>/__tests__/integration/**/*.test.js',
        '<rootDir>/__tests__/screens/**/*.test.js',
        '<rootDir>/__tests__/app/**/*.test.js',
        '<rootDir>/__tests__/config/**/*.test.js',
      ],
      setupFiles: ['<rootDir>/jest.setup.js'],
      setupFilesAfterEnv: ['<rootDir>/jest.afterEnv.js'],
    },
    {
      preset: 'jest-expo',
      displayName: 'live',
      testMatch: ['<rootDir>/__tests__/live/**/*.test.js'],
      setupFiles: ['<rootDir>/jest.live.setup.js'],
    },
  ],
  // Live tests share one real backend — never run their files in parallel.
  ...(process.env.RUN_LIVE === '1'
    ? { maxWorkers: 1, testTimeout: 60000 }
    : { testTimeout: 15000 }),
  collectCoverageFrom: [
    'src/**/*.js',
    'App.js',
    '!src/**/__mocks__/**',
  ],
};
