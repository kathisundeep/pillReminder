#!/usr/bin/env node
/* eslint-disable no-console */
//
// Publishes the newest EAS Android build to GitHub Releases under a FIXED asset
// name, so that
//
//   https://github.com/<repo>/releases/latest/download/pillreminder.apk
//
// — the URL inside apk-qr.png — always serves the current app. Run this after
// every `eas build`. Never after `eas update`: JS-only changes reach installed
// phones on their own and need no new APK.
//
//   npm run release:apk
//
// Needs an authenticated eas-cli, plus ONE of:
//   * the GitHub CLI  — brew install gh && gh auth login
//   * a token         — export GITHUB_TOKEN=<PAT with Contents: read and write>
//
// The token is NEVER passed as a process argument and never appears in an error
// message. An earlier version shelled out to curl with the token on the command
// line, which meant any failure printed the secret into the terminal — and into
// whatever log or transcript was capturing it.

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ASSET = 'pillreminder.apk';
const { version } = require('../app.json').expo;

// GitHub reports a PAT's expiry on every API response. Capturing it turns the
// most confusing failure — a 403 from a token that quietly aged out — into a
// line that says so.
let tokenExpiry = null;

function noteExpiry(res) {
  const raw = res.headers.get('github-authentication-token-expiration');
  if (raw) tokenExpiry = raw;
}

function parseExpiry(raw) {
  // Seen as "2026-11-08 09:17:55 UTC" and as ISO, depending on token type.
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;
  const patched = new Date(String(raw).replace(' ', 'T').replace(' UTC', 'Z'));
  return Number.isNaN(patched.getTime()) ? null : patched;
}

// Returns { text, daysLeft, expired } — daysLeft is null when GitHub sent no
// expiry, which is what a classic token with "No expiration" does.
function expiryStatus() {
  if (!tokenExpiry) {
    return {
      text: 'Token expiry : none reported (a classic token set to never expire)',
      daysLeft: null,
      expired: false,
    };
  }
  const when = parseExpiry(tokenExpiry);
  if (!when) {
    return { text: `Token expiry : ${tokenExpiry}`, daysLeft: null, expired: false };
  }
  const daysLeft = Math.floor((when - Date.now()) / 86400000);
  const stamp = when.toISOString().slice(0, 10);
  if (daysLeft < 0) {
    return {
      text: `Token expiry : ${stamp} — EXPIRED ${Math.abs(daysLeft)} day(s) ago`,
      daysLeft,
      expired: true,
    };
  }
  return {
    text: `Token expiry : ${stamp} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)`,
    daysLeft,
    expired: false,
  };
}

// Subprocess errors quote the whole command line, so nothing secret may ever be
// passed as an argument. Errors are re-thrown without the args for good measure.
function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
  } catch (e) {
    const err = new Error(`${cmd} failed (exit ${e.status})`);
    err.stderr = e.stderr;
    throw err;
  }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Download what the QR actually points at and prove it is byte-for-byte the
// file we meant to publish.
//
// Publishing is several steps — create a release, upload an asset, let
// `latest` move — and a wrong-but-plausible result at any of them looks
// identical to success from the publishing side. The only trustworthy check is
// to fetch the public URL the way a phone would.
async function verifyPublished(repo, expectedSum) {
  const url = `https://github.com/${repo}/releases/latest/download/${ASSET}`;
  process.stdout.write('Verifying what the QR now serves… ');

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    console.log('');
    throw new Error(`The published URL returned ${res.status}: ${url}`);
  }
  const served = crypto
    .createHash('sha256')
    .update(Buffer.from(await res.arrayBuffer()))
    .digest('hex');

  if (served !== expectedSum) {
    console.log('MISMATCH\n');
    throw new Error(
      'The QR is serving a DIFFERENT file from the build that was just published.\n' +
        `  expected ${expectedSum.slice(0, 16)}…\n` +
        `  served   ${served.slice(0, 16)}…\n\n` +
        '  Nothing was corrupted — an older release is probably still marked\n' +
        '  `latest`, or the asset upload silently kept the previous file.\n' +
        `  Check https://github.com/${repo}/releases`
    );
  }
  console.log('matches.');
}

