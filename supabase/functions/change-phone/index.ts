// POST { phone, claimToken, password } -> { ok, phone }  (signed in)
//
// Moves the account to a new number. Needs both:
//   * a code sent to the NEW number (purpose 'change_phone'), proving the
//     user holds it — it becomes the way back in after a forgotten password;
//   * the current password, so someone holding an unlocked phone cannot
//     redirect the account's recovery to their own number.
//
// profiles.phone is pinned against the user's own writes (guard_profile_columns);
// only this function, as the service role, changes it.

import {
  admin, json, CORS, normalisePhone, callerFrom, passwordMatches, CLAIM_TTL_MINUTES,
} from '../_shared/otp.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const db = admin();
    const user = await callerFrom(req, db);
    if (!user?.email) return json({ error: 'Sign in again, then try.' }, 401);

    const { phone: rawPhone, claimToken, password } = await req.json();
    const phone = normalisePhone(rawPhone);
    if (!phone) return json({ error: 'Enter a valid phone number.' }, 400);

    const { data: profile } = await db
      .from('profiles')
      .select('id, phone, is_guardian')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile) return json({ error: 'Sign in again, then try.' }, 401);
    if (profile.phone === phone) {
      return json({ error: 'That is already your number.' }, 400);
    }

    if (!(await passwordMatches(user.email, password))) {
      return json({ error: 'Your current password is not right.' }, 403);
    }

    const { data: claim } = await db
      .from('phone_verifications')
      .select('id, phone, is_guardian, purpose, consumed_at, claimed_at')
      .eq('claim_token', String(claimToken ?? ''))
      .maybeSingle();
    const fresh =
      claim?.consumed_at &&
      Date.now() - new Date(claim.consumed_at).getTime() < CLAIM_TTL_MINUTES * 60_000;
    if (
      !claim ||
      claim.claimed_at ||
      !fresh ||
      claim.purpose !== 'change_phone' ||
      claim.phone !== phone ||
      claim.is_guardian !== profile.is_guardian
    ) {
      return json({ error: 'Verify the new number again.' }, 400);
    }

    const { error } = await db
      .from('profiles')
      .update({ phone, phone_verified_at: new Date().toISOString() })
      .eq('id', user.id);
    if (error) {
      // Unique (phone, is_guardian): another account took it meanwhile.
      return json({ error: 'This number is already used by another account.' }, 409);
    }

    await db.from('phone_verifications')
      .update({ claimed_at: new Date().toISOString() })
      .eq('id', claim.id);

    return json({ ok: true, phone });
  } catch (e) {
    console.error('change-phone', e);
    return json({ error: 'Could not change the number. Please try again.' }, 500);
  }
});
