#!/usr/bin/env node
/* eslint-disable no-console */
//
// Generates apk-qr.png — a QR that installs the newest build.
//
//   npm run qr
//
// Points at the permanent GitHub URL (releases/latest/download/pillreminder.apk),
// which `npm run release:apk` keeps current and verifies byte-for-byte against
// the EAS build. So the QR only needs generating once; after a new build, run
// release:apk and the same code installs it.
//
// It used to point straight at the EAS artifact instead. Those links EXPIRE:
// a QR scanned weeks later returned S3's "NoSuchKey" XML instead of an APK.
//
// JS-only changes still need nothing here — `eas update --branch preview` and
// installed apps pick them up on foreground.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const appJson = require('../app.json');
const { owner, slug, version } = appJson.expo;

const outPath = path.resolve(__dirname, '..', 'apk-qr.png');

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function headCommit() {
  try {
    return run('git', ['rev-parse', 'HEAD']).trim();
  } catch (e) {
    return null;
  }
}

function newestBuild() {
  const raw = run('npx', [
    'eas-cli', 'build:list',
    '--platform', 'android',
    '--status', 'finished',
    '--limit', '1',
    '--json', '--non-interactive',
  ]);
  const [build] = JSON.parse(raw);
  return build || null;
}

async function main() {
  // An explicit URL still wins, for a short link or a self-hosted copy.
  const override =
    process.argv.find((a) => a.startsWith('--url='))?.slice('--url='.length) ||
    process.env.PILLREMINDER_INSTALL_URL;

  let target = override;
  let build = null;

  // --eas points at the newest EAS artifact instead (it expires; see above).
  if (!target && !process.argv.includes('--eas')) {
    const repo = run('git', ['remote', 'get-url', 'origin'])
      .trim()
      .replace(/^.*github\.com[:/]/, '')
      .replace(/\.git$/, '');
    target = `https://github.com/${repo}/releases/latest/download/pillreminder.apk`;
  }

  if (!target) {
    console.log('Finding the newest finished Android build…');
    build = newestBuild();
    if (!build?.artifacts?.buildUrl) {
      console.error(
        '\nNo finished Android build found. Run this first:\n' +
          '  eas build -p android --profile preview\n'
      );
      process.exit(1);
    }
    target = build.artifacts.buildUrl;
  }

  // Prove the URL actually serves an APK before printing a code that claims it
  // does. A QR is trusted on sight — nobody re-checks it after scanning.
  process.stdout.write('Checking the download URL… ');
  const res = await fetch(target, { method: 'GET', headers: { Range: 'bytes=0-1' } });
  if (!res.ok && res.status !== 206) {
    console.log('');
    console.error(`\nThat URL returned ${res.status}. Not writing a QR for it.\n  ${target}\n`);
    process.exit(1);
  }
  console.log('reachable.');

  await QRCode.toFile(outPath, target, {
    // High error correction: this gets printed, photographed and screenshotted.
    // A code that still scans with a corner obscured is worth the extra density.
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 900,
    color: { dark: '#0f172a', light: '#ffffff' },
  });

  const ascii = await QRCode.toString(target, {
    type: 'terminal',
    small: true,
    errorCorrectionLevel: 'M',
  });
  console.log(ascii);

  if (build) {
    console.log(`Build   ${build.id}`);
    console.log(`Version ${build.appVersion} (runtime ${build.runtimeVersion})`);

    // The check that says whether this APK contains the code you are looking
    // at. A build from an older commit is the failure that wastes the most
    // time, because the app looks fine — it is just not the app you changed.
    const head = headCommit();
    const built = build.gitCommitHash;
    if (head && built) {
      if (head === built) {
        console.log(`Commit  ${built.slice(0, 8)} — matches HEAD`);
      } else {
        console.log(
          `Commit  ${built.slice(0, 8)} — HEAD is ${head.slice(0, 8)}\n\n` +
            '  ⚠ This build predates your current code. Anything committed\n' +
            '    since will NOT be in the APK. Run `eas build` again if you\n' +
            '    need those changes natively — or ship them with\n' +
            '    `eas update --branch preview`, which does not need a build.\n'
        );
      }
    }
  }

  console.log(`\nEncodes : ${target}`);
  console.log(`Written : ${path.relative(process.cwd(), outPath)}`);
  console.log(`Size    : ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB`);
  console.log(
    `\nApp ${version} · ${owner}/${slug}\n\n` +
      (process.argv.includes('--eas') || override
        ? 'This QR points at one specific build, so regenerate it after every\n' +
          '`eas build`.'
        : 'This QR is permanent: after a new `eas build`, run `npm run release:apk`\n' +
          'and the same code installs it.') +
      ' JS-only changes need neither — run\n' +
      '`eas update --branch preview` and installed apps pick them up.\n\n' +
      'Uninstall the old app before scanning: installing over the top can keep\n' +
      'a cached JS bundle and hide the change you are testing.'
  );
}

main().catch((e) => {
  console.error('\nCould not generate the QR:', e.message, '\n');
  process.exit(1);
});
