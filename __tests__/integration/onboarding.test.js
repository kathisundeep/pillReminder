// Registration and profile details.
//
// Account creation and OTP live in Edge Functions running as the service role,
// so the client cannot assert "this phone was verified". These tests stand in
// for those functions with db.onFunction(), and check that the client refuses
// to proceed without them.

import { supabase } from '../../src/utils/supabase';
import { registerUser, loginUser } from '../../src/utils/storage';
import {
  normalisePhone,
  phoneError,
  usernameError,
  passwordError,
  describeError,
  isUsernameAvailable,
  isPhoneAvailable,
  sendPhoneCode,
  verifyPhoneCode,
  createAccount,
  PASSWORD_MIN,
} from '../../src/utils/onboarding';
import {
  GENDERS,
  EDITABLE_FIELDS,
  ageFrom,
  heightError,
  dateOfBirthError,
  getMyDetails,
  needsOnboarding,
  updateMyDetails,
  completeOnboarding,
  skipOnboarding,
} from '../../src/utils/profile';

const db = () => globalThis.__db;

async function signedIn(username = 'alice', opts) {
  await registerUser(username, 'password123', opts);
  await loginUser(username, 'password123');
  return db().session.user;
}

// ---------------------------------------------------------------------------
describe('input rules', () => {
  it('accepts E.164 numbers and rejects anything else', () => {
    expect(normalisePhone('+919876543210')).toBe('+919876543210');
    expect(normalisePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalisePhone('+91 (98765) 43210')).toBe('+919876543210');

    for (const bad of ['9876543210', '+0123456789', 'abc', '', null, '+1']) {
      expect(normalisePhone(bad)).toBeNull();
    }
  });

  it('asks for a country code rather than just saying invalid', () => {
    expect(phoneError('')).toMatch(/enter your phone/i);
    expect(phoneError('9876543210')).toMatch(/country code/i);
    expect(phoneError('+919876543210')).toBeNull();
  });

  it('applies the username rules', () => {
    expect(usernameError('')).toMatch(/choose a username/i);
    expect(usernameError('ab')).toMatch(/3-30/);
    expect(usernameError('has space')).toMatch(/3-30/);
    expect(usernameError('sundeep')).toBeNull();
  });

  it('requires a stronger password than the backend default', () => {
    // Supabase's own floor is 6; a health record with SMS recovery needs more.
    expect(PASSWORD_MIN).toBeGreaterThan(6);
    expect(passwordError('')).toMatch(/choose a password/i);
    expect(passwordError('short1')).toMatch(/at least 8/i);
    expect(passwordError('allletters')).toMatch(/letter and one number/i);
    expect(passwordError('12345678')).toMatch(/letter and one number/i);
    expect(passwordError('goodpass1')).toBeNull();
  });

  it('requires both passwords to match', () => {
    expect(passwordError('goodpass1', 'goodpass2')).toMatch(/must match/i);
    expect(passwordError('goodpass1', 'goodpass1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('unreachable backend', () => {
  // React Native reports every failed fetch as the same bare string, whatever
  // the cause. Shown raw it tells the user nothing they can act on.
  it.each([
    'Network request failed',
    'TypeError: Failed to fetch',
    'getaddrinfo ENOTFOUND db.example.co',
    'connect ECONNREFUSED 127.0.0.1:443',
  ])('translates %s into something actionable', (raw) => {
    const said = describeError(new Error(raw));
    expect(said).toMatch(/can't reach the server/i);
    expect(said).not.toMatch(/ENOTFOUND|ECONNREFUSED|TypeError/);
  });

  it('leaves a real server message alone', () => {
    expect(describeError(new Error('That username is taken.'))).toBe(
      'That username is taken.'
    );
  });

  it('falls back when there is no message at all', () => {
    expect(describeError(null, 'Could not check that.')).toBe('Could not check that.');
  });

  it('reports the username check as failed, never as available', async () => {
    db().failOn('rpc', 'username_available', {
      message: 'Network request failed',
    });

    const res = await isUsernameAvailable('brandnew');
    // Not `available: true` — a check that could not run has not cleared anyone.
    expect(res.ok).toBe(false);
    expect(res.available).toBeNull();
    expect(res.error).toMatch(/can't reach the server/i);
  });

  it('reports the phone check as failed too', async () => {
    db().failOn('rpc', 'phone_available', { message: 'Network request failed' });

    const res = await isPhoneAvailable('+919876543210', false);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/can't reach the server/i);
  });
});

// ---------------------------------------------------------------------------
describe('availability checks', () => {
  it('reports a free username as available', async () => {
    const res = await isUsernameAvailable('brandnew');
    expect(res).toEqual({ ok: true, available: true });
  });

  it('reports a taken username as unavailable', async () => {
    await registerUser('alice', 'password123');
    expect((await isUsernameAvailable('alice')).available).toBe(false);
  });

  it('treats usernames case-insensitively', async () => {
    await registerUser('Alice', 'password123');
    expect((await isUsernameAvailable('alice')).available).toBe(false);
  });

  it('does not even ask the server about a malformed username', async () => {
    const res = await isUsernameAvailable('ab');
    expect(res).toEqual({ ok: false, available: false });
  });

  // The whole point of two account types sharing one number.
  it('allows one patient AND one guardian on the same number', async () => {
    const alice = await signedIn('alice');
    db().rows('profiles').find((p) => p.id === alice.id).phone = '+919876543210';

    expect((await isPhoneAvailable('+919876543210', false)).available).toBe(false);
    expect((await isPhoneAvailable('+919876543210', true)).available).toBe(true);
  });

  it('refuses a second account of the same role on one number', async () => {
    const bob = await signedIn('bob', { isGuardian: true });
    db().rows('profiles').find((p) => p.id === bob.id).phone = '+919876543210';
    db().rows('profiles').find((p) => p.id === bob.id).is_guardian = true;

    expect((await isPhoneAvailable('+919876543210', true)).available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('phone verification', () => {
  it('sends a code through the server, never the client', async () => {
    let sentWith = null;
    db().onFunction('send-otp', async (body) => {
      sentWith = body;
      return { ok: true, verificationId: 'v1' };
    });

    const res = await sendPhoneCode('+91 98765 43210', false);
    expect(res.ok).toBe(true);
    expect(sentWith).toEqual({ phone: '+919876543210', isGuardian: false });
  });

  it('will not spend an SMS on a malformed number', async () => {
    let called = false;
    db().onFunction('send-otp', async () => {
      called = true;
      return { ok: true };
    });

    const res = await sendPhoneCode('9876543210', false);
    expect(res.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('surfaces a rate-limit refusal to the user', async () => {
    db().onFunction('send-otp', async () => ({
      error: 'Too many codes requested for this number. Try again in an hour.',
    }));
    const res = await sendPhoneCode('+919876543210', false);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/too many/i);
  });

  it('returns a claim token on a correct code', async () => {
    db().onFunction('verify-otp', async () => ({
      ok: true, claimToken: 'claim-123',
    }));
    const res = await verifyPhoneCode('+919876543210', false, '123456');
    expect(res.ok).toBe(true);
    expect(res.claimToken).toBe('claim-123');
  });

  it('rejects a code that is not six digits without asking the server', async () => {
    let called = false;
    db().onFunction('verify-otp', async () => {
      called = true;
      return { ok: true };
    });

    for (const bad of ['', '12345', 'abcdef', '1234567']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await verifyPhoneCode('+919876543210', false, bad);
      expect(res.ok).toBe(false);
    }
    expect(called).toBe(false);
  });

  it('reports the server`s generic failure verbatim', async () => {
    db().onFunction('verify-otp', async () => ({
      error: 'That code is not right. Request a new one.',
    }));
    const res = await verifyPhoneCode('+919876543210', false, '000000');
    expect(res.error).toMatch(/not right/i);
  });
});

// ---------------------------------------------------------------------------
describe('account creation', () => {
  const good = {
    username: 'newbie',
    password: 'goodpass1',
    phone: '+919876543210',
    isGuardian: false,
    claimToken: 'claim-123',
  };

  function serverCreates() {
    db().onFunction('create-account', async ({ username, password, isGuardian, phone }) => {
      const user = db().makeUser(username, { is_guardian: isGuardian, phone });
      user.password = password; // the real function creates it with this password
      return { ok: true };
    });
  }

  it('refuses without a claim token from the OTP step', async () => {
    serverCreates();
    const res = await createAccount({ ...good, claimToken: null });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/verify your phone/i);
    expect(db().rows('profiles')).toHaveLength(0);
  });

  it('validates locally before troubling the server', async () => {
    let called = false;
    db().onFunction('create-account', async () => {
      called = true;
      return { ok: true };
    });

    expect((await createAccount({ ...good, username: 'ab' })).ok).toBe(false);
    expect((await createAccount({ ...good, password: 'short' })).ok).toBe(false);
    expect((await createAccount({ ...good, phone: '9876543210' })).ok).toBe(false);
    expect(called).toBe(false);
  });

  it('creates the account server-side and signs in', async () => {
    serverCreates();
    const res = await createAccount(good);
    expect(res.ok).toBe(true);
    expect(db().rows('profiles')[0].username).toBe('newbie');
  });

  it('reports a username taken at the last moment', async () => {
    db().onFunction('create-account', async () => ({
      error: 'That username is taken.',
    }));
    const res = await createAccount(good);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/taken/i);
  });

  it('reports a clear failure when the server is unreachable', async () => {
    const res = await createAccount(good); // no function registered
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('profile details', () => {
  it('derives age from date of birth rather than storing it', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 5, 15, 12, 0, 0)); // 15 June 2026, local
    try {
      expect(ageFrom('1996-06-15')).toBe(30); // birthday today
      expect(ageFrom('1996-06-14')).toBe(30); // birthday passed
      expect(ageFrom('1996-06-16')).toBe(29); // birthday still to come
      expect(ageFrom('1996-12-31')).toBe(29); // later in the year

      expect(ageFrom(null)).toBeNull();
      expect(ageFrom('not a date')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('validates height in centimetres', () => {
    expect(heightError('')).toBeNull(); // optional
    expect(heightError('172')).toBeNull();
    expect(heightError('abc')).toMatch(/centimetres/i);
    expect(heightError('5')).toMatch(/wrong/i); // feet, not cm
    expect(heightError('400')).toMatch(/wrong/i);
  });

  it('validates the date of birth', () => {
    expect(dateOfBirthError('')).toBeNull(); // optional
    expect(dateOfBirthError('1990-05-01')).toBeNull();
    expect(dateOfBirthError('rubbish')).toMatch(/YYYY-MM-DD/);
    expect(dateOfBirthError('2999-01-01')).toMatch(/future/i);
    expect(dateOfBirthError('1850-01-01')).toMatch(/wrong/i);
  });

  it('offers a respectful set of gender options', () => {
    expect(GENDERS.map((g) => g.id)).toEqual([
      'female', 'male', 'other', 'undisclosed',
    ]);
  });

  it('saves the editable fields', async () => {
    const user = await signedIn();
    const res = await updateMyDetails({
      full_name: 'Alice R',
      gender: 'female',
      date_of_birth: '1990-05-01',
      height_cm: '165',
      country: 'India',
    });
    expect(res.ok).toBe(true);

    const details = await getMyDetails();
    expect(details).toMatchObject({
      full_name: 'Alice R',
      gender: 'female',
      date_of_birth: '1990-05-01',
      height_cm: 165,
      country: 'India',
    });
    expect(details.age).toBe(ageFrom('1990-05-01'));
    expect(user.id).toBeTruthy();
  });

  it('never sends a column the user is not allowed to change', () => {
    // The trigger would reject them anyway; not sending them keeps the intent
    // obvious at the call site.
    for (const locked of ['username', 'is_guardian', 'phone', 'phone_verified_at', 'id']) {
      expect(EDITABLE_FIELDS).not.toContain(locked);
    }
    expect(EDITABLE_FIELDS).toEqual([
      'full_name', 'gender', 'date_of_birth', 'height_cm', 'country',
    ]);
  });

  it('rejects a bad height before writing anything', async () => {
    await signedIn();
    const res = await updateMyDetails({ full_name: 'Alice', height_cm: '5' });
    expect(res.ok).toBe(false);
    expect((await getMyDetails()).full_name).toBeNull();
  });

  it('refuses when signed out', async () => {
    expect((await updateMyDetails({ full_name: 'X' })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('the details step is asked once', () => {
  it('is needed on a fresh account', async () => {
    await signedIn();
    expect(await needsOnboarding()).toBe(true);
  });

  it('is not needed after completing it', async () => {
    await signedIn();
    await completeOnboarding({ full_name: 'Alice R' });
    expect(await needsOnboarding()).toBe(false);
  });

  it('is not needed after SKIPPING it', async () => {
    await signedIn();
    await skipOnboarding();
    expect(await needsOnboarding()).toBe(false);
    // Skipping records nothing beyond the fact that we asked.
    expect((await getMyDetails()).full_name).toBeNull();
  });

  it('is never asked of a signed-out visitor', async () => {
    expect(await needsOnboarding()).toBe(false);
  });

  it('seeds the first weight reading rather than a second copy on the profile', async () => {
    const user = await signedIn();
    await completeOnboarding({ full_name: 'Alice R', weightKg: '71' });

    const readings = db().rows('health_readings');
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({
      user_id: user.id, type: 'weight', reading_values: { value: 71 },
    });
    // ...and no weight column was added to the profile.
    expect((await getMyDetails()).weight_kg).toBeUndefined();
  });

  it('rejects an implausible weight', async () => {
    await signedIn();
    const res = await completeOnboarding({ weightKg: '900' });
    expect(res.ok).toBe(false);
    expect(db().rows('health_readings')).toHaveLength(0);
  });

  it('completes without a weight', async () => {
    await signedIn();
    expect((await completeOnboarding({ full_name: 'Alice R' })).ok).toBe(true);
    expect(db().rows('health_readings')).toHaveLength(0);
  });

  it('keeps the details even if seeding the weight reading fails', async () => {
    await signedIn();
    db().failOn('health_readings', 'insert', { message: 'offline' });

    const res = await completeOnboarding({ full_name: 'Alice R', weightKg: '71' });
    expect(res.ok).toBe(true);
    expect((await getMyDetails()).full_name).toBe('Alice R');
    expect(await needsOnboarding()).toBe(false);
  });
});