function has(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function repoSlug() {
  if (process.env.PILLREMINDER_REPO) return process.env.PILLREMINDER_REPO;
  const url = run('git', ['remote', 'get-url', 'origin']).trim();
  const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!m) {
    console.error(`\nNo GitHub repo in the origin remote: ${url}\n`);
    process.exit(1);
  }
  return m[1];
}

// The GitHub API through fetch, so the token stays in memory as a header value
// and never reaches a command line.
async function github(url, { method = 'GET', body, contentType } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    body,
  });

  // Read it even on failures — an expired token is exactly when this matters.
  noteExpiry(res);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let message = `GitHub returned ${res.status}`;
    try {
      message = JSON.parse(detail).message || message;
    } catch (e) {
      /* keep the status */
    }
    const expiry = expiryStatus();
    if (res.status === 401 || expiry.expired) {
      message +=
        `\n\n  ${expiry.text}\n` +
        '  The token is no longer valid. Generate a new one and re-export it.';
    } else if (res.status === 403 || res.status === 404) {
      message +=
        `\n\n  ${expiry.text}\n` +
        '  Not an expiry problem, so it is permissions. The token needs:\n' +
        '    fine-grained PAT -> Repository access includes this repo, and\n' +
        '                        Permissions > Repository > Contents: Read and write\n' +
        '    classic PAT      -> the `public_repo` scope (public repos)\n' +
        '  A 404 here usually means the same thing: GitHub hides repos the\n' +
        '  token cannot see rather than admitting they exist.';
    }
    throw new Error(message);
  }
  return res;
}

// Re-runnable. A failed or wrong publish must be fixable by running the same
// command again, rather than needing the release deleted by hand first.
async function publishWithToken(repo, tag, file, title, notes) {
  let id = null;

  // GitHub rejects a second release for the same tag, so adopt the existing one.
  const found = await fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
    { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } }
  );
  if (found.ok) {
    const existing = await found.json();
    id = existing.id;
    console.log(`Release ${tag} already exists — replacing its asset.`);

    // An upload does not overwrite: without this the old file simply stays.
    for (const asset of existing.assets || []) {
      if (asset.name === ASSET) {
        await github(
          `https://api.github.com/repos/${repo}/releases/assets/${asset.id}`,
          { method: 'DELETE' }
        );
      }
    }
    await github(`https://api.github.com/repos/${repo}/releases/${id}`, {
      method: 'PATCH',
      contentType: 'application/json',
      body: JSON.stringify({ name: title, body: notes, make_latest: 'true' }),
    });
  } else {
    const created = await github(`https://api.github.com/repos/${repo}/releases`, {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        tag_name: tag,
        name: title,
        body: notes,
        make_latest: 'true',
      }),
    });
    id = (await created.json()).id;
  }

  await github(
    `https://uploads.github.com/repos/${repo}/releases/${id}/assets?name=${ASSET}`,
    {
      method: 'POST',
      contentType: 'application/vnd.android.package-archive',
      body: fs.readFileSync(file),
    }
  );
}

// Check the token before doing any real work. Failing after a 70 MB download
// is a slow way to learn the credential was wrong.
async function preflight(repo) {
  const me = await github('https://api.github.com/user');
  const { login } = await me.json();

  // Proves the token can actually see this repo, which a 404 would deny.
  const repoRes = await github(`https://api.github.com/repos/${repo}`);
  const { private: isPrivate } = await repoRes.json();

  const expiry = expiryStatus();
  console.log(`GitHub user  : ${login}`);
  console.log(`Repo         : ${repo}${isPrivate ? ' (private)' : ' (public)'}`);
  console.log(expiry.text);

  if (expiry.daysLeft !== null && expiry.daysLeft <= 7) {
    console.log(
      `\n  ⚠ This token expires in ${expiry.daysLeft} day(s). Renew it before the\n` +
        '    next release, or that run will fail with a 403.\n'
    );
  }
  console.log('');
}

