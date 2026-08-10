// POST { username, password, phone, isGuardian, claimToken } -> { ok }
//
// Account creation lives here rather than in the client because the client
// cannot be trusted to say "this phone was verified". Same reasoning as
// subscriptions: the server owns anything the user would benefit from forging.

import {
  admin, json, CORS, normalisePhone, synthEmail,
} from '../_shared/otp.ts';

const USERNAME = /^[a-zA-Z0-9_.]{3,30}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { username, password, phone: rawPhone, isGuardian, claimToken } =
      await req.json();

    const name = String(username ?? '').trim();
    if (!USERNAME.test(name)) {
      return json({ error: '3-30 chars: letters, numbers, _ or . only' }, 400);
    }
    if (String(password ?? '').length < 8) {
      return json({ error: 'Use at least 8 characters for your password.' }, 400);
    }
    const phone = normalisePhone(rawPhone);
    if (!phone) return json({ error: 'Enter a valid phone number.' }, 400);

    const guardian = isGuardian === true;
    const db = admin();

    // The claim token must belong to a consumed, unclaimed verification for
    // exactly this number and role.
    const { data: claim } = await db
      .from('phone_verifications')
      .select('id, phone, is_guardian, consumed_at, claimed_at')
      .eq('claim_token', String(claimToken ?? ''))
      .maybeSingle();

    if (
      !claim ||
      claim.claimed_at ||
      !claim.consumed_at ||
      claim.phone !== phone ||
      claim.is_guardian !== guardian
    ) {
      return json({ error: 'Verify your phone number again.' }, 400);
    }

    const { data: created, error: createError } = await db.auth.admin.createUser({
      email: synthEmail(name),
      password,
      email_confirm: true,
      user_metadata: { username: name, is_guardian: guardian },
    });
    if (createError) {
      const taken = /already|exists|registered/i.test(createError.message);
      return json(
        { error: taken ? 'That username is taken.' : createError.message },
        taken ? 409 : 400
      );
    }

    // handle_new_user() has already inserted the profile row; attach the
    // verified phone to it.
    const { error: profileError } = await db
      .from('profiles')
      .update({ phone, phone_verified_at: new Date().toISOString() })
      .eq('id', created.user.id);

    if (profileError) {
      // Unique violation on (phone, is_guardian) — someone finished the same
      // flow first. Roll the half-made account back rather than leaving it.
      await db.auth.admin.deleteUser(created.user.id);
      return json(
        { error: 'This number already has an account for that role. Log in instead.' },
        409
      );
    }

    await db.from('phone_verifications')
      .update({ claimed_at: new Date().toISOString() })
      .eq('id', claim.id);

    return json({ ok: true, userId: created.user.id });
  } catch (e) {
    console.error('create-account', e);
    return json({ error: 'Could not create the account. Please try again.' }, 500);
  }
});
