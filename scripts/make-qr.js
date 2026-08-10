#!/usr/bin/env node
/* eslint-disable no-console */
//
// Generates apk-qr.png — ONE permanent QR code for installing PillReminder.
//
// The point of this script is that you run it once. The QR encodes a URL that
// does not change, so the printed code stays valid forever:
//
//   * JS / UI / logic change  -> `eas update --branch preview`. The QR is not
//     involved at all; phones that already have the app pick the change up on
//     their next two launches. Nobody rescans anything.
//
//   * Native change (a new native module, a permission, an app.json plugin, or
//     a version bump) -> `eas build`. A new APK exists, but the URL below still
//     points at wherever the newest build lives, so the SAME QR installs it.
//
// The only reason to run this again is if you deliberately change the target
// URL — for example moving from the EAS build page to your own short link.

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const appJson = require('../app.json');
const { owner, slug } = appJson.expo;

// Where the QR points.
//
// GitHub's `releases/latest/download/<asset>` URL is permanent AND resolves to
// whatever the newest release holds. Crucially it needs no login, which the EAS
// build page does — scanning that just showed testers an expo.dev sign-in form.
//
// The repo is public, so this downloads straight to the phone. Publish each new
// APK under the SAME asset name (see `npm run release:apk`) and this URL — and
// therefore the QR — never changes.
const REPO = process.env.PILLREMINDER_REPO || 'kathisundeep/pillReminder';
const ASSET = 'pillreminder.apk';
const DEFAULT_TARGET = `https://github.com/${REPO}/releases/latest/download/${ASSET}`;

const target =
  process.argv.find((a) => a.startsWith('--url='))?.slice('--url='.length) ||
  process.env.PILLREMINDER_INSTALL_URL ||
  DEFAULT_TARGET;

const outPath = path.resolve(__dirname, '..', 'apk-qr.png');

async function main() {
  // High error correction: this gets printed, photographed and screenshotted.
  // A code that still scans with a corner obscured is worth the extra density.
  await QRCode.toFile(outPath, target, {
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
  console.log(`Encodes : ${target}`);
  console.log(`Written : ${path.relative(process.cwd(), outPath)}`);
  console.log(
    '\nThis QR is permanent and needs no login.\n' +
      '  JS change     -> eas update --branch preview   (phones self-update)\n' +
      '  native change -> eas build, then npm run release:apk\n' +
      'Either way the QR stays the same.'
  );
  console.log(`\nOwner ${owner} / slug ${slug}.`);
}

main().catch((e) => {
  console.error('Could not generate the QR:', e.message);
  process.exit(1);
});