async function main() {
  const useGh = has('gh');
  if (!useGh && !process.env.GITHUB_TOKEN) {
    console.error(
      '\nNeed a way to publish the release. Either:\n' +
        '  brew install gh && gh auth login\n' +
        '  or  export GITHUB_TOKEN=<PAT with Contents: read and write>\n'
    );
    process.exit(1);
  }
  const repo = repoSlug();
  if (!useGh) await preflight(repo);

  console.log('Finding the newest finished Android build…');
  const raw = run('npx', [
    'eas-cli', 'build:list',
    '--platform', 'android',
    '--status', 'finished',
    '--limit', '1',
    '--json', '--non-interactive',
  ]);

  const [build] = JSON.parse(raw);
  if (!build?.artifacts?.buildUrl) {
    console.error(
      '\nNo finished Android build found. Run this first:\n' +
        '  eas build -p android --profile preview\n'
    );
    process.exit(1);
  }

  const tag = `v${version}-${build.id.slice(0, 7)}`;

  // The temp filename MUST carry the build id.
  //
  // It used to be a constant, so a second run found the previous build's APK
  // already sitting there, logged "Reusing the APK already downloaded", and
  // published stale bytes under the new build's tag. The release looked
  // correct from every angle — right tag, right size, right asset name — while
  // serving the old app. Diagnosing that from the phone is near impossible,
  // because the only symptom is that a change you know you shipped is absent.
  // The file itself must be called ASSET: gh names the upload after the file,
  // and the `#ASSET` suffix below only sets a display label. A file named after
  // the build id published under that name, and the QR's fixed URL 404'd.
  const dir = path.join(os.tmpdir(), `pillreminder-${build.id}`);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, ASSET);

  console.log(`Build   ${build.id}`);
  console.log(`Version ${version}`);
  console.log(`Tag     ${tag}`);

  if (!fs.existsSync(tmp) || process.env.FORCE_DOWNLOAD === 'true') {
    console.log('Downloading the APK…');
    run('curl', ['-fsSL', '-o', tmp, build.artifacts.buildUrl]);
  } else {
    console.log('Reusing this build\'s APK from the temp directory.');
  }

  const localSum = sha256File(tmp);
  console.log(`APK     ${(fs.statSync(tmp).size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`SHA-256 ${localSum.slice(0, 16)}…`);

  // A fresh tag each time keeps the release history readable; `latest` follows
  // whichever was published most recently, which is what the QR relies on.
  const title = `PillReminder ${version}`;
  const notes =
    `Android build \`${build.id}\`.\n\n` +
    'Scan `apk-qr.png` in the repo root to install. That QR never changes — ' +
    'it points at `releases/latest`, which this release now is.';

  console.log(`Publishing to ${repo} releases…`);
  if (useGh) {
    // `create` fails outright if the tag exists, so try it and fall back to
    // clobbering the asset on the release that is already there.
    try {
      run('gh', [
        'release', 'create', tag, `${tmp}#${ASSET}`,
        '--title', title, '--notes', notes, '--latest',
        '--repo', repo,
      ], { stdio: 'inherit' });
    } catch (e) {
      console.log(`Release ${tag} already exists — replacing its asset.`);
      run('gh', [
        'release', 'upload', tag, `${tmp}#${ASSET}`,
        '--clobber', '--repo', repo,
      ], { stdio: 'inherit' });
    }
  } else {
    await publishWithToken(repo, tag, tmp, title, notes);
  }

  // GitHub's CDN needs a moment before `latest` resolves to the new asset.
  await new Promise((r) => setTimeout(r, 3000));
  await verifyPublished(repo, localSum);

  console.log(
    `\nDone. https://github.com/${repo}/releases/latest/download/${ASSET}\n` +
      'now serves this build, verified byte-for-byte, so the QR in apk-qr.png\n' +
      'installs it. No need to regenerate or rescan.'
  );
}

main().catch((e) => {
  // Deliberately message-only: never dump the request, which carries the token.
  console.error(`\n${e.message}\n`);
  process.exit(1);
});
