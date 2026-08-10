// Setup for the LIVE project. Deliberately mocks almost nothing: these tests
// talk to the real Supabase backend so RLS is exercised for real.
//
// Guard: nothing runs unless RUN_LIVE=1 is set explicitly.

if (process.env.RUN_LIVE !== '1') {
  // eslint-disable-next-line no-console
  console.log(
    '\n[live] Skipped. Run with:  RUN_LIVE=1 npm run test:live\n'
  );
}

// The live suite builds its own supabase clients (one per simulated identity),
// so it only needs storage for session persistence.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
