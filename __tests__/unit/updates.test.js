import * as Updates from 'expo-updates';
import {
  applyUpdateIfAny,
  holdUpdates,
  updatesHeld,
  runningUpdate,
  buildLabel,
} from '../../src/utils/updates';

const state = Updates.__state;

function reset(over = {}) {
  Object.assign(state, {
    isEnabled: true,
    isEmbeddedLaunch: true,
    updateId: null,
    channel: 'preview',
    runtimeVersion: '1.1.0',
    createdAt: null,
    available: false,
    isNew: true,
    checkThrows: null,
    fetchThrows: null,
    ...over,
  });
  Updates.checkForUpdateAsync.mockClear();
  Updates.fetchUpdateAsync.mockClear();
  Updates.reloadAsync.mockClear();
}

beforeEach(() => reset());

describe('applyUpdateIfAny', () => {
  it('does nothing when there is no update', async () => {
    expect(await applyUpdateIfAny()).toBe('none');
    expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
  });

  // The whole point: without this the bundle sits downloaded and unapplied
  // until a cold start that Android may never grant.
  it('fetches and reloads when one is available', async () => {
    reset({ available: true });
    expect(await applyUpdateIfAny()).toBe('applied');
    expect(Updates.fetchUpdateAsync).toHaveBeenCalled();
    expect(Updates.reloadAsync).toHaveBeenCalled();
  });

  it('does not reload when the fetched bundle is not actually new', async () => {
    reset({ available: true, isNew: false });
    expect(await applyUpdateIfAny()).toBe('none');
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('can fetch without reloading when asked', async () => {
    reset({ available: true });
    expect(await applyUpdateIfAny({ reload: false })).toBe('applied');
    expect(Updates.fetchUpdateAsync).toHaveBeenCalled();
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('stays quiet when updates are disabled', async () => {
    reset({ isEnabled: false });
    expect(await applyUpdateIfAny()).toBe('disabled');
    expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('keeps running when the check fails', async () => {
    reset({ checkThrows: 'Network request failed' });
    expect(await applyUpdateIfAny()).toBe('failed');
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('keeps running when the download fails', async () => {
    reset({ available: true, fetchThrows: 'connection reset' });
    expect(await applyUpdateIfAny()).toBe('failed');
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
  });
});

describe('holdUpdates', () => {
  // A reload during an alarm dismisses it without recording a dose, which
  // reads to the user as a dose that silently vanished.
  it('blocks a reload while held', async () => {
    reset({ available: true });
    const release = holdUpdates();
    expect(updatesHeld()).toBe(true);
    expect(await applyUpdateIfAny()).toBe('held');
    expect(Updates.reloadAsync).not.toHaveBeenCalled();

    release();
    expect(updatesHeld()).toBe(false);
    expect(await applyUpdateIfAny()).toBe('applied');
    expect(Updates.reloadAsync).toHaveBeenCalled();
  });

  it('needs every hold released, not just one', async () => {
    reset({ available: true });
    const a = holdUpdates();
    const b = holdUpdates();
    a();
    expect(await applyUpdateIfAny()).toBe('held');
    b();
    expect(await applyUpdateIfAny()).toBe('applied');
  });

  it('ignores a double release rather than going negative', async () => {
    const release = holdUpdates();
    release();
    release();
    expect(updatesHeld()).toBe(false);

    // A stray extra release must not cancel a genuine later hold.
    const later = holdUpdates();
    expect(updatesHeld()).toBe(true);
    later();
    expect(updatesHeld()).toBe(false);
  });

  // The hold is re-read after the download, because an alarm can arrive during
  // it — the window this closes is small but the consequence is a missed dose.
  it('does not reload if a hold is taken while the update downloads', async () => {
    reset({ available: true });
    let release;
    Updates.fetchUpdateAsync.mockImplementationOnce(async () => {
      release = holdUpdates();
      return { isNew: true };
    });
    expect(await applyUpdateIfAny()).toBe('held');
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
    release();
  });
});

describe('runningUpdate', () => {
  it('reports an APK with no update applied as embedded', () => {
    reset({ isEmbeddedLaunch: true, updateId: null });
    const info = runningUpdate();
    expect(info.embedded).toBe(true);
    expect(info.short).toBe('embedded');
  });

  it('reports the applied update by a short id', () => {
    reset({ isEmbeddedLaunch: false, updateId: '69f215f0-9e2f-43d3-832e-9e0e17114fed' });
    const info = runningUpdate();
    expect(info.embedded).toBe(false);
    expect(info.short).toBe('69f215f0');
    expect(info.runtimeVersion).toBe('1.1.0');
    expect(info.channel).toBe('preview');
  });
});

describe('buildLabel', () => {
  it('names an APK with nothing applied as installed, without repeating itself', () => {
    reset({ isEmbeddedLaunch: true, updateId: null });
    expect(buildLabel('0.0.1')).toBe('v0.0.1 · as installed');
  });

  it('shows the short update id once one is applied', () => {
    reset({ isEmbeddedLaunch: false, updateId: '019feb70-9bba-77c6-973e-46a06fb00425' });
    expect(buildLabel('0.0.2')).toBe('v0.0.2 · 019feb70');
  });
});
