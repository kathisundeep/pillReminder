import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  track,
  reportCrash,
  installCrashReporting,
  loadDiagnosticsChoice,
  setDiagnosticsEnabled,
  diagnosticsEnabled,
} from '../../src/utils/telemetry';
import { registerUser, loginUser } from '../../src/utils/storage';

const db = () => globalThis.__db;
const events = () => db().rows('app_events');

async function signedIn() {
  await registerUser('alice', 'password123');
  await loginUser('alice', 'password123');
  return db().session.user;
}

beforeEach(async () => {
  await setDiagnosticsEnabled(true);
});

describe('diagnostics', () => {
  it('records an event against the signed-in user, with the build', async () => {
    const user = await signedIn();
    await track('app_open', { role: 'patient' });

    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      user_id: user.id,
      kind: 'event',
      name: 'app_open',
      detail: { role: 'patient' },
      platform: expect.any(String),
    });
    expect(events()[0].app_version).toBeTruthy();
  });

  it('records a crash with its message and stack', async () => {
    await signedIn();
    await reportCrash(new Error('boom'), { where: 'render' });

    const [row] = events();
    expect(row).toMatchObject({ kind: 'crash', name: 'crash' });
    expect(row.detail.message).toBe('boom');
    expect(row.detail.where).toBe('render');
    expect(row.detail.stack).toContain('Error: boom');
  });

  // The table must never become a place user text ends up.
  it('drops anything that is not a short plain value', async () => {
    await signedIn();
    await track('dose_marked', {
      status: 'taken',
      count: 2,
      test: true,
      name: 'x'.repeat(200),          // trimmed
      med: { name: 'Metformin' },     // dropped
      times: ['08:00'],               // dropped
    });

    const { detail } = events()[0];
    expect(detail).toEqual({ status: 'taken', count: 2, test: true, name: 'x'.repeat(80) });
  });

  it('sends nothing once the user switches diagnostics off', async () => {
    await signedIn();
    await setDiagnosticsEnabled(false);

    expect(await track('app_open')).toBe(false);
    expect(await reportCrash(new Error('boom'))).toBe(false);
    expect(events()).toHaveLength(0);
    expect(await AsyncStorage.getItem('@pr_diagnostics')).toBe('off');
  });

  it('remembers the choice across restarts', async () => {
    await setDiagnosticsEnabled(false);
    expect(await loadDiagnosticsChoice()).toBe(false);
    expect(diagnosticsEnabled()).toBe(false);
  });

  it('sends nothing when signed out', async () => {
    expect(await track('app_open')).toBe(false);
    expect(events()).toHaveLength(0);
  });

  it('never throws, even when the write fails', async () => {
    await signedIn();
    db().failOn('app_events', 'insert', { message: 'nope' });
    await expect(track('app_open')).resolves.toBe(false);
    await expect(reportCrash(new Error('boom'))).resolves.toBe(false);
  });

  it('reports an uncaught error and still lets the app`s own handler run', async () => {
    await signedIn();
    const previous = jest.fn();
    global.ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (fn) => { global.ErrorUtils.handler = fn; },
    };
    installCrashReporting.installed = false;
    installCrashReporting();

    const error = new Error('uncaught');
    global.ErrorUtils.handler(error, true);
    await new Promise((r) => setTimeout(r, 0));

    expect(previous).toHaveBeenCalledWith(error, true);
    expect(events()[0].detail).toMatchObject({ message: 'uncaught', fatal: true });
  });
});
