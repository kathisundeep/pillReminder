import * as Updates from 'expo-updates';

// Applying over-the-air updates without needing two relaunches.
//
// expo-updates' default is deliberately conservative: it downloads a new bundle
// in the background and applies it on the NEXT cold start. That is right for a
// released app — nobody wants the screen to reload underneath them — but during
// active development it means a change is published, the app is reopened, and
// the old code is still running with no indication why. Worse, "closing" an app
// on Android often does not end the process, so the second launch never happens
// and the update sits downloaded but unapplied indefinitely.
//
// So: check on launch and on foreground, and reload immediately once a new
// bundle is ready. A reload at foreground is unobtrusive — the user is arriving
// at the app, not in the middle of something.

// A missed dose must never be lost to a reload, so anything mid-flight is a
// reason to wait for the next opportunity rather than to interrupt.
let busy = false;
let suspended = 0;

// Call around work that must not be interrupted (an alarm being answered, a
// form being submitted). Returns a function that lifts the suspension.
export function holdUpdates() {
  suspended += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    suspended = Math.max(0, suspended - 1);
  };
}

export function updatesHeld() {
  return suspended > 0;
}

// What is actually running. Worth surfacing in Settings: without it there is no
// way to tell a bundle that failed to apply from a change that did not work.
export function runningUpdate() {
  const id = Updates.updateId;
  return {
    // A build straight from the store or an APK has no update applied yet.
    embedded: Updates.isEmbeddedLaunch !== false && !id,
    id: id || null,
    short: id ? String(id).slice(0, 8) : 'embedded',
    channel: Updates.channel || null,
    runtimeVersion: Updates.runtimeVersion || null,
    createdAt: Updates.createdAt || null,
  };
}

// Returns one of: 'disabled' | 'held' | 'busy' | 'none' | 'applied' | 'failed'.
// Never throws — a failed update check must not take the app down with it.
export async function applyUpdateIfAny({ reload = true } = {}) {
  // isEnabled already covers Expo Go and dev builds, where a check would fail
  // noisily and pointlessly — so it is the only guard needed here.
  if (!Updates.isEnabled) return 'disabled';
  if (suspended > 0) return 'held';
  if (busy) return 'busy';

  busy = true;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check?.isAvailable) return 'none';

    const fetched = await Updates.fetchUpdateAsync();
    if (!fetched?.isNew) return 'none';

    if (!reload) return 'applied';

    // Re-read the guard: fetching takes time, and an alarm may have arrived
    // during it. Reloading mid-alarm would dismiss it without recording a dose.
    if (suspended > 0) return 'held';

    await Updates.reloadAsync();
    return 'applied';
  } catch (e) {
    // Offline, or the update server is unreachable. The app keeps running on
    // the bundle it has, which is the correct outcome.
    return 'failed';
  } finally {
    busy = false;
  }
}
