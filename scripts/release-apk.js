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

async function publishWithToken(repo, tag, file, title, notes) {
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
  const { id } = await created.json();

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
  const tmp = path.join(os.tmpdir(), ASSET);

  console.log(`Build   ${build.id}`);
  console.log(`Version ${version}`);
  console.log(`Tag     ${tag}`);

  // Skip the download if a previous run already fetched this build's APK.
  if (!fs.existsSync(tmp) || process.env.FORCE_DOWNLOAD === 'true') {
    console.log('Downloading the APK…');
    run('curl', ['-fsSL', '-o', tmp, build.artifacts.buildUrl]);
  } else {
    console.log('Reusing the APK already downloaded to the temp directory.');
  }
  console.log(`APK ${(fs.statSync(tmp).size / 1024 / 1024).toFixed(1)} MB`);

  // A fresh tag each time keeps the release history readable; `latest` follows
  // whichever was published most recently, which is what the QR relies on.
  const title = `PillReminder ${version}`;
  const notes =
    `Android build \`${build.id}\`.\n\n` +
    'Scan `apk-qr.png` in the repo root to install. That QR never changes — ' +
    'it points at `releases/latest`, which this release now is.';

  console.log(`Publishing to ${repo} releases…`);
  if (useGh) {
    run('gh', [
      'release', 'create', tag, `${tmp}#${ASSET}`,
      '--title', title, '--notes', notes, '--latest',
      '--repo', repo,
    ], { stdio: 'inherit' });
  } else {
    await publishWithToken(repo, tag, tmp, title, notes);
  }

  console.log(
    `\nDone. https://github.com/${repo}/releases/latest/download/${ASSET}\n` +
      'now serves this build, so the QR in apk-qr.png installs it.\n' +
      'No need to regenerate or rescan.'
  );
}

main().catch((e) => {
  // Deliberately message-only: never dump the request, which carries the token.
  console.error(`\n${e.message}\n`);
  process.exit(1);
});
