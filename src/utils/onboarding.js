import { supabase } from './supabase';
import { loginUser, validUsername } from './storage';

// Registration: username availability, phone verification, account creation.
//
// The account is created by the create-account Edge Function, not here. The
// client cannot be trusted to assert "this phone was verified", so the same
// rule as subscriptions applies — anything a user would benefit from forging
// is decided by the server.

export const PASSWORD_MIN = 8;

// React Native reports every failed fetch as the bare string "Network request
// failed", whether the phone is offline, the host does not resolve, or TLS was
// rejected. Shown as-is it tells the user nothing they can act on, so translate
// it into the two things they can actually check.
const OFFLINE = /network request failed|failed to fetch|network error|econnrefused|enotfound/i;

export function describeError(error, fallback) {
  const message = String(error?.message || error || '');
  if (OFFLINE.test(message)) {
    return "Can't reach the server. Check your connection — if you're online, the app's backend is not responding.";
  }
  return message || fallback;
}

// E.164, which is what the backend and every SMS provider expect.
export function normalisePhone(raw) {
  const s = String(raw ?? '').replace(/[\s()-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

export function phoneError(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'Enter your phone number.';
  if (!normalisePhone(s)) {
    // With the country picker the dial code is always present, so "include the
    // country code" would be nonsense advice. Name the length instead.
    if (s.startsWith('+')) {
      const digits = s.replace(/\D/g, '').length;
      if (digits < 8) return 'That number looks too short. Check it and try again.';
      if (digits > 15) return 'That number looks too long. Check it and try again.';
      return 'That does not look like a valid number.';
    }
    return 'Include the country code, e.g. +91 98765 43210.';
  }
  return null;
}

export function usernameError(raw) {
  const u = String(raw ?? '').trim();
  if (!u) return 'Choose a username.';
  if (!validUsername(u)) return '3-30 chars: letters, numbers, _ or . only';
  return null;
}

// Deliberately stricter than Supabase's 6-character default. This is a health
// record with a recovery-by-SMS path; six characters is not enough.
export function passwordError(password, confirm) {
  const p = String(password ?? '');
  if (!p) return 'Choose a password.';
  if (p.length < PASSWORD_MIN)
    return `Use at least ${PASSWORD_MIN} characters.`;
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p))
    return 'Include at least one letter and one number.';
  if (confirm !== undefined && p !== String(confirm ?? ''))
    return 'Both passwords must match.';
  return null;
}

// ---------------------------------------------------------------------------
// Availability. Both are cheap reads that let the form fail early rather than
// after the user has filled in everything.
// ---------------------------------------------------------------------------
export async function isUsernameAvailable(username) {
  const u = String(username ?? '').trim();
  if (!validUsername(u)) return { ok: false, available: false };
  const { data, error } = await supabase.rpc('username_available', {
    candidate: u,
  });
  if (error) {
    return {
      ok: false,
      available: null,
      error: describeError(error, 'Could not check that username.'),
    };
  }
  return { ok: true, available: data === true };
}

export async function isPhoneAvailable(phone, isGuardian) {
  const p = normalisePhone(phone);
  if (!p) return { ok: false, available: false };
  const { data, error } = await supabase.rpc('phone_available', {
    candidate: p,
    want_guardian: !!isGuardian,
  });
  if (error) {
    return {
      ok: false,
      available: null,
      error: describeError(error, 'Could not check that number.'),
    };
  }
  return { ok: true, available: data === true };
}

// ---------------------------------------------------------------------------
// Phone verification
// ---------------------------------------------------------------------------
// supabase-js collapses every non-2xx response into one string — "Edge Function
// returned a non-2xx status code" — and puts the actual response on `.context`.
// Left alone, a 404, a rate-limit and "that number is already registered" all
// reach the user as that same unactionable line, so dig the real one out.
async function readFunctionError(error, fallback) {
  const res = error?.context;
  if (res && typeof res.status === 'number') {
    // A function that was never deployed is the single most likely failure
    // during setup, and the least self-explanatory. Name it.
    if (res.status === 404) {
      return 'The server is missing part of its setup (sign-up service not deployed). Nothing you did wrong — this needs a fix on our side.';
    }
    if (typeof res.text === 'function') {
      const body = await res.text().catch(() => '');
      try {
        const parsed = JSON.parse(body);
        if (parsed?.error) return parsed.error;
      } catch (e) {
        /* not JSON — fall through to the status-based message */
      }
    }
    if (res.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
    if (res.status >= 500) return 'The server had a problem. Try again in a moment.';
  }
  return describeError(error, fallback);
}

async function invoke(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    return { ok: false, error: await readFunctionError(error, 'Could not reach the server.') };
  }
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, ...(data || {}) };
}

export async function sendPhoneCode(phone, isGuardian) {
  const p = normalisePhone(phone);
  if (!p) return { ok: false, error: phoneError(phone) };
  return invoke('send-otp', { phone: p, isGuardian: !!isGuardian });
}

// Returns { ok, claimToken } — the token create-account requires, so a verified
// number cannot be swapped for an unverified one at the final step.
export async function verifyPhoneCode(phone, isGuardian, code) {
  const p = normalisePhone(phone);
  if (!p) return { ok: false, error: phoneError(phone) };
  if (!/^\d{6}$/.test(String(code ?? '').trim()))
    return { ok: false, error: 'Enter the 6-digit code.' };
  return invoke('verify-otp', {
    phone: p,
    isGuardian: !!isGuardian,
    code: String(code).trim(),
  });
}

// ---------------------------------------------------------------------------
// Account creation, then sign in.
// ---------------------------------------------------------------------------
export async function createAccount({
  username,
  password,
  phone,
  isGuardian,
  claimToken,
}) {
  const nameProblem = usernameError(username);
  if (nameProblem) return { ok: false, error: nameProblem };
  const passProblem = passwordError(password);
  if (passProblem) return { ok: false, error: passProblem };
  const p = normalisePhone(phone);
  if (!p) return { ok: false, error: phoneError(phone) };
  if (!claimToken)
    return { ok: false, error: 'Verify your phone number first.' };

  const created = await invoke('create-account', {
    username: String(username).trim(),
    password,
    phone: p,
    isGuardian: !!isGuardian,
    claimToken,
  });
  if (!created.ok) return created;

  // The function creates the account but does not sign anyone in.
  const login = await loginUser(String(username).trim(), password);
  if (!login.ok) {
    return {
      ok: false,
      error: 'Account created, but signing in failed. Try logging in.',
    };
  }
  return { ok: true };
}
