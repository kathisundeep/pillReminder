#!/usr/bin/env node
/* eslint-disable no-console */
//
// Increments the app version shown on the login screen.
//
//   npm run bump           0.0.1 -> 0.0.2
//   npm run bump -- --show just prints the current version
//
// Counts in base 100 rather than the usual semver: the patch runs 0..99 and
// then rolls into the minor, which rolls into the major. So 0.0.99 is followed
// by 0.1.0, and 0.99.99 by 1.0.0. It is a change counter, not a statement about
// API compatibility.
//
// WHAT THIS DOES NOT TOUCH
//
// runtimeVersion. It is pinned in app.json rather than derived from the
// version, and that separation is load-bearing: runtimeVersion is the contract
// between an installed APK and the updates it will accept. Bumping it strands
// every phone already carrying the app — they keep asking for the old runtime,
// receive nothing, and report the change as missing with no way to tell why.
// Only a native change earns a new runtimeVersion, and a new APK with it.

const fs = require('fs');
const path = require('path');

const APP_JSON = path.resolve(__dirname, '..', 'app.json');
const WRAP = 100; // patch and minor each run 0..99

// Exported for tests. Pure: takes a version string, returns the next one.
function nextVersion(version) {
  const parts = String(version ?? '').split('.');
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`Not a three-part numeric version: "${version}"`);
  }
  let [major, minor, patch] = parts.map(Number);

  patch += 1;
  if (patch >= WRAP) {
    patch = 0;
    minor += 1;
  }
  if (minor >= WRAP) {
    minor = 0;
    major += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function main() {
  const json = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
  const current = json.expo.version;

  if (process.argv.includes('--show')) {
    console.log(current);
    return;
  }

  const next = nextVersion(current);
  json.expo.version = next;

  // Google Play rejects an upload whose versionCode is not higher than the
  // last one, and it must never wrap — so it just counts up, independently of
  // the displayed version.
  json.expo.android = json.expo.android || {};
  json.expo.android.versionCode = (json.expo.android.versionCode || 0) + 1;

  fs.writeFileSync(APP_JSON, JSON.stringify(json, null, 2) + '\n');

  console.log(`${current} -> ${next}   (versionCode ${json.expo.android.versionCode})`);

  if (typeof json.expo.runtimeVersion !== 'string') {
    console.log(
      '\n  ⚠ runtimeVersion is not a pinned string. If it derives from the\n' +
        '    version, this bump just cut off every installed app from updates.\n' +
        '    See docs/versioning.md.\n'
    );
  } else {
    console.log(`runtimeVersion stays ${json.expo.runtimeVersion} — installed apps keep updating.`);
  }
  console.log('\nShip it:  eas update --branch preview');
}

if (require.main === module) main();

module.exports = { nextVersion, WRAP };
