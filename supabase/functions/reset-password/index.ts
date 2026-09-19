// POST { phone, isGuardian, claimToken, password } -> { ok, username }
//
// Forgot password. The caller proves they hold the account's phone (a code
// sent with purpose 'reset', verified by verify-otp) and sets a new password.
// The username comes back too — someone who forgot their password has often
// forgotten that as well.
//
// No session is needed: the whole point is that the caller cannot sign in.

import {
  admin, json, CORS, normalisePhone, passwordProblem, CLAIM_TTL_MINUTES,
} from '../_shared/otp.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { phone: rawPhone, isGuardian, claimToken, password } = await req.json();
    const phone = normalisePhone(rawPhone);
    if (!phone) return json({ error: 'Enter a valid phone number.' }, 400);
    const problem = passwordProblem(password);
    if (problem) return json({ error: problem }, 400);

    const guardian = isGuardian === true;
    const db = admin();
    const again = () => json({ error: 'Verify your phone number again.' }, 400);

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
      claim.purpose !== 'reset' ||
      claim.phone !== phone ||
      claim.is_guardian !== guardian
    ) {
      return again();
    }

    const { data: profile } = await db
      .from('profiles')
      .select('id, username')
      .eq('phone', phone)
      .eq('is_guardian', guardian)
      .maybeSingle();
    if (!profile) return again();

    const { error } = await db.auth.admin.updateUserById(profile.id, { password });
    if (error) return json({ error: 'Could not set the new password. Try again.' }, 400);

    await db.from('phone_verifications')
      .update({ claimed_at: new Date().toISOString() })
      .eq('id', claim.id);

    return json({ ok: true, username: profile.username });
  } catch (e) {
    console.error('reset-password', e);
    return json({ error: 'Could not reset the password. Please try again.' }, 500);
  }
});
