/* eslint-disable no-console */
// Helpers for the LIVE suite, which talks to the real Supabase project.
//
// SAFETY RAILS
//  * Every account this creates is named `qa_<runId>_<role>`. assertQaOnly()
//    refuses to touch anything whose username does not start with `qa_`.
//  * Only rows belonging to accounts created by the current run are deleted.
//  * The anon key cannot delete auth.users rows, so those linger. Run
//    docs/qa-cleanup.sql periodically to purge them.

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import appJson from '../app.json';

export const LIVE = process.env.RUN_LIVE === '1';

// Use describe/it from this module so a normal `npm test` never hits the network.
export const liveDescribe = LIVE ? describe : describe.skip;

const SUPABASE_URL = appJson.expo.extra.supabaseUrl;
const SUPABASE_ANON_KEY = appJson.expo.extra.supabaseAnonKey;

export const QA_PREFIX = 'qa_';
export const PASSWORD = 'QaPassw0rd!2026';

export function newRunId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function assertQaOnly(username) {
  if (!String(username).startsWith(QA_PREFIX)) {
    throw new Error(
      `Refusing to operate on non-QA account "${username}". ` +
        `Live tests may only touch usernames starting with "${QA_PREFIX}".`
    );
  }
}

// A fresh client per identity so the three sessions never clash.
export function freshClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// Fail fast with an actionable message if the backend is not reachable at all,
// instead of surfacing "fetch failed" once per test.
export async function assertBackendReachable() {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    if (res.status >= 500) {
      throw new Error(`backend returned HTTP ${res.status}`);
    }
  } catch (e) {
    const cause = e.cause?.message || e.message;
    throw new Error(
      `\n\nBACKEND UNREACHABLE: ${SUPABASE_URL}\n` +
        `  ${cause}\n\n` +
        'If this is ENOTFOUND / NXDOMAIN, the Supabase project referenced by\n' +
        'app.json (expo.extra.supabaseUrl) and src/utils/supabase.js no longer\n' +
        'exists. The shipped app cannot log in, sync, or pair guardians against\n' +
        'it either. Point both files at a live project and re-run.\n'
    );
  }
}

// Create and sign in a QA account. Returns { username, id, client }.
export async function createAccount(username) {
  assertQaOnly(username);
  const client = freshClient();
  const email = `${username}@pillreminder.app`;

  const { error: signUpError } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { data: { username, is_guardian: false } },
  });
  if (signUpError && !/already registered/i.test(signUpError.message)) {
    throw new Error(`signUp(${username}) failed: ${signUpError.message}`);
  }

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) {
    throw new Error(
      `signIn(${username}) failed: ${error.message}. ` +
        'If this says "Email not confirmed", disable email confirmation for ' +
        'this Supabase project or the app\'s own register->login flow is broken too.'
    );
  }

  return { username, id: data.user.id, client, email };
}

// Best-effort teardown of every row a QA account owns.
export async function cleanupAccount(account) {
  if (!account) return;
  assertQaOnly(account.username);
  const { client, id } = account;
  for (const table of [
    'action_requests',
    'dose_history',
    'health_readings',
    'medicines',
    'pairing_codes',
    'subscriptions',
    'payment_methods',
  ]) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await client.from(table).delete().eq('user_id', id);
    } catch (e) {
      /* best effort */
    }
  }
  try {
    await client.rpc('revoke_guardian');
  } catch (e) {
    /* best effort */
  }
  try {
    await client.auth.signOut();
  } catch (e) {
    /* best effort */
  }
}

// Pair `guardian` to `user` through the real RPC path.
export async function pair(user, guardian) {
  const { data: code, error: codeError } = await user.client.rpc(
    'generate_pairing_code'
  );
  if (codeError) throw new Error(`generate_pairing_code: ${codeError.message}`);

  const { error } = await guardian.client.rpc('pair_with_code', {
    target_username: user.username,
    code,
  });
  if (error) throw new Error(`pair_with_code: ${error.message}`);
  return code;
}

// Describes the outcome of an attack attempt in a way the report can quote.
export function outcome({ data, error }) {
  return {
    blocked: !!error || !data || (Array.isArray(data) && data.length === 0),
    rowCount: Array.isArray(data) ? data.length : data ? 1 : 0,
    error: error?.message || null,
  };
}
