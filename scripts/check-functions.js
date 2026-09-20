#!/usr/bin/env node
/* eslint-disable no-console */
//
// Reports whether the registration Edge Functions are live.
//
//   npm run fn:check
//
// 404 means the function was never deployed — the failure that stops
// registration dead, and the one that is least obvious from the app, since
// supabase-js reports it as a generic "non-2xx status code".
//
// 400 is the healthy answer here: the function ran and rejected an empty body,
// which is exactly what it should do.

const { expo } = require('../app.json');

const URL = expo.extra?.supabaseUrl;
const KEY = expo.extra?.supabaseAnonKey;
const FUNCTIONS = ['send-otp', 'verify-otp', 'create-account', 'reset-password', 'change-password', 'change-phone'];

async function probe(name) {
  const started = Date.now();
  try {
    const res = await fetch(`${URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text().catch(() => '');
    return { name, status: res.status, body, ms: Date.now() - started };
  } catch (e) {
    return { name, status: null, error: e.message, ms: Date.now() - started };
  }
}

function verdict({ status, body, error }) {
  if (status === null) return ['UNREACHABLE', error];
  if (status === 404) return ['NOT DEPLOYED', 'run: npm run fn:deploy'];
  if (status === 401 || status === 403) {
    return [
      'JWT VERIFY ON',
      'deploy with --no-verify-jwt, or keep supabase/config.toml',
    ];
  }
  if (status >= 500) return ['ERRORING', (body || '').slice(0, 120)];
  // 400 is the function running correctly and refusing an empty body.
  return ['LIVE', `HTTP ${status}`];
}

async function main() {
  if (!URL || !KEY) {
    console.error('\napp.json is missing expo.extra.supabaseUrl / supabaseAnonKey\n');
    process.exit(1);
  }

  console.log(`\n${URL}\n`);
  const results = await Promise.all(FUNCTIONS.map(probe));

  let bad = 0;
  for (const r of results) {
    const [label, detail] = verdict(r);
    if (label !== 'LIVE') bad += 1;
    console.log(
      `  ${r.name.padEnd(16)} ${label.padEnd(14)} ${detail}  (${r.ms}ms)`
    );
  }

  if (bad) {
    // Which ones are missing decides what is actually broken: the first three
    // are registration, the rest are getting back in and changing details.
    const missing = results.filter((r) => verdict(r)[0] !== 'LIVE').map((r) => r.name);
    const SIGNUP = ['send-otp', 'verify-otp', 'create-account'];
    const breaksSignup = missing.some((n) => SIGNUP.includes(n));
    console.log(
      `\n${bad} of ${results.length} not ready: ${missing.join(', ')}.\n` +
        (breaksSignup
          ? 'Registration will fail at the phone step until they are.\n'
          : 'Registration still works; forgot password, change password and ' +
            'change phone will fail until they are.\n')
    );
    process.exit(1);
  }
  console.log(`\nAll ${results.length} are live.\n`);
}

main().catch((e) => {
  console.error(`\n${e.message}\n`);
  process.exit(1);
});
